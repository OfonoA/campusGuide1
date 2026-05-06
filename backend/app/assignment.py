from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from database.orm_models import AppSetting, Ticket, TicketUpdate, User

ASSIGNMENT_MODE_KEY = "ticket_assignment_mode"
ASSIGNMENT_MODE_RECOMMEND = "recommend"
ASSIGNMENT_MODE_AUTO_REVIEW = "auto_review"
ASSIGNMENT_MODE_AUTO_ASSIGN = "auto_assign"
ASSIGNMENT_MODES = {
    ASSIGNMENT_MODE_RECOMMEND,
    ASSIGNMENT_MODE_AUTO_REVIEW,
    ASSIGNMENT_MODE_AUTO_ASSIGN,
}


@dataclass
class AssignmentRecommendation:
    officer_id: int
    score: float
    reason: str


def get_assignment_mode(db: Session) -> str:
    setting = db.query(AppSetting).filter(AppSetting.setting_key == ASSIGNMENT_MODE_KEY).first()
    if not setting or setting.value not in ASSIGNMENT_MODES:
        return ASSIGNMENT_MODE_RECOMMEND
    return setting.value


def set_assignment_mode(db: Session, mode: str) -> str:
    normalized = (mode or "").strip().lower()
    if normalized not in ASSIGNMENT_MODES:
        raise ValueError("Invalid assignment mode")

    setting = db.query(AppSetting).filter(AppSetting.setting_key == ASSIGNMENT_MODE_KEY).first()
    if setting is None:
        setting = AppSetting(setting_key=ASSIGNMENT_MODE_KEY, value=normalized)
    else:
        setting.value = normalized
    db.add(setting)
    db.commit()
    return normalized


def recommend_officer_for_ticket(db: Session, ticket: Ticket) -> AssignmentRecommendation | None:
    if not ticket or ticket.false_generated or ticket.exclude_from_ingestion:
        return None

    officers = db.query(User).filter(User.role == "ar_staff").order_by(User.id.asc()).all()
    if not officers:
        return None

    officer_ids = [officer.id for officer in officers]
    active_counts = {
        officer_id: active_count
        for officer_id, active_count in (
            db.query(Ticket.assigned_to, func.count(Ticket.id))
            .filter(
                Ticket.assigned_to.in_(officer_ids),
                Ticket.status.in_(["assigned", "in_progress"]),
            )
            .group_by(Ticket.assigned_to)
            .all()
        )
        if officer_id is not None
    }
    last_assignment_times = {
        officer_id: updated_at
        for officer_id, updated_at in (
            db.query(TicketUpdate.updated_by, func.max(TicketUpdate.created_at))
            .join(Ticket, Ticket.id == TicketUpdate.ticket_id)
            .filter(
                TicketUpdate.updated_by.in_(officer_ids),
                TicketUpdate.status_change.like("%->assigned%"),
            )
            .group_by(TicketUpdate.updated_by)
            .all()
        )
        if officer_id is not None
    }

    ranked_candidates: list[tuple[int, datetime | None, int, AssignmentRecommendation]] = []
    for officer in officers:
        workload = int(active_counts.get(officer.id, 0) or 0)
        last_assigned_at = last_assignment_times.get(officer.id)
        reason_parts = [f"active load {workload}"]
        if isinstance(last_assigned_at, datetime):
            hours_since_last = max((datetime.utcnow() - last_assigned_at).total_seconds() / 3600.0, 0.0)
            reason_parts.append(f"last assigned {int(hours_since_last)}h ago")
        else:
            reason_parts.append("no prior assignments recorded")
        recommendation = AssignmentRecommendation(
            officer_id=officer.id,
            score=float(workload),
            reason=", ".join(reason_parts),
        )
        ranked_candidates.append((workload, last_assigned_at, officer.id, recommendation))

    if not ranked_candidates:
        return None

    ranked_candidates.sort(
        key=lambda item: (
            item[0],
            item[1] if item[1] is not None else datetime.min,
            item[2],
        )
    )
    return ranked_candidates[0][3]


def apply_ticket_recommendation(db: Session, ticket: Ticket) -> AssignmentRecommendation | None:
    recommendation = recommend_officer_for_ticket(db, ticket)
    if recommendation is None:
        ticket.recommended_officer_id = None
        ticket.recommendation_score = None
        ticket.recommendation_reason = None
        ticket.recommendation_created_at = None
    else:
        ticket.recommended_officer_id = recommendation.officer_id
        ticket.recommendation_score = recommendation.score
        ticket.recommendation_reason = recommendation.reason
        ticket.recommendation_created_at = datetime.utcnow()
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return recommendation


def maybe_auto_assign_recommended_ticket(db: Session, ticket: Ticket) -> bool:
    if not ticket or ticket.false_generated or ticket.exclude_from_ingestion:
        return False
    assignment_mode = get_assignment_mode(db)
    if assignment_mode not in {ASSIGNMENT_MODE_AUTO_REVIEW, ASSIGNMENT_MODE_AUTO_ASSIGN}:
        return False
    if ticket.status != "open" or not ticket.recommended_officer_id:
        return False

    ticket.assigned_to = ticket.recommended_officer_id
    ticket.status = "assigned"
    ticket.auto_assigned = True
    ticket.assignment_reviewed = assignment_mode == ASSIGNMENT_MODE_AUTO_ASSIGN
    db.add(ticket)
    db.commit()

    status_change = "open->assigned_auto_review"
    note = "System auto-assigned ticket pending admin review"
    if assignment_mode == ASSIGNMENT_MODE_AUTO_ASSIGN:
        status_change = "open->assigned_auto"
        note = "System auto-assigned ticket"

    db.add(
        TicketUpdate(
            ticket_id=ticket.id,
            updated_by=ticket.recommended_officer_id,
            note=note,
            status_change=status_change,
        )
    )
    db.commit()
    db.refresh(ticket)
    return True
