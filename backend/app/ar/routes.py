from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime

from app.reinforcement.ingest import run_reinforcement_ingestion

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

    # Ensure valid state transition
    if ticket.status in ("resolved", "closed"):
        raise HTTPException(status_code=400, detail=f"Cannot resolve ticket in status '{ticket.status}'")

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

    # 3️⃣ Store RL feedback (validated knowledge)
    feedback = RLFeedback(
        ticket_id=ticket.id,
        validated_answer=payload.resolution_summary,
        confidence="high"
    )
    db.add(feedback)

    db.commit()

    # Trigger reinforcement ingestion for high-confidence feedback (synchronous)
    try:
        run_reinforcement_ingestion(db)
    except Exception as e:
        # log and continue
        print(f"Reinforcement ingestion failed: {e}")

    return {"message": "Ticket resolved and logged successfully"}


