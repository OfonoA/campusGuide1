from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
import os

from sqlalchemy import func
from sqlalchemy.orm import Session

from database.orm_models import AppSetting, Message, Ticket, TicketMessage, TicketUpdate, User

try:
    from openai import OpenAI
except Exception:  # pragma: no cover - dependency availability varies by environment
    OpenAI = None  # type: ignore[assignment]

ASSIGNMENT_MODE_KEY = "ticket_assignment_mode"
ASSIGNMENT_MODE_RECOMMEND = "recommend"
ASSIGNMENT_MODE_AUTO_REVIEW = "auto_review"
ASSIGNMENT_MODE_AUTO_ASSIGN = "auto_assign"
ASSIGNMENT_MODES = {
    ASSIGNMENT_MODE_RECOMMEND,
    ASSIGNMENT_MODE_AUTO_REVIEW,
    ASSIGNMENT_MODE_AUTO_ASSIGN,
}

ASSIGNMENT_AREA_ADMISSIONS = "admissions_records_alumni_engagement"
ASSIGNMENT_AREA_DOCUMENTS = "documents"
ASSIGNMENT_AREA_RESULTS = "results"
ASSIGNMENT_AREA_TEACHING = "teaching_and_learning"
ASSIGNMENT_AREA_GENERAL = "general"
ASSIGNMENT_AREAS = {
    ASSIGNMENT_AREA_ADMISSIONS,
    ASSIGNMENT_AREA_DOCUMENTS,
    ASSIGNMENT_AREA_RESULTS,
    ASSIGNMENT_AREA_TEACHING,
    ASSIGNMENT_AREA_GENERAL,
}
ASSIGNMENT_AREA_LABELS = {
    ASSIGNMENT_AREA_ADMISSIONS: "Admissions, Records & Alumni Engagement",
    ASSIGNMENT_AREA_DOCUMENTS: "Documents",
    ASSIGNMENT_AREA_RESULTS: "Results",
    ASSIGNMENT_AREA_TEACHING: "Teaching and Learning",
    ASSIGNMENT_AREA_GENERAL: "General",
}
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
ASSIGNMENT_CLASSIFIER_MODEL = os.getenv("OPENAI_ASSIGNMENT_CLASSIFIER_MODEL", "gpt-4o-mini")
OPENAI_REQUEST_TIMEOUT_SECONDS = float(os.getenv("OPENAI_REQUEST_TIMEOUT_SECONDS", "20"))
ASSIGNMENT_CLASSIFIER_SYSTEM_PROMPT = """You classify student support tickets for MUST assignment routing.

Choose exactly one assignment area from this list:
- admissions_records_alumni_engagement
- documents
- results
- teaching_and_learning
- general

Rules:
- Use the conversation text only.
- Return exactly one area.
- If the request is mixed, choose the primary operational area.
- If unclear, broad, or not strongly tied to one of the four specialist areas, choose general.
- Do not answer the student.
- Do not mention officers or assignment policy.

Return valid JSON only:
{
  "area": "general",
  "confidence": 0.0,
  "reason": "short explanation"
}
"""
_openai_client: OpenAI | None = OpenAI(api_key=OPENAI_API_KEY) if OpenAI is not None and OPENAI_API_KEY else None


@dataclass
class AssignmentRecommendation:
    officer_id: int
    score: float
    reason: str


@dataclass
class AssignmentRoutingDecision:
    area: str
    confidence: float
    reason: str


def normalize_assignment_areas(areas: list[str] | tuple[str, ...] | set[str] | None) -> list[str]:
    normalized: list[str] = []
    for area in list(areas or []):
        value = str(area or "").strip().lower()
        if value in ASSIGNMENT_AREAS and value not in normalized:
            normalized.append(value)
    return normalized


def serialize_assignment_areas(areas: list[str] | tuple[str, ...] | set[str] | None) -> str:
    return ",".join(normalize_assignment_areas(areas))


