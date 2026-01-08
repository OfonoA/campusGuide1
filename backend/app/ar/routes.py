from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database.database import get_db
from database.orm_models import (
    Ticket,
    Conversation,
    Message,
    InPersonAssistance,
    RLFeedback
)
from app.ar.schemas import (
    TicketSummary,
    TicketResolutionRequest,
    MessageOut
)
from app.auth import get_current_user

router = APIRouter()
