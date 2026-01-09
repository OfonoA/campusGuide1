from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from backend.database.database import get_db
from backend.database.orm_models import (
    Message,
    Conversation,
    Ticket,
    TicketUpdate,
    StudentFeedback,
)
from app.auth import get_current_user
from app.schemas import FeedbackVote, FeedbackResponse, TicketResponse
from app.utils import generate_reference_code

router = APIRouter(prefix="/api/chat", tags=["Feedback"])


@router.post("/{message_id}/feedback", response_model=FeedbackResponse)
def submit_message_feedback(
    message_id: int,
    payload: FeedbackVote,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Attach a student rating to a specific bot message.

    - This endpoint only records the student's `satisfactory` boolean.
    - It does NOT trigger any ingestion or training pipeline.
    - Only the conversation owner may attach feedback to messages in that conversation.
    """
    # Ensure message exists
    message = db.query(Message).filter(Message.id == message_id).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    # Only allow rating of bot responses
    if message.sender != "bot":
        raise HTTPException(status_code=400, detail="Only bot messages are rateable")

    # Ensure conversation belongs to the current user
    conversation = db.query(Conversation).filter(Conversation.id == message.conversation_id).first()
    if not conversation or conversation.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not allowed to rate this message")

    # Create or update a lightweight StudentFeedback record (no ingestion)
    existing = db.query(StudentFeedback).filter(StudentFeedback.message_id == message_id).first()
    if existing:
        existing.satisfactory = payload.satisfactory
        existing.student_id = current_user.id
        db.add(existing)
        db.commit()
        db.refresh(existing)
    else:
        sf = StudentFeedback(
            message_id=message_id,
            student_id=current_user.id,
            satisfactory=payload.satisfactory,
        )
        db.add(sf)
        db.commit()
        db.refresh(sf)

    if payload.satisfactory:
        return FeedbackResponse(message="Thank you — glad this helped.")

    # If not satisfactory, frontend may prompt the student to request assistance.
    return FeedbackResponse(message="Thanks for the feedback. Would you like in-person assistance?")


@router.post("/{conversation_id}/request-assistance", response_model=TicketResponse)
def request_in_person_assistance(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Student-driven explicit request to create an in-person assistance ticket.

    - Only users with role `student` may call this endpoint.
    - Tickets are created only by explicit student intent.
    """
    # Role enforcement
    if getattr(current_user, "role", None) != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only students may request assistance")

    # Ensure conversation exists and belongs to the student
    conversation = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conversation or conversation.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Create ticket and initial update inside a transaction
    reference_code = generate_reference_code()
    ticket = Ticket(
        reference_code=reference_code,
        conversation_id=conversation.id,
        student_id=current_user.id,
        status="open",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    initial_update = TicketUpdate(
        ticket_id=ticket.id,
        updated_by=current_user.id,
        note="Student requested in-person assistance",
        status_change="open",
    )
    db.add(initial_update)
    db.commit()

    return TicketResponse(id=ticket.id, reference_code=ticket.reference_code)
