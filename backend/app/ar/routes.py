from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
import logging

from app.reinforcement.ingest import run_reinforcement_ingestion
from app.reinforcement.ingest import ingest_feedback_entry

from database.database import get_db
from database.orm_models import (
    Ticket,
    Conversation,
    Message,
    TicketUpdate,
    InPersonAssistance,
    TicketMessage,
)
from app.ar.schemas import (
    TicketSummary,
    TicketResolutionRequest,
    MessageOut
)
from app.schemas import TicketMessageOut
from app.auth import get_current_user
from app.utils import strip_attachment_ingestion_content
from app.schemas import AttachmentOut

router = APIRouter()
logger = logging.getLogger("must.ar")


def _serialize_attachment(attachment) -> AttachmentOut:
    return AttachmentOut(
        id=attachment.id,
        original_filename=attachment.original_filename,
        content_type=attachment.content_type,
        file_size_bytes=attachment.file_size_bytes,
        download_url=f"/api/attachments/{attachment.id}/download",
        view_url=f"/api/attachments/{attachment.id}/view",
    )


def _build_ticket_preview(db: Session, ticket: Ticket) -> str | None:
    latest_student_ticket_message = (
        db.query(TicketMessage)
        .filter(
            TicketMessage.ticket_id == ticket.id,
            TicketMessage.sender_role == "student",
        )
        .order_by(TicketMessage.created_at.desc())
        .first()
    )

    latest_student_conversation_message = None
    if ticket.conversation_id:
        latest_student_conversation_message = (
            db.query(Message)
            .filter(
                Message.conversation_id == ticket.conversation_id,
                Message.sender == "user",
            )
            .order_by(Message.created_at.desc())
            .first()
        )

    candidates = [
        msg
        for msg in [latest_student_ticket_message, latest_student_conversation_message]
        if msg and msg.created_at and msg.content
    ]
    if not candidates:
        return None

    latest_message = max(candidates, key=lambda msg: msg.created_at)
    content = " ".join(strip_attachment_ingestion_content(latest_message.content).split())
    if not content:
        return None
    return content[:117] + "..." if len(content) > 120 else content

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
        Ticket.status.in_(["assigned", "in_progress", "resolved"]),
        Ticket.assigned_to == current_user.id,
    ).all()

    ticket_ids = [ticket.id for ticket in tickets]
    updates_by_ticket: dict[int, dict[str, datetime]] = {}
    if ticket_ids:
        updates = (
            db.query(TicketUpdate)
            .filter(TicketUpdate.ticket_id.in_(ticket_ids))
            .order_by(TicketUpdate.created_at.desc())
            .all()
        )
        for update in updates:
            status_change = update.status_change or ""
            ticket_updates = updates_by_ticket.setdefault(update.ticket_id, {})
            if "->assigned" in status_change and "assigned" not in ticket_updates:
                ticket_updates["assigned"] = update.created_at
            if "->in_progress" in status_change and "in_progress" not in ticket_updates:
                ticket_updates["in_progress"] = update.created_at
            if "->resolved" in status_change and "resolved" not in ticket_updates:
                ticket_updates["resolved"] = update.created_at

    def _ticket_sort_time(ticket: Ticket) -> datetime:
        ticket_updates = updates_by_ticket.get(ticket.id, {})
        if ticket.status == "assigned":
            return ticket_updates.get("assigned") or ticket.created_at
        if ticket.status == "in_progress":
            return ticket_updates.get("in_progress") or ticket.created_at
        if ticket.status == "resolved":
            return ticket.resolved_at or ticket_updates.get("resolved") or ticket.created_at
        return ticket.created_at

    tickets.sort(key=_ticket_sort_time, reverse=True)

    return [
        TicketSummary(
            id=ticket.id,
            reference_code=ticket.reference_code,
            status=ticket.status,
            created_at=ticket.created_at,
            resolved_at=ticket.resolved_at,
            preview_text=_build_ticket_preview(db, ticket),
            student_identifier=getattr(ticket.student, "username", None),
            assignment_area=ticket.assignment_area,
            assignment_area_confidence=ticket.assignment_area_confidence,
            assignment_area_reason=ticket.assignment_area_reason,
        )
        for ticket in tickets
    ]


