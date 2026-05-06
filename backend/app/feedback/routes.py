from fastapi import APIRouter, Depends, HTTPException, status
from datetime import datetime
from sqlalchemy.orm import Session
from database.database import get_db
from database.orm_models import (
    Message,
    Conversation,
    Ticket,
    TicketUpdate,
    StudentFeedback,
    TicketMessage,
)
from app.auth import get_current_user
from app.schemas import FeedbackRequest, FeedbackResponse, TicketResponse
from app.utils import generate_reference_code

router = APIRouter(prefix="/api/chat", tags=["Feedback"])


def _get_active_ticket_for_conversation(db: Session, conversation_id: int) -> Ticket | None:
    return (
        db.query(Ticket)
        .filter(
            Ticket.conversation_id == conversation_id,
            Ticket.status.notin_(["resolved", "closed"]),
        )
        .order_by(Ticket.created_at.desc())
        .first()
    )


@router.post("/{message_id}/feedback", response_model=FeedbackResponse)
def submit_message_feedback(
    message_id: int,
    payload: FeedbackRequest,
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

    # If not satisfactory and the student requests an officer, create a ticket.
    ticket_ref = None
    if payload.request_in_person:
        existing_ticket = _get_active_ticket_for_conversation(db, conversation.id)
        if existing_ticket:
            return FeedbackResponse(
                message="This conversation already has an active officer ticket.",
                ticket_reference=existing_ticket.reference_code,
            )

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
        # End the bot conversation once a ticket is created
        conversation.ended_at = datetime.utcnow()
        db.add(conversation)
        db.commit()

        # Seed ticket conversation with the student's latest message
        last_user_msg = (
            db.query(Message)
            .filter(Message.conversation_id == conversation.id, Message.sender == "user")
            .order_by(Message.created_at.desc())
            .first()
        )
        if last_user_msg:
            db.add(
                TicketMessage(
                    ticket_id=ticket.id,
                    sender_role="student",
                    sender_id=current_user.id,
                    content=last_user_msg.content,
                )
            )
            db.commit()

        update = TicketUpdate(
            ticket_id=ticket.id,
            updated_by=current_user.id,
            note="Student requested to talk to an officer via feedback",
            status_change="open",
        )
        db.add(update)
        db.commit()
        ticket_ref = ticket.reference_code

    # If not satisfactory, frontend may prompt the student to request assistance.
    return FeedbackResponse(
        message="Thanks for the feedback. Would you like to talk to an officer?",
        ticket_reference=ticket_ref,
    )


@router.post("/{conversation_id}/request-officer", response_model=TicketResponse)
def request_officer(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Student-driven explicit request to create a ticket to talk to an officer.

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

    existing_ticket = _get_active_ticket_for_conversation(db, conversation.id)
    if existing_ticket:
        return TicketResponse(id=existing_ticket.id, reference_code=existing_ticket.reference_code)

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
    # End the bot conversation once a ticket is created
    conversation.ended_at = datetime.utcnow()
    db.add(conversation)
    db.commit()

    initial_update = TicketUpdate(
        ticket_id=ticket.id,
        updated_by=current_user.id,
        note="Student requested to talk to an officer",
        status_change="open",
    )
    db.add(initial_update)
    db.commit()

    return TicketResponse(id=ticket.id, reference_code=ticket.reference_code)
