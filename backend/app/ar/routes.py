from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime

from app.reinforcement.ingest import run_reinforcement_ingestion
from app.reinforcement.ingest import ingest_feedback_entry

from backend.database.database import get_db
from backend.database.orm_models import (
    Ticket,
    Conversation,
    Message,
    TicketUpdate,
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

def require_ar_staff(user):
    if user.role != "ar_staff":
        raise HTTPException(status_code=403, detail="AR staff access only")


@router.get("/tickets", response_model=list[TicketSummary])
def list_open_tickets(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    require_ar_staff(current_user)

    tickets = db.query(Ticket).filter(
        Ticket.status.in_(["open", "in_progress"])
    ).order_by(Ticket.created_at.asc()).all()

    return tickets


@router.get("/tickets/{ticket_id}/conversation", response_model=list[MessageOut])
def get_ticket_conversation(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    require_ar_staff(current_user)

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    messages = db.query(Message).filter(
        Message.conversation_id == ticket.conversation_id
    ).order_by(Message.created_at).all()

    return messages

@router.post("/tickets/{ticket_id}/resolve")
def resolve_ticket(
    ticket_id: int,
    payload: TicketResolutionRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    require_ar_staff(current_user)

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Enforce lifecycle: only tickets currently in 'in_progress' may be resolved
    # Valid transitions: open -> in_progress -> resolved -> closed
    if ticket.status != "in_progress":
        raise HTTPException(status_code=400, detail=f"Ticket must be 'in_progress' to resolve (current: '{ticket.status}')")

    # Perform DB updates within a transaction for atomicity
    with db.begin():
        # 1️⃣ Log in-person assistance
        assistance = InPersonAssistance(
            ticket_id=ticket.id,
            ar_staff_id=current_user.id,
            actions_taken=payload.actions_taken,
            resolution_summary=payload.resolution_summary
        )
        db.add(assistance)

        # 2️⃣ Update ticket (enforce transition and record update)
        previous_status = ticket.status
        ticket.status = "resolved"
        ticket.resolved_at = datetime.utcnow()

        # Record a ticket update entry for audit
        update = TicketUpdate(
            ticket_id=ticket.id,
            updated_by=current_user.id,
            note=payload.resolution_summary,
            status_change=f"{previous_status}->resolved"
        )
        db.add(update)

        # Mark conversation as ended when ticket resolved
        try:
            if ticket.conversation:
                ticket.conversation.ended_at = datetime.utcnow()
        except Exception:
            # safe guard: continue even if relationship not present
            pass

        # 3️⃣ Create or update RLFeedback: record validated answer and mark not yet ingested.
        # If feedback already exists for this ticket, update it; otherwise create a new one.
        feedback = db.query(RLFeedback).filter(RLFeedback.ticket_id == ticket.id).first()
        if feedback:
            feedback.validated_answer = payload.resolution_summary
            feedback.ingested = False
        else:
            feedback = RLFeedback(
                ticket_id=ticket.id,
                validated_answer=payload.resolution_summary,
                ingested=False
            )
            db.add(feedback)

    # 4️⃣ System-controlled ingestion: attempt to ingest this feedback into the RAG
    # Only proceed if resolution text is non-empty and ticket is resolved.
    try:
        if payload.resolution_summary and payload.resolution_summary.strip() and ticket.status == "resolved":
            ingested = ingest_feedback_entry(db, feedback)
            if not ingested:
                print(f"Reinforcement ingestion skipped/failed for feedback id={feedback.id}")
    except Exception as e:
        # Log ingestion errors but do not fail the resolve operation
        print(f"Error during reinforcement ingestion for ticket {ticket.id}: {e}")

    return {"message": "Ticket resolved and logged successfully"}


