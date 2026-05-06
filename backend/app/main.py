import json

from fastapi import FastAPI, HTTPException, Depends, Header, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from typing import List
from sqlalchemy.orm import Session
from time import perf_counter

from passlib.hash import bcrypt
from datetime import datetime, timedelta
import os

# --- Pydantic Schemas ---
from app.schemas import (
    AttachmentOut,
    ChatRequest,
    ChatResponse,
    UserCreate,
    TokenResponse,
    Chat,
    Message as MessageSchema,
    FeedbackRequest,
    FeedbackResponse,
    TicketResponse,
    RefreshRequest,
    LogoutRequest,
)

# --- Vector Store ---
from app.vector_store import vector_store_manager
from app.llm import ask_campusguide

# --- Auth ---
from app.auth import (
    create_access_token,
    get_current_user,
    create_refresh_token,
    consume_refresh_token,
    rotate_refresh_token,
    revoke_refresh_tokens,
)
from app.utils import (
    build_stored_message_content,
    generate_reference_code,
    strip_attachment_ingestion_content,
)
from app.attachments import build_attachment_note, process_message_uploads
from app.assignment import apply_ticket_recommendation, maybe_auto_assign_recommended_ticket

# --- Database ---
from database.database import get_db
from database.orm_models import User, Conversation, Message, Ticket, TicketMessage, MessageAttachment
from database.orm_models import RLFeedback, TicketUpdate

# --- Security (defined in auth.py) ---

# --- FastAPI App ---
app = FastAPI()

ESCALATION_ELIGIBLE_REASONS = {"no_answer"}
LLM_RESULT_REASONS = {"answered", "clarification_needed", "no_answer", "system_error"}


def _get_allowed_origins() -> list[str]:
    configured = os.getenv("CORS_ALLOWED_ORIGINS")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_active_ticket_for_conversation(db: Session, conversation_id: int) -> Ticket | None:
    return (
        db.query(Ticket)
        .filter(
            Ticket.conversation_id == conversation_id,
            Ticket.status.notin_(["resolved", "closed"]),
        )
        .order_by(Ticket.created_at.desc())
        .first()
    )


def _serialize_attachment(attachment: MessageAttachment) -> AttachmentOut:
    return AttachmentOut(
        id=attachment.id,
        original_filename=attachment.original_filename,
        content_type=attachment.content_type,
        file_size_bytes=attachment.file_size_bytes,
        download_url=f"/api/attachments/{attachment.id}/download",
        view_url=f"/api/attachments/{attachment.id}/view",
    )


def _augment_query_with_uploads(query: str, files: list[UploadFile]) -> tuple[str, str, list[dict]]:
    if not files:
        return query, query, []

    processed = process_message_uploads(files)
    file_names = [item.original_filename for item in processed]
    extracted_sections = [
        f"[File: {item.original_filename}]\n{item.extracted_text}"
        for item in processed
        if item.extracted_text
    ]

    visible_content = f"{query}{build_attachment_note(file_names)}".strip()
    if not extracted_sections:
        return query, visible_content, [
            {
                "original_filename": item.original_filename,
                "stored_filename": item.stored_filename,
                "stored_path": item.stored_path,
                "content_type": item.content_type,
                "file_size_bytes": item.file_size_bytes,
                "extracted_text": item.extracted_text,
            }
            for item in processed
        ]

    augmented_query = (
        f"{query}\n\n"
        "Use the uploaded file content below as additional context when answering.\n\n"
        + "\n\n".join(extracted_sections)
    ).strip()
    return augmented_query, build_stored_message_content(visible_content, extracted_sections), [
        {
            "original_filename": item.original_filename,
            "stored_filename": item.stored_filename,
            "stored_path": item.stored_path,
            "content_type": item.content_type,
            "file_size_bytes": item.file_size_bytes,
            "extracted_text": item.extracted_text,
        }
        for item in processed
    ]


def _parse_chat_history_payload(chat_history: str | None) -> list[tuple[str, str]]:
    if not chat_history:
        return []
    try:
        payload = json.loads(chat_history)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid chat_history payload") from exc

    history: list[tuple[str, str]] = []
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, list | tuple) and len(item) == 2:
                history.append((str(item[0] or ""), str(item[1] or "")))
    return history


def _normalize_llm_result(raw_result: object) -> tuple[str, bool, str]:
    if not isinstance(raw_result, dict):
        return "system_error", False, ""

    raw_reason = str(raw_result.get("reason") or "").strip()
    reason = raw_reason if raw_reason in LLM_RESULT_REASONS else "system_error"
    answer = str(raw_result.get("answer") or "").strip()
    found_answer = bool(raw_result.get("found_answer")) if reason in {"answered", "clarification_needed"} else False
    return reason, found_answer, answer


