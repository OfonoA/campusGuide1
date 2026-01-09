from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.requests import Request
from typing import Annotated, List

from passlib.hash import bcrypt
from datetime import datetime, timedelta

# --- Pydantic Schemas ---
from app.schemas import ChatRequest, ChatResponse, UserCreate, TokenResponse, Chat, Message

# --- Vector Store ---
from app.vector_store import vector_store_manager
from app.llm import ask_campusguide

# --- Auth ---
from app.auth import create_access_token, current_user_dependency

# --- Database ---
from backend.database.database import SessionLocal
from backend.database.orm_models import User, Conversation, Message, Ticket
from backend.database.orm_models import RLFeedback, TicketUpdate

# --- DB Dependency ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

db_dependency = Annotated[SessionLocal, Depends(get_db)]

# --- Security ---
SECRET_KEY = "Ofono1234."  # Replace with a strong key
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
def generate_reference_code():
    return f"AR-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"

# current_user_dependency imported from app.auth

# --- FastAPI App ---
app = FastAPI()
templates = Jinja2Templates(directory="../frontend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/frontend", StaticFiles(directory="../frontend"), name="frontend")

async def startup_event():
    print("Startup: Loading vector store...")
    vector_store_manager.load_or_create_store()
    if vector_store_manager.vector_store:
        print("Vector store loaded successfully")
    else:
        print("Vector store failed to load")

app.add_event_handler("startup", startup_event)

# --- Routes ---
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/login", response_class=HTMLResponse)
async def get_login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})

@app.get("/signup", response_class=HTMLResponse)
async def get_signup_page(request: Request):
    return templates.TemplateResponse("signup.html", {"request": request})

@app.post("/api/signup", response_model=TokenResponse)
async def signup(user: UserCreate, db: db_dependency):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = bcrypt.hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    access_token = create_access_token({"username": new_user.username})
    return TokenResponse(token=access_token, token_type="bearer")

