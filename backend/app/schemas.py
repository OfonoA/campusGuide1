from datetime import datetime
from typing import List, Optional, Tuple

from pydantic import BaseModel

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


class TokenUser(BaseModel):
    id: int
    username: str
    role: str
    name: Optional[str] = None
    email: Optional[str] = None


class TokenResponse(BaseModel):
    token: str
    token_type: str
    refresh_token: Optional[str] = None
    user: Optional[TokenUser] = None


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None

class Chat(BaseModel):
    id: int
    user_id: int
    title: Optional[str]
    created_at: datetime

    class Config:
       from_attributes = True

class AttachmentOut(BaseModel):
    id: int
    original_filename: str
    content_type: Optional[str] = None
    file_size_bytes: int
    download_url: str
    view_url: str

    class Config:
        from_attributes = True


class Message(BaseModel):
    id: int
    conversation_id: int
    sender: str
    content: str
    timestamp: datetime
    found_answer: Optional[bool] = None
    attachments: List[AttachmentOut] = []

    class Config:
        from_attributes = True


class FeedbackRequest(BaseModel):
    satisfactory: bool
    request_in_person: Optional[bool] = False


class FeedbackResponse(BaseModel):
    message: str
    ticket_reference: Optional[str] = None

    class Config:
        from_attributes = True


class FeedbackVote(BaseModel):
    """Payload for student rating of a bot message.
    This endpoint is not used for training — it's only an escalation signal.
    """
    satisfactory: bool


class TicketResponse(BaseModel):
    id: int
    reference_code: str

    class Config:
        from_attributes = True


# --- Admin dashboard schemas ---
class AdminTicket(BaseModel):
    ticket_id: int
    reference_code: str
    student_id: int
    student_username: Optional[str]
    status: str
    false_generated: bool = False
    exclude_from_ingestion: bool = False
    recommended_officer_id: Optional[int] = None
    recommended_officer_username: Optional[str] = None
    recommendation_score: Optional[float] = None
    recommendation_reason: Optional[str] = None
    recommendation_created_at: Optional[datetime] = None
    auto_assigned: bool = False
    assignment_reviewed: bool = False
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


class AdminDocumentItem(BaseModel):
    id: int
    source: Optional[str]
    title: Optional[str]
    source_reference: Optional[str]
    source_type: Optional[str]
    chunk_count: int = 0
    file_exists: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class ScrapeStatusItem(BaseModel):
    id: int
    source: Optional[str]
    source_url: Optional[str]
    source_type: Optional[str]
    scrape_status: Optional[str]
    last_scraped_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class ScrapeUrlRequest(BaseModel):
    url: str
    force: bool = False


class CrawlRequest(BaseModel):
    seed_url: str = "https://www.must.ac.ug"
    max_pages: int = 1200


class WatchedURLCreate(BaseModel):
    url: str
    label: Optional[str] = None
    frequency_hours: int = 24


class WatchedURLOut(BaseModel):
    id: int
    url: str
    label: Optional[str]
    frequency_hours: int
    last_scraped_at: Optional[datetime]
    is_active: bool
    created_at: datetime
    created_by: Optional[str]

    class Config:
        from_attributes = True


class TicketMessageOut(BaseModel):
    id: int
    ticket_id: int
    sender_alias: str
    sender_role: Optional[str] = None
    content: str
    created_at: datetime
    attachments: List[AttachmentOut] = []

    class Config:
        from_attributes = True


class TicketMessageCreate(BaseModel):
    content: str


class AdminUserItem(BaseModel):
    id: int
    username: str
    role: str
    created_at: datetime

    class Config:
        from_attributes = True


class RoleUpdateRequest(BaseModel):
    role: str


class AdminTicketModerationRequest(BaseModel):
    note: Optional[str] = None


class AssignmentModeUpdateRequest(BaseModel):
    mode: str


class AssignmentModeResponse(BaseModel):
    mode: str


class AdminUserCreateRequest(BaseModel):
    username: str
    password: str
    role: str


class AdminUserDeleteRequest(BaseModel):
    password: str