@router.get("/tickets/{ticket_id}/conversation", response_model=list[TicketMessageOut])
def get_ticket_conversation(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    require_ar_staff(current_user)

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if ticket.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Not assigned to this ticket")

    ticket_messages = db.query(TicketMessage).filter(
        TicketMessage.ticket_id == ticket.id
    ).order_by(TicketMessage.created_at).all()

    convo_messages = []
    if ticket.conversation_id:
        convo_messages = db.query(Message).filter(
            Message.conversation_id == ticket.conversation_id
        ).order_by(Message.created_at).all()

    def _alias(role: str) -> str:
        return f"Student-{ticket.reference_code}" if role == "student" else f"Officer-{ticket.reference_code}"

    combined = []

    for m in convo_messages:
        combined.append(
            TicketMessageOut(
                id=-m.id,
                ticket_id=ticket.id,
                sender_alias="ArASSIST" if m.sender == "bot" else f"Student-{ticket.reference_code}",
                sender_role="bot" if m.sender == "bot" else "student",
                content=strip_attachment_ingestion_content(m.content),
                created_at=m.created_at,
                attachments=[_serialize_attachment(attachment) for attachment in m.attachments],
            )
        )

    for m in ticket_messages:
        role = "ar_staff" if m.sender_role == "officer" else m.sender_role
        combined.append(
            TicketMessageOut(
                id=m.id,
                ticket_id=m.ticket_id,
                sender_alias=_alias(m.sender_role),
                sender_role=role,
                content=strip_attachment_ingestion_content(m.content),
                created_at=m.created_at,
                attachments=[_serialize_attachment(attachment) for attachment in m.attachments],
            )
        )

    combined.sort(key=lambda x: x.created_at)
    return combined

@router.post("/tickets/{ticket_id}/start", response_model=TicketSummary)
def start_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    """Move a ticket from assigned -> in_progress."""
    require_ar_staff(current_user)

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if ticket.status != "assigned":
        raise HTTPException(status_code=400, detail=f"Ticket must be 'assigned' to start (current: '{ticket.status}')")
    if ticket.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="Not assigned to this ticket")

    ticket.status = "in_progress"
    db.add(ticket)
    db.commit()

    db.add(
        TicketUpdate(
            ticket_id=ticket.id,
            updated_by=current_user.id,
            note="Ticket moved to in_progress",
            status_change="assigned->in_progress",
        )
    )
    db.commit()
    db.refresh(ticket)

    return TicketSummary.from_orm(ticket)

@router.post("/tickets/{ticket_id}/resolve", response_model=TicketSummary)
def resolve_ticket(
    ticket_id: int,
    payload: TicketResolutionRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user)
):
    print(
        f"[resolve] entered ticket_id={ticket_id} user_id={getattr(current_user, 'id', None)} "
        f"summary_len={len((payload.resolution_summary or '').strip())} "
        f"actions_len={len((payload.actions_taken or '').strip())}",
        flush=True,
    )
    require_ar_staff(current_user)

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        print(f"[resolve] ticket_not_found ticket_id={ticket_id}", flush=True)
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Enforce lifecycle: only tickets currently in 'in_progress' may be resolved.
    # Valid transitions: open -> assigned -> in_progress -> resolved
    if ticket.status != "in_progress":
        print(
            f"[resolve] invalid_status ticket_id={ticket_id} status={ticket.status}",
            flush=True,
        )
        raise HTTPException(status_code=400, detail=f"Ticket must be 'in_progress' to resolve (current: '{ticket.status}')")
    if ticket.assigned_to != current_user.id:
        print(
            f"[resolve] forbidden ticket_id={ticket_id} assigned_to={ticket.assigned_to} user_id={current_user.id}",
            flush=True,
        )
        raise HTTPException(status_code=403, detail="Not assigned to this ticket")

    # Perform DB updates (let the session manage its own transaction)
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
        note=payload.resolution_summary or "Ticket resolved by AR staff",
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

    print(f"[resolve] committing_resolution ticket_id={ticket.id}", flush=True)
    db.commit()
    print(f"[resolve] committed_resolution ticket_id={ticket.id}", flush=True)

    # Ingest the full resolved ticket conversation now that resolution is terminal.
    try:
        from app.reinforcement.ingest import ingest_ticket_conversation

        print(
            f"[resolve] ingestion_start ticket_id={ticket.id} conversation_id={ticket.conversation_id}",
            flush=True,
        )
        logger.info(
            "ticket_resolve_ingestion_start ticket_id=%d conversation_id=%s assigned_to=%s",
            ticket.id,
            ticket.conversation_id,
            ticket.assigned_to,
        )
        ingest_result = ingest_ticket_conversation(db, ticket)
        print(
            f"[resolve] ingestion_done ticket_id={ticket.id} result={bool(ingest_result)}",
            flush=True,
        )
        logger.info(
            "ticket_resolve_ingestion_done ticket_id=%d result=%s",
            ticket.id,
            str(bool(ingest_result)).lower(),
        )
    except Exception as e:
        print(f"[resolve] ingestion_error ticket_id={ticket.id} error={e}", flush=True)
        logger.exception("ticket_resolve_ingestion_error ticket_id=%d", ticket.id)
        print(f"Error during ingestion for resolved ticket {ticket.id}: {e}")

    # Refresh the ticket from the DB to ensure returned fields are up-to-date
    try:
        db.refresh(ticket)
    except Exception:
        # If refresh fails for any reason, proceed to return the minimal info
        pass

    print(f"[resolve] returning ticket_id={ticket.id} status={ticket.status}", flush=True)
    # Return concise ticket summary for caller (ticket id, status, reference_code)
    return TicketSummary.from_orm(ticket)
