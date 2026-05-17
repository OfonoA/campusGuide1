from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class TicketSummary(BaseModel):
    id: int
    reference_code: str
    status: str
    created_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    preview_text: Optional[str] = None
    student_identifier: Optional[str] = None
    assignment_area: Optional[str] = None
    assignment_area_confidence: Optional[float] = None
    assignment_area_reason: Optional[str] = None

    class Config:
        from_attributes = True


class TicketResolutionRequest(BaseModel):
    actions_taken: Optional[str] = None
    resolution_summary: Optional[str] = None


class MessageOut(BaseModel):
    id: int
    conversation_id: int
    sender: str
    content: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
