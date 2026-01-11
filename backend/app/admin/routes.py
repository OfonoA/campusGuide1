from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func, and_
from typing import List

from backend.database.database import get_db
from backend.database.orm_models import Ticket, User, InPersonAssistance, RLFeedback
from app.auth import get_current_user
from app.schemas import AdminTicket, IngestionStatusItem, ARActivityItem

router = APIRouter()


def require_admin(user: User):
    if not user or user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


@router.get("/tickets", response_model=List[AdminTicket])
def tickets_overview(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return an overview of all tickets with student info and (if any) assigned AR staff.

    Uses a subquery to fetch the latest `InPersonAssistance` per ticket to determine an assigned AR.
    """
    require_admin(current_user)

    # Subquery to get the latest in_person_assistance id per ticket
    latest_subq = (
        db.query(InPersonAssistance.ticket_id.label("ticket_id"), func.max(InPersonAssistance.id).label("max_id"))
        .group_by(InPersonAssistance.ticket_id)
        .subquery()
    )

    LastAssist = aliased(InPersonAssistance, name="last_assist")
    Student = aliased(User, name="student_user")
    ARUser = aliased(User, name="ar_user")

    # Join tickets -> student, left join to latest in-person assist and that assist's AR user
    q = (
        db.query(Ticket, Student, ARUser, LastAssist)
        .outerjoin(Student, Ticket.student)
        .outerjoin(latest_subq, latest_subq.c.ticket_id == Ticket.id)
        .outerjoin(LastAssist, and_(LastAssist.ticket_id == Ticket.id, LastAssist.id == latest_subq.c.max_id))
        .outerjoin(ARUser, LastAssist.ar_staff_id == ARUser.id)
        .order_by(Ticket.created_at.desc())
    )

    results = []
    for ticket, student, ar_user, last_assist in q.all():
        results.append(
            AdminTicket(
                ticket_id=ticket.id,
                reference_code=ticket.reference_code,
                student_id=getattr(student, "id", None),
                student_username=getattr(student, "username", None),
                status=ticket.status,
                ar_assigned_id=getattr(ar_user, "id", None),
                ar_assigned_username=getattr(ar_user, "username", None),
                created_at=ticket.created_at,
                resolved_at=ticket.resolved_at,
            )
        )

    return results


@router.get("/ingestion-status", response_model=List[IngestionStatusItem])
def ingestion_status(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """List RLFeedback records and ingestion flags for auditing the RAG ingestion pipeline."""
    require_admin(current_user)

    feedbacks = db.query(RLFeedback).order_by(RLFeedback.created_at.desc()).all()
    items = []
    for fb in feedbacks:
        snippet = (fb.validated_answer[:200] + "...") if fb.validated_answer and len(fb.validated_answer) > 200 else fb.validated_answer
        items.append(
            IngestionStatusItem(
                id=fb.id,
                ticket_id=fb.ticket_id,
                validated_answer_snippet=snippet,
                ingested=bool(fb.ingested),
                created_at=fb.created_at,
            )
        )

    return items


@router.get("/ar-activity", response_model=List[ARActivityItem])
def ar_activity(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return per-AR staff activity: tickets resolved count and last activity timestamp.

    We aggregate `InPersonAssistance` records grouped by `ar_staff_id` for efficiency.
    """
    require_admin(current_user)

    # Aggregate counts and last activity per AR staff
    agg = (
        db.query(
            InPersonAssistance.ar_staff_id.label("ar_id"),
            func.count(InPersonAssistance.id).label("tickets_resolved"),
            func.max(InPersonAssistance.created_at).label("last_activity"),
        )
        .group_by(InPersonAssistance.ar_staff_id)
        .subquery()
    )

    ARUser = aliased(User)

    q = db.query(agg.c.ar_id, ARUser.username, agg.c.tickets_resolved, agg.c.last_activity).outerjoin(ARUser, ARUser.id == agg.c.ar_id)

    results = []
    for ar_id, username, tickets_resolved, last_activity in q.all():
        results.append(
            ARActivityItem(ar_id=ar_id, ar_username=username, tickets_resolved=tickets_resolved, last_activity=last_activity)
        )

    return results
