from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class TicketSummary(BaseModel):
    id: int
    reference_code: str
    status: str
    created_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class TicketResolutionRequest(BaseModel):
    actions_taken: str
    resolution_summary: str


class MessageOut(BaseModel):
    id: int
    conversation_id: int
    sender: str
    content: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
