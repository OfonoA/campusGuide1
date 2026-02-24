from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from typing import List
from sqlalchemy.orm import Session

from passlib.hash import bcrypt
from datetime import datetime, timedelta

# --- Pydantic Schemas ---
from app.schemas import (
    ChatRequest,
    ChatResponse,
    UserCreate,
    TokenResponse,
    Chat,
    Message as MessageSchema,
    FeedbackRequest,
    FeedbackResponse,
    TicketResponse,
)

# --- Vector Store ---
from app.vector_store import vector_store_manager
from app.llm import ask_campusguide

# --- Auth ---
from app.auth import create_access_token, get_current_user

# --- Database ---
from database.database import get_db
from database.orm_models import User, Conversation, Message, Ticket
from database.orm_models import RLFeedback, TicketUpdate

# --- Security ---
SECRET_KEY = "Ofono1234."  # Replace with a strong key
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30


def generate_reference_code():
    return f"AR-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"

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
async def signup(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = bcrypt.hash(user.password)
    # Default new users to student role for now
    new_user = User(username=user.username, hashed_password=hashed_password, role="student")
    db.add(new_user)
    db.commit()
    access_token = create_access_token({"username": new_user.username})
    return TokenResponse(token=access_token, token_type="bearer")

@app.post("/api/login", response_model=TokenResponse)
async def login(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if not db_user or not bcrypt.verify(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    access_token = create_access_token({"username": db_user.username})
    return TokenResponse(token=access_token, token_type="bearer")

@app.get("/api/check_auth")
async def check_auth(current_user: User = Depends(get_current_user)):
    return {"message": "Authenticated"}

@app.post("/api/logout")
async def logout(current_user: User = Depends(get_current_user)):
    return {"message": "Logged out"}

@app.post("/chat/", response_model=ChatResponse)
async def chat(request: ChatRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
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
        first_message = (
            db.query(Message)
            .filter(Message.conversation_id == db_chat.id)
            .order_by(Message.created_at)
            .first()
        )
        if first_message:
            db_chat.title = first_message.content[:50] + "..."
            db.commit()

    return ChatResponse(response=bot_response_content, chat_id=db_chat.id, ticket_reference=ticket_ref)


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
    return [MessageSchema.from_orm(msg_db) for msg_db in messages_db]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

from app.ar.routes import router as ar_router
from app.feedback.routes import router as feedback_router

app.include_router(
    ar_router,
    prefix="/api/ar",
    tags=["AR Staff"]
)

app.include_router(feedback_router)


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


from app.admin.routes import router as admin_router

app.include_router(
    admin_router,
    prefix="/api/admin",
    tags=["Admin"]
)