def _should_escalate_to_ticket(llm_reason: str, current_user: User) -> bool:
    return current_user.role == "student" and llm_reason in ESCALATION_ELIGIBLE_REASONS


def _run_chat_flow(
    *,
    query: str,
    chat_history: list[tuple[str, str]],
    chat_id: int | None,
    current_user: User,
    db: Session,
    stored_user_content: str | None = None,
    uploaded_attachments: list[dict] | None = None,
) -> ChatResponse:
    total_start = perf_counter()
    db_query = stored_user_content or query

    # Use Conversation model
    db_chat = None
    if chat_id:
        db_chat = db.query(Conversation).filter(
            Conversation.id == chat_id,
            Conversation.user_id == current_user.id
        ).first()

    if not db_chat:
        db_chat = Conversation(user_id=current_user.id)
        db.add(db_chat)
        db.commit()
        db.refresh(db_chat)

    user_message = Message(conversation_id=db_chat.id, sender="user", content=db_query)
    db.add(user_message)
    db.commit()
    db.refresh(user_message)

    for attachment in uploaded_attachments or []:
        db.add(
            MessageAttachment(
                message_id=user_message.id,
                uploaded_by_user_id=current_user.id,
                original_filename=attachment["original_filename"],
                stored_filename=attachment["stored_filename"],
                stored_path=attachment["stored_path"],
                content_type=attachment["content_type"],
                file_size_bytes=attachment["file_size_bytes"],
                extracted_text=attachment["extracted_text"],
            )
        )
    if uploaded_attachments:
        db.commit()

    llm_reason = "system_error"
    try:
        llm_start = perf_counter()
        llm_result = ask_campusguide(query, chat_history) or {}
        llm_ms = (perf_counter() - llm_start) * 1000
        print(f"[perf] llm_ms={llm_ms:.2f} query_len={len(query)}")
        llm_reason, found_answer, bot_response_content = _normalize_llm_result(llm_result)
        if not bot_response_content:
            raise ValueError("Empty LLM response")
    except Exception as e:
        print(f"LLM error for query '{query}': {e}")
        bot_response_content = "I'm sorry, I'm having trouble connecting right now. Please try again later."
        found_answer = False
        llm_reason = "system_error"

    bot_message = Message(
        conversation_id=db_chat.id,
        sender="bot",
        content=bot_response_content,
        found_answer=found_answer,
    )
    db.add(bot_message)
    db.commit()

    ticket_ref = None
    if _should_escalate_to_ticket(llm_reason, current_user):
        existing_ticket = _get_active_ticket_for_conversation(db, db_chat.id)
        if existing_ticket:
            ticket_ref = existing_ticket.reference_code
            bot_response_content = (
                "Your inquiry has already been referred to an officer in the Academic Registrar's Department. "
                f"Your ticket reference is {ticket_ref}. Please continue in the ticket chat."
            )
            try:
                bot_message.content = bot_response_content
                db.add(bot_message)
                db.commit()
            except Exception:
                pass
        else:
            ticket_ref = generate_reference_code()
            ticket = Ticket(
                reference_code=ticket_ref,
                conversation_id=db_chat.id,
                student_id=current_user.id,
                status="open"
            )
            db.add(ticket)
            db.commit()
            db.refresh(ticket)
            db_chat.ended_at = datetime.utcnow()
            db.add(db_chat)
            db.commit()
            db.add(
                TicketMessage(
                    ticket_id=ticket.id,
                    sender_role="student",
                    sender_id=current_user.id,
                    content=db_query,
                )
            )
            db.commit()
            try:
                apply_ticket_recommendation(db, ticket)
                maybe_auto_assign_recommended_ticket(db, ticket)
            except Exception as exc:
                print(f"Ticket recommendation failed for ticket {ticket.id}: {exc}")
            bot_response_content = (
                "Your inquiry has been referred to an officer in the Academic Registrar's Department. "
                f"Your ticket reference is {ticket_ref}. Please continue in the ticket chat."
            )
            try:
                bot_message.content = bot_response_content
                db.add(bot_message)
                db.commit()
            except Exception:
                pass

    if chat_id and not ticket_ref:
        active_ticket = _get_active_ticket_for_conversation(db, db_chat.id)
        if active_ticket:
            total_ms = (perf_counter() - total_start) * 1000
            print(
                f"[perf] total_ms={total_ms:.2f} chat_id={db_chat.id} "
                f"ticket_created=0 found_answer=0 llm_reason=ticket_redirect early_return=1"
            )
            return ChatResponse(
                response=(
                    "This inquiry is already under review by an officer. "
                    f"Your ticket reference is {active_ticket.reference_code}. Please continue in the ticket chat."
                ),
                chat_id=db_chat.id,
                ticket_reference=active_ticket.reference_code,
            )

    if not db_chat.title:
        first_message = (
            db.query(Message)
            .filter(Message.conversation_id == db_chat.id)
            .order_by(Message.created_at.asc())
            .first()
        )
        if first_message and first_message.content:
            visible_title_source = strip_attachment_ingestion_content(first_message.content)
            db_chat.title = visible_title_source[:50] + "..."
            db.add(db_chat)
            db.commit()

    total_ms = (perf_counter() - total_start) * 1000
    print(
        f"[perf] total_ms={total_ms:.2f} chat_id={db_chat.id} "
        f"ticket_created={1 if ticket_ref else 0} found_answer={1 if found_answer else 0} llm_reason={llm_reason} early_return=0"
    )
    return ChatResponse(response=bot_response_content, chat_id=db_chat.id, ticket_reference=ticket_ref)

