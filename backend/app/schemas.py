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


class FeedbackVote(BaseModel):
    """Payload for student rating of a bot message.
    This endpoint is not used for training — it's only an escalation signal.
    """
    satisfactory: bool


class TicketResponse(BaseModel):
    id: int
    reference_code: str

    class Config:
        orm_mode = True


# --- Admin dashboard schemas ---
class AdminTicket(BaseModel):
    ticket_id: int
    reference_code: str
    student_id: int
    student_username: Optional[str]
    status: str
    ar_assigned_id: Optional[int]
    ar_assigned_username: Optional[str]
    created_at: datetime
    resolved_at: Optional[datetime]

    class Config:
        from_attributes = True


class IngestionStatusItem(BaseModel):
    id: int
    ticket_id: Optional[int]
    validated_answer_snippet: Optional[str]
    ingested: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ARActivityItem(BaseModel):
    ar_id: int
    ar_username: Optional[str]
    tickets_resolved: int
    last_activity: Optional[datetime]

    class Config:
        from_attributes = True


