from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.requests import Request
from typing import Annotated, List

from passlib.hash import bcrypt
from jose import JWTError, jwt
from datetime import datetime, timedelta

# --- Pydantic Schemas ---
from app.schemas import ChatRequest, ChatResponse, UserCreate, TokenResponse, Chat, Message

# --- Vector Store ---
from app.vector_store import vector_store_manager
from app.llm import ask_campusguide

# --- Database ---
from backend.database.database import SessionLocal
from backend.database.orm_models import User, Conversation, Message

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

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"sub": data.get("username"), "exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

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
        if not username:
            raise credentials_exception
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise credentials_exception
        return user
    except JWTError:
        raise credentials_exception

current_user_dependency = Annotated[User, Depends(get_current_user)]

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

    bot_response_content = ask_campusguide(query, chat_history) or \
        "I'm sorry, I couldn't find an answer. Please try asking something else."

    bot_message = Message(conversation_id=db_chat.id, sender="bot", content=bot_response_content)
    db.add(bot_message)
    db.commit()

    if not db_chat.title:
        first_message = db.query(Message).filter(Message.conversation_id == db_chat.id).order_by(Message.timestamp).first()
        if first_message:
            db_chat.title = first_message.content[:50] + "..."
            db.commit()

    return ChatResponse(response=bot_response_content, chat_id=db_chat.id)

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
