from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.requests import Request
from fastapi.templating import Jinja2Templates
from typing import Annotated, List, Tuple, Optional

from sqlalchemy import create_engine, Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from sqlalchemy.sql import func

from passlib.hash import bcrypt
from jose import JWTError, jwt
from datetime import datetime, timedelta

from app.models import ChatRequest, ChatResponse, UserCreate, TokenResponse, Chat, Message
from app.database import vector_store_manager
from app.llm import ask_campusguide

# --- Database Setup ---
DATABASE_URL = "sqlite:///./users.db"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    chats = relationship("ChatDB", back_populates="user")

class ChatDB(Base):
    __tablename__ = "chats"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    title = Column(String, nullable=True)
    created_at = Column(DateTime, default=func.now())
    messages = relationship("MessageDB", back_populates="chat")
    user = relationship("User", back_populates="chats")

class MessageDB(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    chat_id = Column(Integer, ForeignKey("chats.id"))
    sender = Column(String)
    content = Column(String)
    timestamp = Column(DateTime, default=func.now())
    chat = relationship("ChatDB", back_populates="messages")

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

db_dependency = Annotated[Session, Depends(get_db)]

# --- Security ---
SECRET_KEY = "Ofono1234."  # Replace with a strong, random key
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"sub": data.get("username")})  # Use username as subject
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(db: db_dependency, authorization: str | None = Header(None)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if authorization is None or not authorization.startswith("Bearer "):
        raise credentials_exception
    token = authorization.split("Bearer ")[1]
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        user = db.query(User).filter(User.username == username).first()
        if user is None:
            raise credentials_exception
        return user
    except JWTError:
        raise credentials_exception

current_user_dependency = Annotated[User, Depends(get_current_user)]
# --- FastAPI App ---
app = FastAPI()
templates = Jinja2Templates(directory="../frontend") # Assuming your HTML files are in a 'frontend' directory

# CORS middleware to allow frontend to communicate
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust to your frontend's origin in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/frontend", StaticFiles(directory="../frontend"), name="frontend")

async def startup_event():
    """Loads the FAISS index when the application starts."""
    print("Startup event triggered: Attempting to load vector store...")
    vector_store_manager.load_or_create_store()
    if vector_store_manager.vector_store:
        print("Vector store loaded successfully during startup.")
    else:
        print("Vector store failed to load during startup.")

app.add_event_handler("startup", startup_event)

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
    access_token_data = {"username": new_user.username}
    access_token = create_access_token(data=access_token_data)
    return TokenResponse(token=access_token, token_type="bearer")

@app.post("/api/login", response_model=TokenResponse)
async def login(user: UserCreate, db: db_dependency):
    db_user = db.query(User).filter(User.username == user.username).first()
    if not db_user or not bcrypt.verify(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    access_token_data = {"username": db_user.username}
    access_token = create_access_token(data=access_token_data)
    return TokenResponse(token=access_token, token_type="bearer")

@app.get("/api/check_auth")
async def check_auth(current_user: current_user_dependency):
    return {"message": "Authenticated"}

@app.post("/api/logout")
async def logout(current_user: current_user_dependency):
    # In a stateless JWT system, the client handles token deletion.
    # You might add server-side invalidation in more complex scenarios.
    return {"message": "Logged out"}

@app.post("/chat/", response_model=ChatResponse)
async def chat(request: ChatRequest, current_user: current_user_dependency, db: db_dependency):
    query = request.query
    chat_history = request.chat_history if request.chat_history else []
    chat_id = request.chat_id

    db_chat = None
    if chat_id:
        db_chat = db.query(ChatDB).filter(ChatDB.id == chat_id, ChatDB.user_id == current_user.id).first()

    if not db_chat:
        # Create a new chat if no active chat or a new conversation
        db_chat = ChatDB(user_id=current_user.id)
        db.add(db_chat)
        db.commit()
        db.refresh(db_chat)

    # Store the user's message
    user_message = MessageDB(chat_id=db_chat.id, sender="user", content=query)
    db.add(user_message)
    db.commit()

    bot_response_content = ask_campusguide(query, chat_history)
    if not bot_response_content:
        bot_response_content = "I'm sorry, I couldn't find an answer to your question. Please try asking something else."

    # Store the bot's response
    bot_message = MessageDB(chat_id=db_chat.id, sender="bot", content=bot_response_content)
    db.add(bot_message)
    db.commit()

    # Attempt to generate a title for the chat if it doesn't have one
    if not db_chat.title:
        # You might want to use the first few words of the user's initial query
        # or a summary generated by the LLM for a more contextual title.
        # For simplicity here, we'll use the first few words of the first message.
        first_message = db.query(MessageDB).filter(MessageDB.chat_id == db_chat.id).order_by(MessageDB.timestamp).first()
        if first_message:
            db_chat.title = first_message.content[:50] + "..."
            db.commit()

    return ChatResponse(response=bot_response_content, chat_id=db_chat.id)

@app.get("/api/chats", response_model=List[Chat])
async def get_chats(current_user: current_user_dependency, db: db_dependency):
    """Returns the chat history for the authenticated user."""
    chats_db = db.query(ChatDB).filter(ChatDB.user_id == current_user.id).order_by(ChatDB.created_at.desc()).all()
    chats_pydantic = []
    for chat_db in chats_db:
        chats_pydantic.append(Chat.from_orm(chat_db))
    return chats_pydantic

@app.get("/api/chats/{chat_id}/messages", response_model=List[Message])
async def get_messages_for_chat(chat_id: int, current_user: current_user_dependency, db: db_dependency):
    """Returns the messages for a specific chat ID for the authenticated user."""
    chat_db = db.query(ChatDB).filter(ChatDB.id == chat_id, ChatDB.user_id == current_user.id).first()
    if not chat_db:
        raise HTTPException(status_code=404, detail="Chat not found")
    messages_db = db.query(MessageDB).filter(MessageDB.chat_id == chat_id).order_by(MessageDB.timestamp).all()
    messages_pydantic = []
    for msg_db in messages_db:
        messages_pydantic.append(Message.from_orm(msg_db))
    return messages_pydantic

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)