def parse_assignment_areas(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []
    return normalize_assignment_areas(raw_value.split(","))


def get_user_assignment_areas(user: User) -> list[str]:
    areas = parse_assignment_areas(getattr(user, "assignment_areas", None))
    if not areas and getattr(user, "role", None) == "ar_staff":
        return [ASSIGNMENT_AREA_GENERAL]
    return areas


def _collect_ticket_routing_text(db: Session, ticket: Ticket, max_messages: int = 8) -> str:
    parts: list[str] = []

    ticket_messages = (
        db.query(TicketMessage)
        .filter(TicketMessage.ticket_id == ticket.id, TicketMessage.sender_role == "student")
        .order_by(TicketMessage.created_at.desc())
        .limit(max_messages)
        .all()
    )
    if ticket_messages:
        parts.extend(str(message.content or "").strip() for message in reversed(ticket_messages) if message.content)

    if ticket.conversation_id:
        conversation_messages = (
            db.query(Message)
            .filter(Message.conversation_id == ticket.conversation_id, Message.sender == "user")
            .order_by(Message.created_at.desc())
            .limit(max_messages)
            .all()
        )
        parts.extend(str(message.content or "").strip() for message in reversed(conversation_messages) if message.content)

    seen: list[str] = []
    for part in parts:
        if part and part not in seen:
            seen.append(part)
    return "\n".join(seen)


def _get_openai_client() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        if OpenAI is None or not OPENAI_API_KEY:
            raise RuntimeError("OpenAI client is not configured")
        _openai_client = OpenAI(api_key=OPENAI_API_KEY)
    return _openai_client


def _classify_ticket_area_with_llm(text: str) -> AssignmentRoutingDecision:
    client = _get_openai_client()
    response = client.chat.completions.create(
        model=ASSIGNMENT_CLASSIFIER_MODEL,
        messages=[
            {"role": "system", "content": ASSIGNMENT_CLASSIFIER_SYSTEM_PROMPT},
            {"role": "user", "content": f"Conversation text:\n{text}"},
        ],
        temperature=0,
        response_format={"type": "json_object"},
        timeout=OPENAI_REQUEST_TIMEOUT_SECONDS,
    )
    content = response.choices[0].message.content
    if not content:
        raise ValueError("Empty assignment classifier response")

    payload = json.loads(content)
    if not isinstance(payload, dict):
        raise ValueError("Assignment classifier response must be a JSON object")

    area = str(payload.get("area") or "").strip().lower()
    if area not in ASSIGNMENT_AREAS:
        raise ValueError("Assignment classifier returned an invalid area")

    try:
        confidence = float(payload.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(confidence, 1.0))

    reason = str(payload.get("reason") or "").strip() or f"Classified as {ASSIGNMENT_AREA_LABELS[area]}."
    return AssignmentRoutingDecision(area=area, confidence=confidence, reason=reason)


def classify_ticket_area(db: Session, ticket: Ticket) -> AssignmentRoutingDecision:
    text = _collect_ticket_routing_text(db, ticket)
    if not str(text or "").strip():
        return AssignmentRoutingDecision(
            area=ASSIGNMENT_AREA_GENERAL,
            confidence=0.2,
            reason="No student message was available for routing; defaulted to General.",
        )

    try:
        return _classify_ticket_area_with_llm(text)
    except Exception:
        return AssignmentRoutingDecision(
            area=ASSIGNMENT_AREA_GENERAL,
            confidence=0.35,
            reason="LLM classification failed or was inconclusive; routed to General.",
        )


def update_ticket_assignment_area(db: Session, ticket: Ticket) -> AssignmentRoutingDecision | None:
    if not ticket or ticket.false_generated or ticket.exclude_from_ingestion:
        ticket.assignment_area = None
        ticket.assignment_area_confidence = None
        ticket.assignment_area_reason = None
        db.add(ticket)
        db.commit()
        db.refresh(ticket)
        return None

    routing = classify_ticket_area(db, ticket)
    ticket.assignment_area = routing.area
    ticket.assignment_area_confidence = routing.confidence
    ticket.assignment_area_reason = routing.reason
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return routing


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


def recommend_officer_for_ticket(
    db: Session,
    ticket: Ticket,
    routing: AssignmentRoutingDecision | None = None,
) -> AssignmentRecommendation | None:
    if not ticket or ticket.false_generated or ticket.exclude_from_ingestion:
        return None

    routing = routing or classify_ticket_area(db, ticket)

    officers = (
        db.query(User)
        .filter(User.role == "ar_staff", User.is_available.is_(True))
        .order_by(User.id.asc())
        .all()
    )
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

    area_matches = [officer for officer in officers if routing.area in get_user_assignment_areas(officer)]
    general_matches = [officer for officer in officers if ASSIGNMENT_AREA_GENERAL in get_user_assignment_areas(officer)]
    eligible_officers = area_matches or general_matches or officers
    fallback_reason = "matched officer capabilities"
    if not area_matches and general_matches:
        fallback_reason = "fell back to General-capable officers"
    elif not area_matches and not general_matches:
        fallback_reason = "fell back to all available AR staff"

    ranked_candidates: list[tuple[int, int, float, datetime | None, int, AssignmentRecommendation]] = []
    for officer in eligible_officers:
        workload = int(active_counts.get(officer.id, 0) or 0)
        max_load = getattr(officer, "max_concurrent_load", None)
        over_capacity = 1 if max_load is not None and workload >= max_load else 0
        priority_weight = float(getattr(officer, "priority_weight", 1.0) or 1.0)
        last_assigned_at = last_assignment_times.get(officer.id)

        reason_parts = [
            f"area={routing.area}",
            routing.reason,
            fallback_reason,
            f"active load {workload}",
        ]
        if max_load is not None:
            reason_parts.append(f"max load {max_load}")
        reason_parts.append(f"priority {priority_weight:.1f}")
        if isinstance(last_assigned_at, datetime):
            hours_since_last = max((datetime.utcnow() - last_assigned_at).total_seconds() / 3600.0, 0.0)
            reason_parts.append(f"last assigned {int(hours_since_last)}h ago")
        else:
            reason_parts.append("no prior assignments recorded")

        recommendation = AssignmentRecommendation(
            officer_id=officer.id,
            score=float(workload + over_capacity),
            reason=", ".join(reason_parts),
        )
        ranked_candidates.append((over_capacity, workload, -priority_weight, last_assigned_at, officer.id, recommendation))

    if not ranked_candidates:
        return None

    ranked_candidates.sort(
        key=lambda item: (
            item[0],
            item[1],
            item[2],
            item[3] if item[3] is not None else datetime.min,
            item[4],
        )
    )
    return ranked_candidates[0][5]


def apply_ticket_recommendation(db: Session, ticket: Ticket) -> AssignmentRecommendation | None:
    routing = update_ticket_assignment_area(db, ticket)
    recommendation = recommend_officer_for_ticket(db, ticket, routing=routing)
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
    if routing is None:
        ticket.assignment_area = None
        ticket.assignment_area_confidence = None
        ticket.assignment_area_reason = None
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
