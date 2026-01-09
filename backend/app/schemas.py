from pydantic import BaseModel
from typing import List, Tuple, Optional
from datetime import datetime

class ChatRequest(BaseModel):
    query: str
    chat_history: Optional[List[Tuple[str, str]]] = None
    chat_id: Optional[int] = None

class ChatResponse(BaseModel):
    response: str
    chat_id: Optional[int] = None  # Make sure ChatResponse also has chat_id if you're returning it
    ticket_reference: Optional[str] = None

class UserCreate(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    token: str
    token_type: str

class Chat(BaseModel):
    id: int
    user_id: int
    title: Optional[str]
    created_at: datetime

    class Config:
       from_attributes = True

class Message(BaseModel):
    id: int
    conversation_id: int
    sender: str
    content: str
    timestamp: datetime

    
    class Config:
        from_attributes = True


class FeedbackRequest(BaseModel):
    message_id: int
    satisfactory: bool
    request_in_person: Optional[bool] = False


class FeedbackResponse(BaseModel):
    message: str
    ticket_reference: Optional[str] = None

    class Config:
        orm_mode = True