async def startup_event():
    print("Startup: Loading vector store...")
    vector_store_manager.load_or_create_store()
    if vector_store_manager.vector_store:
        print("Vector store loaded successfully")
    else:
        print("Vector store failed to load")
    from app.scraper.scheduler import start_scheduler
    start_scheduler(app.state)


async def shutdown_event():
    from app.scraper.scheduler import stop_scheduler
    stop_scheduler(app.state)

app.add_event_handler("startup", startup_event)
app.add_event_handler("shutdown", shutdown_event)

# --- Routes ---
@app.post("/api/signup", response_model=TokenResponse)
async def signup(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = bcrypt.hash(user.password)
    # Default new users to student role for now
    new_user = User(username=user.username, hashed_password=hashed_password, role="student")
    db.add(new_user)
    db.commit()
    access_token = create_access_token(
        {"username": new_user.username, "user_id": new_user.id, "role": new_user.role}
    )
    refresh_token = create_refresh_token(db, new_user)
    return TokenResponse(token=access_token, token_type="bearer", refresh_token=refresh_token)

@app.post("/api/login", response_model=TokenResponse)
async def login(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if not db_user or not bcrypt.verify(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    access_token = create_access_token(
        {"username": db_user.username, "user_id": db_user.id, "role": db_user.role}
    )
    refresh_token = create_refresh_token(db, db_user)
    # Include user data in response
    return {
        "token": access_token,
        "token_type": "bearer",
        "refresh_token": refresh_token,
        "user": {
            "id": db_user.id,
            "username": db_user.username,
            "role": db_user.role,
            "name": db_user.name,
            "email": db_user.email
        }
    }

@app.get("/api/check_auth")
async def check_auth(current_user: User = Depends(get_current_user)):
    return {"message": "Authenticated"}

@app.post("/api/refresh", response_model=TokenResponse)
async def refresh_tokens(payload: RefreshRequest, db: Session = Depends(get_db)):
    token_record = consume_refresh_token(db, payload.refresh_token)
    if not token_record:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = token_record.user
    access_token = create_access_token(
        {"username": user.username, "user_id": user.id, "role": user.role}
    )
    new_refresh_token = rotate_refresh_token(db, token_record)
    return TokenResponse(
        token=access_token,
        token_type="bearer",
        refresh_token=new_refresh_token,
    )

@app.post("/api/logout")
async def logout(
    payload: LogoutRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    refresh = payload.refresh_token if payload else None
    revoke_refresh_tokens(db, current_user.id, refresh)
    return {"message": "Logged out"}

@app.post("/chat/", response_model=ChatResponse)
async def chat(request: ChatRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _run_chat_flow(
        query=request.query,
        chat_history=request.chat_history or [],
        chat_id=request.chat_id,
        current_user=current_user,
        db=db,
    )


@app.post("/chat/upload", response_model=ChatResponse)
async def chat_with_uploads(
    query: str = Form(...),
    chat_id: int | None = Form(None),
    chat_history: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    normalized_query = query.strip() or "Please review the attached files."
    usable_files = [file for file in (files or []) if file.filename]
    augmented_query, stored_user_content, uploaded_attachments = _augment_query_with_uploads(normalized_query, usable_files)
    return _run_chat_flow(
        query=augmented_query,
        chat_history=_parse_chat_history_payload(chat_history),
        chat_id=chat_id,
        current_user=current_user,
        db=db,
        stored_user_content=stored_user_content,
        uploaded_attachments=uploaded_attachments,
    )


# NOTE: Feedback endpoints moved to `app/feedback/routes.py` to keep routing modular.

@app.get("/api/chats", response_model=List[Chat])
async def get_chats(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    chats_db = db.query(Conversation).filter(Conversation.user_id == current_user.id).order_by(Conversation.created_at.desc()).all()
    return [Chat.from_orm(chat_db) for chat_db in chats_db]


@app.get("/api/chats/{chat_id}/messages", response_model=List[MessageSchema])
async def get_messages_for_chat(chat_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    chat_db = db.query(Conversation).filter(Conversation.id == chat_id, Conversation.user_id == current_user.id).first()
    if not chat_db:
        raise HTTPException(status_code=404, detail="Chat not found")
    messages_db = (
        db.query(Message)
        .filter(Message.conversation_id == chat_id)
        .order_by(Message.created_at)
        .all()
    )
    return [
        MessageSchema(
            id=msg_db.id,
            conversation_id=msg_db.conversation_id,
            sender=msg_db.sender,
            content=strip_attachment_ingestion_content(msg_db.content),
            timestamp=msg_db.timestamp,
            found_answer=msg_db.found_answer,
            attachments=[_serialize_attachment(attachment) for attachment in msg_db.attachments],
        )
        for msg_db in messages_db
    ]


@app.get("/api/chats/{chat_id}/active-ticket")
async def get_active_ticket_for_chat(
    chat_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    chat_db = db.query(Conversation).filter(Conversation.id == chat_id, Conversation.user_id == current_user.id).first()
    if not chat_db:
        raise HTTPException(status_code=404, detail="Chat not found")

    active_ticket = (
        db.query(Ticket)
        .filter(Ticket.conversation_id == chat_id, Ticket.status.notin_(["resolved", "closed"]))
        .order_by(Ticket.created_at.desc())
        .first()
    )

    if not active_ticket:
        return {"active": False, "ticket_reference": None}

    return {"active": True, "ticket_reference": active_ticket.reference_code}


def _can_access_attachment(attachment: MessageAttachment, current_user: User, db: Session) -> bool:
    if current_user.role == "admin":
        return True

    if attachment.ticket_message_id:
        ticket_message = db.query(TicketMessage).filter(TicketMessage.id == attachment.ticket_message_id).first()
        if not ticket_message:
            return False
        ticket = db.query(Ticket).filter(Ticket.id == ticket_message.ticket_id).first()
        if not ticket:
            return False
        if current_user.role == "student" and ticket.student_id == current_user.id:
            return True
        if current_user.role == "ar_staff" and ticket.assigned_to == current_user.id:
            return True
        return False

    if attachment.message_id:
        message = db.query(Message).filter(Message.id == attachment.message_id).first()
        if not message:
            return False
        conversation = db.query(Conversation).filter(Conversation.id == message.conversation_id).first()
        if conversation and conversation.user_id == current_user.id:
            return True
        if current_user.role == "ar_staff":
            linked_ticket = (
                db.query(Ticket)
                .filter(Ticket.conversation_id == message.conversation_id, Ticket.assigned_to == current_user.id)
                .order_by(Ticket.created_at.desc())
                .first()
            )
            return linked_ticket is not None
        return False

    return False


@app.get("/api/attachments/{attachment_id}/download")
async def download_attachment(
    attachment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attachment = db.query(MessageAttachment).filter(MessageAttachment.id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not _can_access_attachment(attachment, current_user, db):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not os.path.exists(attachment.stored_path):
        raise HTTPException(status_code=404, detail="Attachment file is missing")
    return FileResponse(
        attachment.stored_path,
        media_type=attachment.content_type or "application/octet-stream",
        filename=attachment.original_filename,
    )


@app.get("/api/attachments/{attachment_id}/view")
async def view_attachment(
    attachment_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    attachment = db.query(MessageAttachment).filter(MessageAttachment.id == attachment_id).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not _can_access_attachment(attachment, current_user, db):
        raise HTTPException(status_code=403, detail="Not allowed")
    if not os.path.exists(attachment.stored_path):
        raise HTTPException(status_code=404, detail="Attachment file is missing")
    return FileResponse(
        attachment.stored_path,
        media_type=attachment.content_type or "application/pdf",
        filename=attachment.original_filename,
        content_disposition_type="inline",
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

from app.ar.routes import router as ar_router
from app.feedback.routes import router as feedback_router
from app.tickets.routes import router as tickets_router

app.include_router(
    ar_router,
    prefix="/api/ar",
    tags=["AR Staff"]
)

app.include_router(feedback_router)


from app.reinforcement.routes import router as reinforcement_router

app.include_router(
    reinforcement_router,
    prefix="/api",
    tags=["Reinforcement"]
)


from app.admin.routes import router as admin_router

app.include_router(
    admin_router,
    prefix="/api/admin",
    tags=["Admin"]
)

app.include_router(tickets_router)