@app.post("/api/login", response_model=TokenResponse)
async def login(user: UserCreate, db: db_dependency):
    db_user = db.query(User).filter(User.username == user.username).first()
    if not db_user or not bcrypt.verify(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    access_token = create_access_token({"username": db_user.username})
    return TokenResponse(token=access_token, token_type="bearer")

@app.get("/api/check_auth")
async def check_auth(current_user: current_user_dependency):
    return {"message": "Authenticated"}

@app.post("/api/logout")
async def logout(current_user: current_user_dependency):
    return {"message": "Logged out"}

@app.post("/chat/", response_model=ChatResponse)
async def chat(request: ChatRequest, current_user: current_user_dependency, db: db_dependency):
    query = request.query
    chat_history = request.chat_history or []
    chat_id = request.chat_id

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

    user_message = Message(conversation_id=db_chat.id, sender="user", content=query)
    db.add(user_message)
    db.commit()

    llm_error = False
    try:
        bot_response_content = ask_campusguide(query, chat_history) or ""
        if not bot_response_content:
            raise ValueError("Empty LLM response")
    except Exception as e:
        print(f"LLM error for query '{query}': {e}")
        bot_response_content = "I'm sorry, I couldn't find an answer. Please try asking something else."
        llm_error = True

    bot_message = Message(conversation_id=db_chat.id, sender="bot", content=bot_response_content)
    db.add(bot_message)
    db.commit()

    # If bot couldn't find an answer, auto-create a ticket and return reference
    ticket_ref = None
    fallback_strings = [
        "I'm sorry, I couldn't find an answer",
        "couldn't find an answer",
        "I couldn't find an answer"
    ]
    if llm_error or any(s in bot_response_content for s in fallback_strings):
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

    if not db_chat.title:
        first_message = db.query(Message).filter(Message.conversation_id == db_chat.id).order_by(Message.timestamp).first()
        if first_message:
            db_chat.title = first_message.content[:50] + "..."
            db.commit()

    return ChatResponse(response=bot_response_content, chat_id=db_chat.id, ticket_reference=ticket_ref)


@app.post("/api/chat/feedback", response_model=FeedbackResponse)
def submit_chat_feedback(payload: FeedbackRequest, current_user: current_user_dependency, db: db_dependency):
    """Accept explicit user feedback for a specific bot message.

    Rules enforced here:
    - Feedback only allowed for messages that belong to a conversation owned by the current user.
    - Only applies to bot messages (sender == 'bot').
    - Only one feedback submission allowed per bot message (enforced via RLFeedback.message_id unique column).

    Behavior:
    - If satisfactory: return success, no RLFeedback or ticket created.
    - If not satisfactory: create RLFeedback (confidence='medium') linked to the message.
      If request_in_person is True, create a Ticket and a TicketUpdate and attach ticket_id to the RLFeedback.
    """

    # 1) Validate message exists and is a bot message
    bot_msg = db.query(Message).filter(Message.id == payload.message_id).first()
    if not bot_msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if bot_msg.sender != "bot":
        raise HTTPException(status_code=400, detail="Feedback can only be submitted for bot messages")

    # 2) Ensure the conversation belongs to the current user
    conv = db.query(Conversation).filter(Conversation.id == bot_msg.conversation_id).first()
    if not conv or conv.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You are not authorized to submit feedback on this message")

    # 3) Prevent duplicate feedback for same message
    existing = db.query(RLFeedback).filter(RLFeedback.message_id == payload.message_id).first()
    if existing:
        raise HTTPException(status_code=409, detail="Feedback for this message already submitted")

    # If user indicated the response was satisfactory — do nothing further
    if payload.satisfactory:
        return FeedbackResponse(message="Thanks for your feedback. We're glad it helped.")

    # 4) Create RLFeedback record with confidence 'medium'
    feedback = RLFeedback(
        message_id=payload.message_id,
        ticket_id=None,
        validated_answer=bot_msg.content,
        confidence="medium",
        ingested=False
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)

    ticket_ref = None
    # 5) If user asked for in-person assistance, create Ticket and TicketUpdate and link to the feedback
    if payload.request_in_person:
        ticket_ref = f"AR-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"
        ticket = Ticket(
            reference_code=ticket_ref,
            conversation_id=conv.id,
            student_id=current_user.id,
            status="open"
        )
        db.add(ticket)
        db.commit()
        db.refresh(ticket)

        # Create initial ticket update record
        initial_update = TicketUpdate(
            ticket_id=ticket.id,
            updated_by=current_user.id,
            note="Ticket created from user feedback",
            status_change="created->open"
        )
        db.add(initial_update)

        # Link ticket to the existing RLFeedback
        feedback.ticket_id = ticket.id
        db.commit()

    return FeedbackResponse(
        message="Thank you — your feedback has been recorded.",
        ticket_reference=ticket_ref
    )

@app.get("/api/chats", response_model=List[Chat])
async def get_chats(current_user: current_user_dependency, db: db_dependency):
    chats_db = db.query(Conversation).filter(Conversation.user_id == current_user.id).order_by(Conversation.created_at.desc()).all()
    return [Chat.from_orm(chat_db) for chat_db in chats_db]

@app.get("/api/chats/{chat_id}/messages", response_model=List[Message])
async def get_messages_for_chat(chat_id: int, current_user: current_user_dependency, db: db_dependency):
    chat_db = db.query(Conversation).filter(Conversation.id == chat_id, Conversation.user_id == current_user.id).first()
    if not chat_db:
        raise HTTPException(status_code=404, detail="Chat not found")
    messages_db = db.query(Message).filter(Message.conversation_id == chat_id).order_by(Message.timestamp).all()
    return [Message.from_orm(msg_db) for msg_db in messages_db]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

from app.ar.routes import router as ar_router

app.include_router(
    ar_router,
    prefix="/api/ar",
    tags=["AR Staff"]
)


from app.feedback.routes import router as feedback_router

app.include_router(
    feedback_router,
    prefix="/api",
    tags=["Feedback"]
)


from app.reinforcement.routes import router as reinforcement_router

app.include_router(
    reinforcement_router,
    prefix="/api",
    tags=["Reinforcement"]
)
