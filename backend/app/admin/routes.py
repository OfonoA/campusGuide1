from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime, timedelta
from collections import Counter, defaultdict
import csv
import io
import os
import re
from uuid import uuid4

from database.database import get_db, SessionLocal
from database.orm_models import (
    AppSetting,
    Ticket,
    User,
    InPersonAssistance,
    RLFeedback,
    RAGDocument,
    DocumentChunk,
    TicketUpdate,
    Conversation,
    Message,
    StudentFeedback,
    TicketMessage,
    RefreshToken,
    WatchedURL,
)
from app.auth import get_current_user
from app.assignment import (
    ASSIGNMENT_MODE_AUTO_REVIEW,
    ASSIGNMENT_MODE_RECOMMEND,
    ASSIGNMENT_MODE_AUTO_ASSIGN,
    ASSIGNMENT_AREAS,
    ASSIGNMENT_AREA_GENERAL,
    apply_ticket_recommendation,
    get_user_assignment_areas,
    get_assignment_mode,
    maybe_auto_assign_recommended_ticket,
    normalize_assignment_areas,
    serialize_assignment_areas,
    set_assignment_mode,
)
from app.schemas import (
    AdminTicket,
    AssignmentModeResponse,
    AssignmentModeUpdateRequest,
    AdminTicketModerationRequest,
    IngestionStatusItem,
    ARActivityItem,
    AdminDocumentItem,
    AdminUserItem,
    RoleUpdateRequest,
    AdminUserCreateRequest,
    AdminUserAssignmentProfileUpdateRequest,
    AdminUserDeleteRequest,
    ScrapeStatusItem,
    ScrapeUrlRequest,
    CrawlRequest,
    WatchedURLCreate,
    WatchedURLOut,
    StaffPerformanceOverviewResponse,
    StaffPerformanceOverviewStats,
    StaffPerformanceRow,
    StaffPerformanceDetailResponse,
    StaffPerformanceTicketDetail,
    ConversationAnalyticsResponse,
    AnalyticsOverviewStats,
    AnalyticsTrendPoint,
    AnalyticsTopicRow,
    AnalyticsHotspotRow,
    AnalyticsNoAnswerArea,
    AnalyticsGapRow,
    AnalyticsUnansweredExample,
    AnalyticsFollowUpInsight,
)
from passlib.hash import bcrypt
from app.bm25_store import reset_bm25_corpus
from app.vector_store import vector_store_manager
from app.scraper.ingest_web import WebIngestionService
from app.scraper.crawler import MUSTCrawler
from app.scraper.scheduler import HIGH_CHURN_URLS, MEDIUM_CHURN_URLS, LOW_CHURN_URLS
import shutil
router = APIRouter()
RESPONSE_SLA_HOURS = 4.0
RESOLUTION_SLA_DAYS = 3.0
TOPIC_RULES = [
    ("Fees", ["fee", "fees", "tuition", "payment", "invoice", "bank slip"]),
    ("Admissions", ["admission", "admissions", "apply", "application", "entry requirements"]),
    ("Scholarships", ["scholarship", "bursary", "funding"]),
    ("Dead Year", ["dead year", "defer", "deferred semester"]),
    ("Transcript", ["transcript", "academic record", "certified copy"]),
    ("PRN", ["prn", "payment reference", "reference number"]),
    ("Registration", ["registration", "register", "late registration"]),
    ("Exams", ["exam", "exams", "coursework", "retake"]),
]
GAP_DOCUMENT_SUGGESTIONS = {
    "Fees": "Add fees_2026.pdf",
    "Admissions": "Update admissions_faq.md",
    "Scholarships": "Add scholarships_calendar.pdf",
    "Dead Year": "Create dead_year_policy.md",
    "Transcript": "Update transcript_faq.md",
    "PRN": "Update prn_troubleshooting.md",
    "Registration": "Update registration_guide.md",
    "Exams": "Add exam_regulations_summary.pdf",
    "General": "Add student_support_faq.md",
}


def _admin_user_item(user: User) -> AdminUserItem:
    return AdminUserItem(
        id=user.id,
        username=user.username,
        role=user.role,
        created_at=user.created_at,
        last_active_at=user.last_active_at,
        assignment_areas=get_user_assignment_areas(user) if user.role == "ar_staff" else [],
        max_concurrent_load=user.max_concurrent_load,
        is_available=bool(getattr(user, "is_available", True)),
        priority_weight=float(getattr(user, "priority_weight", 1.0) or 1.0),
    )


def _apply_assignment_profile_to_user(
    user: User,
    assignment_areas: list[str] | None,
    max_concurrent_load: int | None,
    is_available: bool,
    priority_weight: float,
) -> None:
    normalized_areas = normalize_assignment_areas(assignment_areas)
    if normalized_areas and any(area not in ASSIGNMENT_AREAS for area in normalized_areas):
        raise HTTPException(status_code=400, detail="Invalid assignment areas")
    if max_concurrent_load is not None and max_concurrent_load < 1:
        raise HTTPException(status_code=400, detail="max_concurrent_load must be at least 1")
    if priority_weight <= 0:
        raise HTTPException(status_code=400, detail="priority_weight must be greater than 0")

    if user.role == "ar_staff":
        if not normalized_areas:
            normalized_areas = [ASSIGNMENT_AREA_GENERAL]
        user.assignment_areas = serialize_assignment_areas(normalized_areas)
        user.max_concurrent_load = max_concurrent_load
        user.is_available = bool(is_available)
        user.priority_weight = float(priority_weight)
        return

    user.assignment_areas = ""
    user.max_concurrent_load = None
    user.is_available = True
    user.priority_weight = 1.0


def _classify_topic(text: str | None) -> str:
    normalized = (text or "").strip().lower()
    for topic, keywords in TOPIC_RULES:
        if any(keyword in normalized for keyword in keywords):
            return topic
    return "General"


def _normalize_query(text: str | None) -> str:
    normalized = re.sub(r"[^a-z0-9\s]", " ", (text or "").lower())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _label_hour(hour: int) -> str:
    if hour == 0:
        return "12am"
    if hour < 12:
        return f"{hour}am"
    if hour == 12:
        return "12pm"
    return f"{hour - 12}pm"


def _window_days(window_start: datetime, window_end: datetime) -> int:
    return max(int((window_end - window_start).total_seconds() // 86400), 1)


def _build_daily_points(records: list[dict], window_start: datetime, window_end: datetime) -> list[AnalyticsTrendPoint]:
    counts = Counter(record["created_at"].strftime("%d %b") for record in records)
    points: list[AnalyticsTrendPoint] = []
    cursor = window_start
    while cursor < window_end:
        label = cursor.strftime("%d %b")
        points.append(AnalyticsTrendPoint(label=label, value=counts.get(label, 0)))
        cursor += timedelta(days=1)
    return points


def _build_weekly_points(records: list[dict], window_start: datetime, window_end: datetime) -> list[AnalyticsTrendPoint]:
    week_counts: dict[tuple[int, int], int] = defaultdict(int)
    for record in records:
        iso_year, iso_week, _ = record["created_at"].isocalendar()
        week_counts[(iso_year, iso_week)] += 1

    points: list[AnalyticsTrendPoint] = []
    cursor = window_start
    seen: set[tuple[int, int]] = set()
    while cursor < window_end:
        iso_year, iso_week, _ = cursor.isocalendar()
        key = (iso_year, iso_week)
        if key not in seen:
            seen.add(key)
            points.append(AnalyticsTrendPoint(label=f"Wk {iso_week}", value=week_counts.get(key, 0)))
        cursor += timedelta(days=7)
    return points


def _build_monthly_points(records: list[dict], window_start: datetime, window_end: datetime) -> list[AnalyticsTrendPoint]:
    month_counts: dict[tuple[int, int], int] = defaultdict(int)
    for record in records:
        month_counts[(record["created_at"].year, record["created_at"].month)] += 1

    points: list[AnalyticsTrendPoint] = []
    year = window_start.year
    month = window_start.month
    end_key = (window_end.year, window_end.month)
    while (year, month) <= end_key:
        label = datetime(year, month, 1).strftime("%b")
        points.append(AnalyticsTrendPoint(label=label, value=month_counts.get((year, month), 0)))
        if month == 12:
            year += 1
            month = 1
        else:
            month += 1
    return points


def _build_conversation_analytics_payload(
    db: Session,
    range_key: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> ConversationAnalyticsResponse:
    window_start, window_end = _resolve_performance_window(range_key, start_date, end_date)
    previous_start = window_start - (window_end - window_start)

    student_ids = [user.id for user in db.query(User).filter(User.role == "student").all()]
    if not student_ids:
        return ConversationAnalyticsResponse(
            overview=AnalyticsOverviewStats(
                total_questions=0,
                answered=0,
                answered_rate=0,
                unanswered=0,
                unanswered_rate=0,
                escalation_rate=0,
                helpful_rate=0,
                kb_coverage=0,
            ),
            trends={"daily": [], "weekly": [], "monthly": []},
            peak_hours=[],
            peak_days=[],
            topics=[],
            hotspots=[],
            feedback={"helpful": 0, "notHelpful": 0},
            no_answer_areas=[],
            gaps=[],
            unanswered_examples=[],
            follow_up_insights=[],
        )

    conversations = db.query(Conversation).filter(Conversation.user_id.in_(student_ids)).all()
    conversation_ids = [conversation.id for conversation in conversations]
    conversation_user_map = {conversation.id: conversation.user_id for conversation in conversations}

    all_messages = (
        db.query(Message)
        .filter(
            Message.conversation_id.in_(conversation_ids),
            Message.created_at >= previous_start,
            Message.created_at < window_end,
        )
        .order_by(Message.conversation_id.asc(), Message.created_at.asc(), Message.id.asc())
        .all()
    ) if conversation_ids else []

    all_tickets = (
        db.query(Ticket)
        .filter(
            Ticket.conversation_id.in_(conversation_ids),
            Ticket.created_at >= previous_start,
            Ticket.created_at < window_end,
        )
        .all()
    ) if conversation_ids else []

    feedback_rows = (
        db.query(StudentFeedback, Message)
        .join(Message, StudentFeedback.message_id == Message.id)
        .filter(
            Message.conversation_id.in_(conversation_ids),
            StudentFeedback.created_at >= window_start,
            StudentFeedback.created_at < window_end,
        )
        .all()
    ) if conversation_ids else []
    feedback_by_message_id = {feedback.message_id: feedback for feedback, _message in feedback_rows}

    tickets_by_conversation: dict[int, list[Ticket]] = defaultdict(list)
    for ticket in all_tickets:
        tickets_by_conversation[ticket.conversation_id].append(ticket)

    grouped_messages: dict[int, list[Message]] = defaultdict(list)
    for message in all_messages:
        grouped_messages[message.conversation_id].append(message)

    current_records: list[dict] = []
    previous_records: list[dict] = []

    for conversation_id, messages in grouped_messages.items():
        next_bot: Message | None = None
        next_bot_map: dict[int, Message | None] = {}
        for message in reversed(messages):
            if message.sender == "bot":
                next_bot = message
            elif message.sender == "user":
                next_bot_map[message.id] = next_bot

        conversation_tickets = tickets_by_conversation.get(conversation_id, [])
        for message in messages:
            if message.sender != "user":
                continue

            created_at = message.created_at
            if created_at is None or created_at < previous_start or created_at >= window_end:
                continue

            next_bot_message = next_bot_map.get(message.id)
            escalated = any(
                ticket.created_at and ticket.created_at >= created_at
                for ticket in conversation_tickets
            )
            answered = bool(next_bot_message and next_bot_message.found_answer)
            record = {
                "query": (message.content or "").strip(),
                "created_at": created_at,
                "conversation_id": conversation_id,
                "student_id": conversation_user_map.get(conversation_id),
                "bot_message_id": next_bot_message.id if next_bot_message else None,
                "topic": _classify_topic(message.content),
                "normalized_query": _normalize_query(message.content),
                "answered": answered,
                "unanswered": not answered,
                "escalated": escalated,
            }
            if created_at >= window_start:
                current_records.append(record)
            else:
                previous_records.append(record)

    total_questions = len(current_records)
    answered_count = sum(1 for record in current_records if record["answered"])
    unanswered_count = total_questions - answered_count
    escalated_count = sum(1 for record in current_records if record["escalated"])
    kb_coverage_count = sum(1 for record in current_records if record["answered"] and not record["escalated"])

    feedback_helpful = sum(1 for feedback, _message in feedback_rows if feedback.satisfactory)
    feedback_not_helpful = sum(1 for feedback, _message in feedback_rows if not feedback.satisfactory)
    implicit_helpful = sum(
        1
        for record in current_records
        if record["answered"]
        and not record["escalated"]
        and (
            record["bot_message_id"] is None
            or feedback_by_message_id.get(record["bot_message_id"]) is None
            or feedback_by_message_id[record["bot_message_id"]].satisfactory
        )
    )
    inferred_helpful = max(feedback_helpful, implicit_helpful)
    feedback_total = inferred_helpful + feedback_not_helpful

    current_topic_records: dict[str, list[dict]] = defaultdict(list)
    previous_topic_records: dict[str, list[dict]] = defaultdict(list)
    for record in current_records:
        current_topic_records[record["topic"]].append(record)
    for record in previous_records:
        previous_topic_records[record["topic"]].append(record)

    topics: list[AnalyticsTopicRow] = []
    for topic, records in sorted(current_topic_records.items(), key=lambda item: len(item[1]), reverse=True):
        volume = len(records)
        topics.append(
            AnalyticsTopicRow(
                topic=topic,
                volume=volume,
                share=round((volume / total_questions) * 100, 1) if total_questions else 0.0,
                escalation_rate=round((sum(1 for record in records if record["escalated"]) / volume) * 100) if volume else 0,
                answer_rate=round((sum(1 for record in records if record["answered"]) / volume) * 100) if volume else 0,
            )
        )

    normalized_groups: dict[str, list[dict]] = defaultdict(list)
    for record in current_records:
        if record["normalized_query"]:
            normalized_groups[record["normalized_query"]].append(record)

    hotspots: list[AnalyticsHotspotRow] = []
    for normalized_query, records in sorted(
        normalized_groups.items(),
        key=lambda item: (
            (sum(1 for record in item[1] if record["escalated"]) / len(item[1])) if item[1] else 0,
            len(item[1]),
        ),
        reverse=True,
    ):
        escalated = sum(1 for record in records if record["escalated"])
        if escalated == 0:
            continue
        sample_query = next((record["query"] for record in records if record["query"]), normalized_query)
        hotspots.append(
            AnalyticsHotspotRow(
                query=sample_query[:160],
                escalation_rate=round((escalated / len(records)) * 100),
                tickets=escalated,
            )
        )
        if len(hotspots) == 5:
            break

    no_answer_areas = [
        AnalyticsNoAnswerArea(topic=topic, count=sum(1 for record in records if record["unanswered"]))
        for topic, records in sorted(
            current_topic_records.items(),
            key=lambda item: sum(1 for record in item[1] if record["unanswered"]),
            reverse=True,
        )
        if any(record["unanswered"] for record in records)
    ][:5]

    gaps = [
        AnalyticsGapRow(
            area=item.topic,
            failed_query=next(
                (record["query"] for record in current_topic_records[item.topic] if record["unanswered"] and record["query"]),
                f"Students need more guidance on {item.topic.lower()}",
            )[:180],
            suggested_document=GAP_DOCUMENT_SUGGESTIONS.get(item.topic, GAP_DOCUMENT_SUGGESTIONS["General"]),
        )
        for item in no_answer_areas[:3]
    ]

    unanswered_examples = [
        AnalyticsUnansweredExample(query=record["query"][:180])
        for record in sorted(
            [record for record in current_records if record["unanswered"] and record["query"]],
            key=lambda item: item["created_at"],
            reverse=True,
        )[:10]
    ]

    current_escalation_by_topic = {
        topic: sum(1 for record in records if record["escalated"])
        for topic, records in current_topic_records.items()
    }
    previous_escalation_by_topic = {
        topic: sum(1 for record in records if record["escalated"])
        for topic, records in previous_topic_records.items()
    }
    follow_up_insights: list[AnalyticsFollowUpInsight] = []
    for topic, tickets in sorted(current_escalation_by_topic.items(), key=lambda item: item[1], reverse=True):
        if tickets <= 0:
            continue
        previous_tickets = previous_escalation_by_topic.get(topic, 0)
        if previous_tickets > 0:
            delta = round(((tickets - previous_tickets) / previous_tickets) * 100)
        else:
            delta = 100 if tickets > 0 else 0
        follow_up_insights.append(AnalyticsFollowUpInsight(topic=topic, tickets=tickets, delta=delta))
        if len(follow_up_insights) == 5:
            break

    hour_counter = Counter(record["created_at"].hour for record in current_records)
    peak_hours = [
        AnalyticsTrendPoint(label=_label_hour(hour), value=count)
        for hour, count in hour_counter.most_common(8)
    ]

    weekday_order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    weekday_counter = Counter(record["created_at"].strftime("%a") for record in current_records)
    peak_days = [
        AnalyticsTrendPoint(label=day, value=weekday_counter.get(day, 0))
        for day in weekday_order
    ]

    return ConversationAnalyticsResponse(
        overview=AnalyticsOverviewStats(
            total_questions=total_questions,
            answered=answered_count,
            answered_rate=round((answered_count / total_questions) * 100) if total_questions else 0,
            unanswered=unanswered_count,
            unanswered_rate=round((unanswered_count / total_questions) * 100) if total_questions else 0,
            escalation_rate=round((escalated_count / total_questions) * 100) if total_questions else 0,
            helpful_rate=round((inferred_helpful / feedback_total) * 100) if feedback_total else 0,
            kb_coverage=round((kb_coverage_count / total_questions) * 100) if total_questions else 0,
        ),
        trends={
            "daily": _build_daily_points(current_records, window_start, window_end),
            "weekly": _build_weekly_points(current_records, window_start, window_end),
            "monthly": _build_monthly_points(current_records, window_start, window_end),
        },
        peak_hours=peak_hours,
        peak_days=peak_days,
        topics=topics[:8],
        hotspots=hotspots,
        feedback={"helpful": inferred_helpful, "notHelpful": feedback_not_helpful},
        no_answer_areas=no_answer_areas,
        gaps=gaps,
        unanswered_examples=unanswered_examples,
        follow_up_insights=follow_up_insights,
    )


def _resolve_performance_window(range_key: str, start_date: Optional[str], end_date: Optional[str]) -> tuple[datetime, datetime]:
    now = datetime.utcnow()
    normalized = (range_key or "30").strip().lower()
    if normalized == "custom":
        if not start_date or not end_date:
            raise HTTPException(status_code=400, detail="Custom range requires both start_date and end_date")
        try:
            start = datetime.fromisoformat(start_date)
            end = datetime.fromisoformat(end_date) + timedelta(days=1)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid custom date format") from exc
        if start >= end:
            raise HTTPException(status_code=400, detail="start_date must be earlier than end_date")
        return start, end

    if normalized == "7":
        return now - timedelta(days=7), now
    if normalized == "90":
        return now - timedelta(days=90), now
    return now - timedelta(days=30), now


def _ticket_assignment_times(db: Session, ticket_ids: list[int]) -> dict[int, datetime]:
    if not ticket_ids:
        return {}

    updates = (
        db.query(TicketUpdate)
        .filter(
            TicketUpdate.ticket_id.in_(ticket_ids),
            TicketUpdate.status_change.like("%->assigned%"),
        )
        .order_by(TicketUpdate.created_at.asc())
        .all()
    )
    assignment_times: dict[int, datetime] = {}
    for update in updates:
        assignment_times.setdefault(update.ticket_id, update.created_at)
    return assignment_times


def _ticket_first_response_times(db: Session, ticket_ids: list[int]) -> dict[int, datetime]:
    if not ticket_ids:
        return {}

    response_times: dict[int, datetime] = {}

    message_rows = (
        db.query(TicketMessage.ticket_id, func.min(TicketMessage.created_at))
        .filter(
            TicketMessage.ticket_id.in_(ticket_ids),
            TicketMessage.sender_role.in_(["ar_staff", "officer"]),
        )
        .group_by(TicketMessage.ticket_id)
        .all()
    )
    for ticket_id, created_at in message_rows:
        if ticket_id is not None and created_at is not None:
            response_times[ticket_id] = created_at

    start_rows = (
        db.query(TicketUpdate.ticket_id, func.min(TicketUpdate.created_at))
        .filter(
            TicketUpdate.ticket_id.in_(ticket_ids),
            TicketUpdate.status_change.like("%->in_progress%"),
        )
        .group_by(TicketUpdate.ticket_id)
        .all()
    )
    for ticket_id, created_at in start_rows:
        if ticket_id is None or created_at is None:
            continue
        existing = response_times.get(ticket_id)
        if existing is None or created_at < existing:
            response_times[ticket_id] = created_at

    return response_times


def _build_staff_performance_payload(
    db: Session,
    range_key: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> tuple[StaffPerformanceOverviewResponse, dict[int, list[StaffPerformanceTicketDetail]]]:
    window_start, window_end = _resolve_performance_window(range_key, start_date, end_date)

    staff_users = db.query(User).filter(User.role == "ar_staff").order_by(User.username.asc()).all()
    tickets = (
        db.query(Ticket)
        .filter(Ticket.assigned_to.is_not(None))
        .all()
    )

    ticket_ids = [ticket.id for ticket in tickets]
    assignment_times = _ticket_assignment_times(db, ticket_ids)
    first_response_times = _ticket_first_response_times(db, ticket_ids)
    student_ids = {ticket.student_id for ticket in tickets if ticket.student_id is not None}
    students_by_id = {}
    if student_ids:
        students_by_id = {
            user.id: user.username
            for user in db.query(User).filter(User.id.in_(student_ids)).all()
        }

    rows: list[StaffPerformanceRow] = []
    detail_map: dict[int, list[StaffPerformanceTicketDetail]] = {}
    response_durations: list[float] = []
    resolution_durations: list[float] = []
    sla_total = 0
    sla_met = 0

    for staff in staff_users:
        staff_tickets = [ticket for ticket in tickets if ticket.assigned_to == staff.id]
        relevant_tickets = []
        for ticket in staff_tickets:
            assigned_at = assignment_times.get(ticket.id) or ticket.created_at
            resolved_at = ticket.resolved_at
            in_window = (
                (assigned_at and window_start <= assigned_at < window_end) or
                (resolved_at and window_start <= resolved_at < window_end)
            )
            if in_window:
                relevant_tickets.append(ticket)

        assigned_count = len(relevant_tickets)
        not_started_count = sum(1 for ticket in relevant_tickets if ticket.status == "assigned")
        in_progress_count = sum(1 for ticket in relevant_tickets if ticket.status == "in_progress")
        resolved_count = sum(
            1
            for ticket in relevant_tickets
            if ticket.status == "resolved" and ticket.resolved_at and window_start <= ticket.resolved_at < window_end
        )

        staff_response_durations: list[float] = []
        staff_resolution_durations: list[float] = []
        staff_breaches = 0
        detail_rows: list[StaffPerformanceTicketDetail] = []

        for ticket in relevant_tickets:
            assigned_at = assignment_times.get(ticket.id) or ticket.created_at
            first_response_at = first_response_times.get(ticket.id)
            response_hours = None
            resolution_days = None

            if assigned_at and first_response_at and first_response_at >= assigned_at:
                response_hours = (first_response_at - assigned_at).total_seconds() / 3600.0
                staff_response_durations.append(response_hours)
                response_durations.append(response_hours)
                sla_total += 1
                if response_hours <= RESPONSE_SLA_HOURS:
                    sla_met += 1
                else:
                    staff_breaches += 1

            if assigned_at and ticket.resolved_at and ticket.resolved_at >= assigned_at:
                resolution_days = (ticket.resolved_at - assigned_at).total_seconds() / 86400.0
                staff_resolution_durations.append(resolution_days)
                resolution_durations.append(resolution_days)
                sla_total += 1
                if resolution_days <= RESOLUTION_SLA_DAYS:
                    sla_met += 1
                else:
                    staff_breaches += 1

            detail_rows.append(
                StaffPerformanceTicketDetail(
                    ticket_id=ticket.id,
                    reference_code=ticket.reference_code,
                    student_username=students_by_id.get(ticket.student_id),
                    status=ticket.status,
                    assigned_date=assigned_at,
                    response_time_hours=response_hours,
                    resolution_time_days=resolution_days,
                )
            )

        detail_rows.sort(
            key=lambda item: item.assigned_date or datetime.min,
            reverse=True,
        )
        detail_map[staff.id] = detail_rows

        rows.append(
            StaffPerformanceRow(
                staff_id=staff.id,
                staff_username=staff.username,
                assigned=assigned_count,
                not_started=not_started_count,
                in_progress=in_progress_count,
                resolved_30d=resolved_count,
                avg_response_time_hours=(sum(staff_response_durations) / len(staff_response_durations)) if staff_response_durations else None,
                avg_resolution_time_days=(sum(staff_resolution_durations) / len(staff_resolution_durations)) if staff_resolution_durations else None,
                sla_breaches=staff_breaches,
            )
        )

    overview = StaffPerformanceOverviewResponse(
        stats=StaffPerformanceOverviewStats(
            total_tickets=sum(row.assigned for row in rows),
            avg_response_time_hours=(sum(response_durations) / len(response_durations)) if response_durations else None,
            avg_resolution_time_days=(sum(resolution_durations) / len(resolution_durations)) if resolution_durations else None,
            sla_compliance_percent=((sla_met / sla_total) * 100.0) if sla_total else None,
        ),
        rows=rows,
    )
    return overview, detail_map


def _performance_range_label(range_key: str, start_date: Optional[str], end_date: Optional[str]) -> str:
    normalized = (range_key or "30").strip().lower()
    if normalized == "custom" and start_date and end_date:
        return f"Custom ({start_date} to {end_date})"
    if normalized == "7":
        return "Last 7 days"
    if normalized == "90":
        return "Last 90 days"
    return "Last 30 days"


def _performance_export_filename(extension: str) -> str:
    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    return f"staff_performance_analytics_{stamp}.{extension}"


def _analytics_export_filename(extension: str) -> str:
    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    return f"conversation_analytics_{stamp}.{extension}"


def _crawl_task(seed_url: str, max_pages: int) -> None:
    with SessionLocal() as session:
        crawler = MUSTCrawler(session, max_pages=max_pages, seed_urls=[seed_url])
        html_urls, pdf_urls = crawler.crawl()
        service = WebIngestionService(session)
        if html_urls or pdf_urls:
            service.ingest_batch(html_urls + pdf_urls)


def require_admin(user: User):
    if not user or user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


def require_admin_or_ar(user: User):
    if not user or user.role not in {"admin", "ar_staff"}:
        raise HTTPException(status_code=403, detail="Admin or AR staff required")
    return user


@router.get("/performance", response_model=StaffPerformanceOverviewResponse)
def performance_overview(
    range_key: str = Query("30"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    overview, _ = _build_staff_performance_payload(db, range_key, start_date, end_date)
    return overview


@router.get("/analytics", response_model=ConversationAnalyticsResponse)
def conversation_analytics(
    range_key: str = Query("30"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    return _build_conversation_analytics_payload(db, range_key, start_date, end_date)


@router.get("/performance/export/csv")
def performance_export_csv(
    range_key: str = Query("30"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    overview, _ = _build_staff_performance_payload(db, range_key, start_date, end_date)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Staff Performance Analytics"])
    writer.writerow(["Range", _performance_range_label(range_key, start_date, end_date)])
    writer.writerow(["Generated At (UTC)", datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")])
    writer.writerow([])
    writer.writerow(["Total Tickets", overview.stats.total_tickets])
    writer.writerow(["Avg Response Time (hrs)", round(overview.stats.avg_response_time_hours, 2) if overview.stats.avg_response_time_hours is not None else ""])
    writer.writerow(["Avg Resolution Time (days)", round(overview.stats.avg_resolution_time_days, 2) if overview.stats.avg_resolution_time_days is not None else ""])
    writer.writerow(["Response Target Compliance (%)", round(overview.stats.sla_compliance_percent, 2) if overview.stats.sla_compliance_percent is not None else ""])
    writer.writerow([])
    writer.writerow([
        "Staff",
        "Assigned",
        "Not Started",
        "In Progress",
        "Resolved (30d)",
        "Avg Response Time (hrs)",
        "Avg Resolution Time (days)",
        "Target Breaches",
    ])

    for row in overview.rows:
        writer.writerow([
            row.staff_username,
            row.assigned,
            row.not_started,
            row.in_progress,
            row.resolved_30d,
            round(row.avg_response_time_hours, 2) if row.avg_response_time_hours is not None else "",
            round(row.avg_resolution_time_days, 2) if row.avg_resolution_time_days is not None else "",
            row.sla_breaches,
        ])

    payload = io.BytesIO(output.getvalue().encode("utf-8"))
    headers = {
        "Content-Disposition": f'attachment; filename="{_performance_export_filename("csv")}"'
    }
    return StreamingResponse(payload, media_type="text/csv; charset=utf-8", headers=headers)


@router.get("/performance/export/pdf")
def performance_export_pdf(
    range_key: str = Query("30"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    overview, _ = _build_staff_performance_payload(db, range_key, start_date, end_date)

    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import landscape, letter
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Spacer, Paragraph, Table, TableStyle
    except ModuleNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail="PDF export requires the 'reportlab' package to be installed on the backend.",
        ) from exc

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(letter),
        leftMargin=0.45 * inch,
        rightMargin=0.45 * inch,
        topMargin=0.45 * inch,
        bottomMargin=0.45 * inch,
    )
    styles = getSampleStyleSheet()
    story = [
        Paragraph("Staff Performance Analytics", styles["Title"]),
        Spacer(1, 8),
        Paragraph(f"Range: {_performance_range_label(range_key, start_date, end_date)}", styles["Normal"]),
        Paragraph(f"Generated At (UTC): {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}", styles["Normal"]),
        Spacer(1, 10),
    ]

    summary_data = [
        ["Total Tickets", str(overview.stats.total_tickets)],
        ["Avg Response Time", f"{overview.stats.avg_response_time_hours:.1f} hrs" if overview.stats.avg_response_time_hours is not None else "-"],
        ["Avg Resolution Time", f"{overview.stats.avg_resolution_time_days:.1f} days" if overview.stats.avg_resolution_time_days is not None else "-"],
        ["Response Target Compliance", f"{overview.stats.sla_compliance_percent:.0f}%" if overview.stats.sla_compliance_percent is not None else "-"],
    ]
    summary_table = Table(summary_data, colWidths=[2.5 * inch, 2.2 * inch])
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F0F2F5")),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#333333")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D9D9D9")),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story.extend([summary_table, Spacer(1, 14)])

    table_data = [[
        "Staff",
        "Assigned",
        "Not Started",
        "In Progress",
        "Resolved (30d)",
        "Avg Response Time",
        "Avg Resolution Time",
        "Target Breaches",
    ]]
    for row in overview.rows:
        table_data.append([
            row.staff_username,
            str(row.assigned),
            str(row.not_started),
            str(row.in_progress),
            str(row.resolved_30d),
            f"{row.avg_response_time_hours:.1f} hrs" if row.avg_response_time_hours is not None else "-",
            f"{row.avg_resolution_time_days:.1f} days" if row.avg_resolution_time_days is not None else "-",
            str(row.sla_breaches),
        ])

    detail_table = Table(
        table_data,
        repeatRows=1,
        colWidths=[1.25 * inch, 0.8 * inch, 0.95 * inch, 0.95 * inch, 1.1 * inch, 1.35 * inch, 1.45 * inch, 0.95 * inch],
    )
    detail_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F0F2F5")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0D5C45")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#333333")),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor("#D9D9D9")),
        ("LINEBELOW", (0, 1), (-1, -1), 0.35, colors.HexColor("#E6E6E6")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAFA")]),
        ("PADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(detail_table)

    document.build(story)
    buffer.seek(0)
    headers = {
        "Content-Disposition": f'attachment; filename="{_performance_export_filename("pdf")}"'
    }
    return StreamingResponse(buffer, media_type="application/pdf", headers=headers)


@router.get("/analytics/export/csv")
def analytics_export_csv(
    range_key: str = Query("30"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    payload = _build_conversation_analytics_payload(db, range_key, start_date, end_date)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Conversation Analytics"])
    writer.writerow(["Range", _performance_range_label(range_key, start_date, end_date)])
    writer.writerow(["Generated At (UTC)", datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")])
    writer.writerow([])
    writer.writerow(["Total Questions", payload.overview.total_questions])
    writer.writerow(["Answered", payload.overview.answered])
    writer.writerow(["Answered Rate (%)", payload.overview.answered_rate])
    writer.writerow(["Unanswered", payload.overview.unanswered])
    writer.writerow(["Unanswered Rate (%)", payload.overview.unanswered_rate])
    writer.writerow(["Escalation Rate (%)", payload.overview.escalation_rate])
    writer.writerow(["Helpful Rate (%)", payload.overview.helpful_rate])
    writer.writerow(["KB Coverage (%)", payload.overview.kb_coverage])
    writer.writerow([])
    writer.writerow(["Topic", "Volume", "Share (%)", "Escalation Rate (%)", "Answer Rate (%)"])
    for row in payload.topics:
        writer.writerow([row.topic, row.volume, row.share, row.escalation_rate, row.answer_rate])
    writer.writerow([])
    writer.writerow(["Query", "Escalation Rate (%)", "Tickets"])
    for row in payload.hotspots:
        writer.writerow([row.query, row.escalation_rate, row.tickets])

    csv_payload = io.BytesIO(output.getvalue().encode("utf-8"))
    headers = {
        "Content-Disposition": f'attachment; filename="{_analytics_export_filename("csv")}"'
    }
    return StreamingResponse(csv_payload, media_type="text/csv; charset=utf-8", headers=headers)


@router.get("/analytics/export/pdf")
def analytics_export_pdf(
    range_key: str = Query("30"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    payload = _build_conversation_analytics_payload(db, range_key, start_date, end_date)

    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import landscape, letter
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Spacer, Paragraph, Table, TableStyle
    except ModuleNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail="PDF export requires the 'reportlab' package to be installed on the backend.",
        ) from exc

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(letter),
        leftMargin=0.45 * inch,
        rightMargin=0.45 * inch,
        topMargin=0.45 * inch,
        bottomMargin=0.45 * inch,
    )
    styles = getSampleStyleSheet()
    story = [
        Paragraph("Conversation Analytics", styles["Title"]),
        Spacer(1, 8),
        Paragraph(f"Range: {_performance_range_label(range_key, start_date, end_date)}", styles["Normal"]),
        Paragraph(f"Generated At (UTC): {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}", styles["Normal"]),
        Spacer(1, 10),
    ]

    summary_data = [
        ["Total Questions", str(payload.overview.total_questions)],
        ["Answered", f"{payload.overview.answered} ({payload.overview.answered_rate}%)"],
        ["Unanswered", f"{payload.overview.unanswered} ({payload.overview.unanswered_rate}%)"],
        ["Helpful Rate", f"{payload.overview.helpful_rate}%"],
        ["Escalation Rate", f"{payload.overview.escalation_rate}%"],
        ["KB Coverage", f"{payload.overview.kb_coverage}%"],
    ]
    summary_table = Table(summary_data, colWidths=[2.4 * inch, 2.6 * inch])
    summary_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F0F2F5")),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#333333")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#D9D9D9")),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story.extend([summary_table, Spacer(1, 14)])

    table_data = [["Topic", "Volume", "Share", "Escalation Rate", "Answer Rate"]]
    for row in payload.topics:
        table_data.append([
            row.topic,
            str(row.volume),
            f"{row.share}%",
            f"{row.escalation_rate}%",
            f"{row.answer_rate}%",
        ])

    detail_table = Table(
        table_data,
        repeatRows=1,
        colWidths=[2.1 * inch, 1.1 * inch, 1.1 * inch, 1.4 * inch, 1.2 * inch],
    )
    detail_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F0F2F5")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0D5C45")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#333333")),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor("#D9D9D9")),
        ("LINEBELOW", (0, 1), (-1, -1), 0.35, colors.HexColor("#E6E6E6")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAFA")]),
        ("PADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.extend([detail_table, Spacer(1, 14)])

    if payload.hotspots:
        hotspot_data = [["Escalation Hotspot", "Escalation Rate", "Tickets"]]
        for row in payload.hotspots:
            hotspot_data.append([row.query, f"{row.escalation_rate}%", str(row.tickets)])
        hotspot_table = Table(
            hotspot_data,
            repeatRows=1,
            colWidths=[4.8 * inch, 1.3 * inch, 0.9 * inch],
        )
        hotspot_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F0F2F5")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0D5C45")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#333333")),
            ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor("#D9D9D9")),
            ("LINEBELOW", (0, 1), (-1, -1), 0.35, colors.HexColor("#E6E6E6")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FAFAFA")]),
            ("PADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(hotspot_table)

    document.build(story)
    buffer.seek(0)
    headers = {
        "Content-Disposition": f'attachment; filename="{_analytics_export_filename("pdf")}"'
    }
    return StreamingResponse(buffer, media_type="application/pdf", headers=headers)


@router.get("/performance/{staff_id}", response_model=StaffPerformanceDetailResponse)
def performance_detail(
    staff_id: int,
    range_key: str = Query("30"),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    staff = (
        db.query(User)
        .filter(User.id == staff_id, User.role == "ar_staff")
        .first()
    )
    if not staff:
        raise HTTPException(status_code=404, detail="AR staff member not found")

    _, detail_map = _build_staff_performance_payload(db, range_key, start_date, end_date)
    return StaffPerformanceDetailResponse(
        staff_id=staff.id,
        staff_username=staff.username,
        tickets=detail_map.get(staff.id, []),
    )


@router.get("/tickets", response_model=List[AdminTicket])
def tickets_overview(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Return an overview of all tickets with student info and current assigned AR staff."""
    require_admin(current_user)

    tickets = db.query(Ticket).order_by(Ticket.created_at.desc()).all()
    assignment_mode = get_assignment_mode(db)
    user_ids = {
        user_id
        for ticket in tickets
        for user_id in (ticket.student_id, ticket.assigned_to, ticket.recommended_officer_id)
        if user_id is not None
    }
    users_by_id = {}
    if user_ids:
        users_by_id = {
            user.id: user
            for user in db.query(User).filter(User.id.in_(user_ids)).all()
        }

    results = []
    for ticket in tickets:
        if (
            ticket.recommended_officer_id is None
            and not ticket.false_generated
            and not ticket.exclude_from_ingestion
            and ticket.status in {"open", "assigned"}
        ):
            try:
                apply_ticket_recommendation(db, ticket)
            except Exception as exc:
                print(f"Failed to backfill recommendation for ticket {ticket.id}: {exc}")
        if (
            assignment_mode in {ASSIGNMENT_MODE_AUTO_REVIEW, ASSIGNMENT_MODE_AUTO_ASSIGN}
            and ticket.status == "open"
            and ticket.assigned_to is None
            and not ticket.false_generated
            and not ticket.exclude_from_ingestion
        ):
            try:
                maybe_auto_assign_recommended_ticket(db, ticket)
            except Exception as exc:
                print(f"Failed to auto-assign ticket {ticket.id} during admin sync: {exc}")
        student = users_by_id.get(ticket.student_id)
        ar_user = users_by_id.get(ticket.assigned_to) if ticket.assigned_to is not None else None
        recommended_user = users_by_id.get(ticket.recommended_officer_id) if ticket.recommended_officer_id is not None else None
        if recommended_user is None and ticket.recommended_officer_id is not None:
            recommended_user = db.query(User).filter(User.id == ticket.recommended_officer_id).first()
            if recommended_user is not None:
                users_by_id[recommended_user.id] = recommended_user
        results.append(
            AdminTicket(
                ticket_id=ticket.id,
                reference_code=ticket.reference_code,
                student_id=ticket.student_id,
                student_username=getattr(student, "username", None),
                status=ticket.status,
                false_generated=bool(ticket.false_generated),
                exclude_from_ingestion=bool(ticket.exclude_from_ingestion),
                recommended_officer_id=ticket.recommended_officer_id,
                recommended_officer_username=getattr(recommended_user, "username", None),
                recommendation_score=ticket.recommendation_score,
                recommendation_reason=ticket.recommendation_reason,
                recommendation_created_at=ticket.recommendation_created_at,
                assignment_area=ticket.assignment_area,
                assignment_area_confidence=ticket.assignment_area_confidence,
                assignment_area_reason=ticket.assignment_area_reason,
                auto_assigned=bool(ticket.auto_assigned),
                assignment_reviewed=bool(ticket.assignment_reviewed),
                ar_assigned_id=ticket.assigned_to,
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
            ARActivityItem(
                ar_id=ar_id,
                ar_username=username,
                tickets_resolved=tickets_resolved,
                last_activity=last_activity,
            )
        )

    return results


@router.get("/assignment-mode", response_model=AssignmentModeResponse)
def read_assignment_mode(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_admin(current_user)
    return AssignmentModeResponse(mode=get_assignment_mode(db))


@router.put("/assignment-mode", response_model=AssignmentModeResponse)
def update_assignment_mode(
    payload: AssignmentModeUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    try:
        mode = set_assignment_mode(db, payload.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if mode in {ASSIGNMENT_MODE_AUTO_REVIEW, ASSIGNMENT_MODE_AUTO_ASSIGN}:
        open_tickets = (
            db.query(Ticket)
            .filter(
                Ticket.status == "open",
                Ticket.assigned_to.is_(None),
                Ticket.false_generated.is_(False),
                Ticket.exclude_from_ingestion.is_(False),
            )
            .all()
        )
        for ticket in open_tickets:
            try:
                if ticket.recommended_officer_id is None:
                    apply_ticket_recommendation(db, ticket)
                maybe_auto_assign_recommended_ticket(db, ticket)
            except Exception as exc:
                print(f"Failed to apply auto-assignment for ticket {ticket.id} after mode switch: {exc}")

    return AssignmentModeResponse(mode=mode)


@router.post("/tickets/{ticket_id}/assign")
def assign_ticket(
    ticket_id: int,
    officer_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Assign or reassign a ticket to an AR officer."""
    require_admin(current_user)

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if ticket.status not in {"open", "assigned"}:
        raise HTTPException(status_code=400, detail=f"Ticket must be 'open' or 'assigned' to assign (current: '{ticket.status}')")

    officer = db.query(User).filter(User.id == officer_id, User.role == "ar_staff").first()
    if not officer:
        raise HTTPException(status_code=404, detail="AR officer not found")

    previous_status = ticket.status
    previous_officer = ticket.assigned_to
    ticket.assigned_to = officer.id
    ticket.status = "assigned"
    ticket.assignment_reviewed = True
    if ticket.recommended_officer_id != officer.id:
        ticket.auto_assigned = False
    db.add(ticket)
    db.commit()

    note = f"Assigned to officer {officer.id}"
    if previous_officer and previous_officer != officer.id:
        note = f"Reassigned from officer {previous_officer} to officer {officer.id}"
    db.add(
        TicketUpdate(
            ticket_id=ticket.id,
            updated_by=current_user.id,
            note=note,
            status_change=f"{previous_status}->assigned",
        )
    )
    db.commit()

    return {"message": "Ticket assigned", "ticket_id": ticket.id, "assigned_to": officer.id}


@router.post("/tickets/{ticket_id}/accept-recommendation")
def accept_recommendation(
    ticket_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Assign an open ticket to its recommended AR officer."""
    require_admin(current_user)

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    if ticket.status != "open":
        raise HTTPException(status_code=400, detail=f"Ticket must be 'open' to accept recommendation (current: '{ticket.status}')")

    if not ticket.recommended_officer_id:
        raise HTTPException(status_code=400, detail="No recommendation is available for this ticket")

    officer = db.query(User).filter(User.id == ticket.recommended_officer_id, User.role == "ar_staff").first()
    if not officer:
        raise HTTPException(status_code=404, detail="Recommended AR officer not found")

    ticket.assigned_to = officer.id
    ticket.status = "assigned"
    ticket.auto_assigned = False
    ticket.assignment_reviewed = True
    db.add(ticket)
    db.commit()

    db.add(
        TicketUpdate(
            ticket_id=ticket.id,
            updated_by=current_user.id,
            note=f"Accepted recommendation for officer {officer.id}",
            status_change="open->assigned_recommended",
        )
    )
    db.commit()

    return {"message": "Recommendation accepted", "ticket_id": ticket.id, "assigned_to": officer.id}


@router.post("/tickets/{ticket_id}/mark-assignment-reviewed")
def mark_assignment_reviewed(
    ticket_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark an auto-assigned ticket as reviewed by admin."""
    require_admin(current_user)

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not ticket.auto_assigned:
        raise HTTPException(status_code=400, detail="Ticket is not auto-assigned")
    if ticket.assignment_reviewed:
        return {"message": "Assignment already reviewed", "ticket_id": ticket.id}

    ticket.assignment_reviewed = True
    db.add(ticket)
    db.commit()

    db.add(
        TicketUpdate(
            ticket_id=ticket.id,
            updated_by=current_user.id,
            note="Admin reviewed automated assignment",
            status_change="assigned_auto_review->assigned_reviewed",
        )
    )
    db.commit()

    return {"message": "Assignment marked as reviewed", "ticket_id": ticket.id}


@router.post("/tickets/{ticket_id}/resolve-false")
def resolve_false_ticket(
    ticket_id: int,
    payload: AdminTicketModerationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resolve an unintended/false ticket and block it from reinforcement ingestion."""
    require_admin(current_user)

    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    previous_status = ticket.status
    ticket.false_generated = True
    ticket.exclude_from_ingestion = True
    ticket.resolved_at = datetime.utcnow()
    if ticket.status != "closed":
        ticket.status = "resolved"
    ticket.assigned_to = None
    db.add(ticket)

    note = (payload.note or "").strip() or "Admin marked ticket as falsely/unintentionally generated"
    db.add(
        TicketUpdate(
            ticket_id=ticket.id,
            updated_by=current_user.id,
            note=note,
            status_change=f"{previous_status}->{ticket.status}_false_generated",
        )
    )

    try:
        if ticket.conversation:
            ticket.conversation.ended_at = datetime.utcnow()
    except Exception:
        pass

    db.commit()
    db.refresh(ticket)

    return {
        "message": "Ticket resolved as false and excluded from ingestion",
        "ticket_id": ticket.id,
        "reference_code": ticket.reference_code,
        "status": ticket.status,
        "false_generated": bool(ticket.false_generated),
        "exclude_from_ingestion": bool(ticket.exclude_from_ingestion),
    }


@router.post("/documents/upload")
def upload_policy_document(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    file: UploadFile = File(...)
):
    """Upload a PDF to disk, then ingest immediately into RAG."""
    require_admin_or_ar(current_user)

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    storage_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "university_documents"))
    os.makedirs(storage_dir, exist_ok=True)

    original_filename = file.filename
    base, ext = os.path.splitext(original_filename)
    stored_filename = original_filename
    version = 1
    file_existed = False
    while os.path.exists(os.path.join(storage_dir, stored_filename)):
        file_existed = True
        version += 1
        stored_filename = f"{base}__v{version}{ext}"

    stored_path = os.path.join(storage_dir, stored_filename)
    with open(stored_path, "wb") as f:
        f.write(file.file.read())

    # Ingest the new document into RAG
    try:
        from scripts.ingest_documents import extract_content_with_table_handling
        from app.utils import chunk_content_blocks
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import ingestion helpers: {e}")

    try:
        blocks = extract_content_with_table_handling(stored_path)
        chunks = chunk_content_blocks(blocks)
    except Exception as e:
        try:
            os.remove(stored_path)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to extract/chunk PDF: {e}")

    if not chunks:
        try:
            os.remove(stored_path)
        except OSError:
            pass
        raise HTTPException(status_code=400, detail="No ingestible content was found in the uploaded PDF")

    rag_doc = RAGDocument(
        source="policy",
        title=stored_filename,
        source_reference=stored_filename,
        source_type="pdf",
    )
    db.add(rag_doc)
    db.flush()

    chunks_created = 0
    created_embedding_ids: list[str] = []
    try:
        for chunk in chunks:
            embedding_id = vector_store_manager.add_text(
                text=chunk,
                metadata={
                    "source": "policy",
                    "filename": stored_filename,
                    "title": stored_filename,
                    "source_reference": stored_filename,
                    "document_id": rag_doc.id,
                },
            )
            if not embedding_id:
                raise RuntimeError("Embedding generation failed for one or more chunks")
            db.add(DocumentChunk(document_id=rag_doc.id, chunk_text=chunk, embedding_id=embedding_id))
            created_embedding_ids.append(embedding_id)
            chunks_created += 1
        db.commit()
        db.refresh(rag_doc)
    except Exception as e:
        db.rollback()
        if created_embedding_ids:
            try:
                vector_store_manager.remove_by_ids(created_embedding_ids)
            except Exception:
                pass
        try:
            os.remove(stored_path)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to ingest PDF into the knowledge base: {e}")

    return {
        "message": "Uploaded and ingested",
        "original_filename": original_filename,
        "stored_filename": stored_filename,
        "file_existed": file_existed,
        "rag_document_id": rag_doc.id,
        "chunks_created": chunks_created,
    }


@router.get("/documents", response_model=List[AdminDocumentItem])
def list_documents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List RAG document metadata."""
    require_admin_or_ar(current_user)

    storage_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "university_documents"))
    rows = (
        db.query(
            RAGDocument,
            func.count(DocumentChunk.id).label("chunk_count"),
        )
        .outerjoin(DocumentChunk, DocumentChunk.document_id == RAGDocument.id)
        .group_by(RAGDocument.id)
        .order_by(RAGDocument.created_at.desc())
        .all()
    )

    results: List[AdminDocumentItem] = []
    for doc, chunk_count in rows:
        file_exists = False
        if doc.source_reference:
            file_exists = os.path.exists(os.path.join(storage_dir, doc.source_reference))

        results.append(
            AdminDocumentItem(
                id=doc.id,
                source=doc.source,
                title=doc.title,
                source_reference=doc.source_reference,
                source_type=doc.source_type,
                chunk_count=int(chunk_count or 0),
                file_exists=file_exists,
                created_at=doc.created_at,
            )
        )

    return results


@router.post("/scrape/url")
def scrape_single_url(
    payload: ScrapeUrlRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    require_admin(current_user)
    service = WebIngestionService(db)
    result = service.ingest_url(payload.url, force=payload.force)
    return {
        "url": result.url,
        "status": result.status,
        "chunks_added": result.chunks_added,
        "chunks_removed": result.chunks_removed,
        "error": result.error,
    }


@router.post("/scrape/crawl")
def trigger_crawl(
    payload: CrawlRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
) -> dict:
    require_admin(current_user)
    task_id = str(uuid4())
    background_tasks.add_task(_crawl_task, payload.seed_url, payload.max_pages)
    return {"status": "crawl_started", "task_id": task_id}


@router.get("/scrape/status", response_model=List[ScrapeStatusItem])
def scrape_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    docs = (
        db.query(RAGDocument)
        .filter(RAGDocument.last_scraped_at.is_not(None))
        .order_by(RAGDocument.last_scraped_at.desc())
        .limit(100)
        .all()
    )
    return [ScrapeStatusItem.from_orm(doc) for doc in docs]


@router.post("/watched-urls", response_model=WatchedURLOut)
def create_watched_url(
    payload: WatchedURLCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    existing = db.query(WatchedURL).filter(WatchedURL.url == payload.url).first()
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=400, detail="URL already watched")
        existing.is_active = True
        existing.label = payload.label
        existing.frequency_hours = payload.frequency_hours
        existing.created_by = current_user.username
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return WatchedURLOut.from_orm(existing)

    watch = WatchedURL(
        url=payload.url,
        label=payload.label,
        frequency_hours=payload.frequency_hours,
        created_by=current_user.username,
    )
    db.add(watch)
    db.commit()
    db.refresh(watch)
    return WatchedURLOut.from_orm(watch)


@router.get("/watched-urls", response_model=List[WatchedURLOut])
def list_watched_urls(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    watches = db.query(WatchedURL).filter(WatchedURL.is_active.is_(True)).all()
    return [WatchedURLOut.from_orm(w) for w in watches]


@router.delete("/watched-urls/{watch_id}")
def remove_watched_url(
    watch_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)
    watch = db.query(WatchedURL).filter(WatchedURL.id == watch_id).first()
    if not watch:
        raise HTTPException(status_code=404, detail="Watched URL not found")
    watch.is_active = False
    db.add(watch)
    db.commit()
    return {"message": "Watched URL disabled", "id": watch.id}


@router.delete("/documents/{document_id}")
def delete_document(
    document_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a RAG document and its chunks. Removes file if it exists on disk."""
    require_admin_or_ar(current_user)

    doc = db.query(RAGDocument).filter(RAGDocument.id == document_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Remove chunks
    db.query(DocumentChunk).filter(DocumentChunk.document_id == document_id).delete()

    # Remove file from disk if present
    storage_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "university_documents"))
    if doc.source_reference:
        file_path = os.path.join(storage_dir, doc.source_reference)
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception:
                pass

    db.delete(doc)
    db.commit()

    # Rebuild FAISS index from remaining chunks to remove deleted content
    _rebuild_faiss_from_db(db)

    return {"message": "Document deleted and FAISS index rebuilt"}


@router.get("/users", response_model=List[AdminUserItem])
def list_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all users with roles."""
    require_admin(current_user)
    users = db.query(User).order_by(User.created_at.desc()).all()
    return [_admin_user_item(u) for u in users]


@router.put("/users/{user_id}/role", response_model=AdminUserItem)
def update_user_role(
    user_id: int,
    payload: RoleUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update a user's role. Allowed roles: student, ar_staff, admin."""
    require_admin(current_user)

    if payload.role not in {"student", "ar_staff", "admin"}:
        raise HTTPException(status_code=400, detail="Invalid role")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.role = payload.role
    if user.role == "ar_staff":
        _apply_assignment_profile_to_user(
            user,
            payload.assignment_areas if payload.assignment_areas is not None else get_user_assignment_areas(user),
            payload.max_concurrent_load if payload.assignment_areas is not None else user.max_concurrent_load,
            payload.is_available if payload.assignment_areas is not None else bool(getattr(user, "is_available", True)),
            payload.priority_weight if payload.assignment_areas is not None else float(getattr(user, "priority_weight", 1.0) or 1.0),
        )
    else:
        _apply_assignment_profile_to_user(user, [], None, True, 1.0)
    db.add(user)
    db.commit()
    db.refresh(user)

    return _admin_user_item(user)


@router.post("/users", response_model=AdminUserItem)
def create_user(
    payload: AdminUserCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin-only: create a user with an explicit role."""
    require_admin(current_user)

    if payload.role not in {"student", "ar_staff", "admin"}:
        raise HTTPException(status_code=400, detail="Invalid role")

    existing = db.query(User).filter(User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    hashed = bcrypt.hash(payload.password)
    user = User(username=payload.username, hashed_password=hashed, role=payload.role)
    _apply_assignment_profile_to_user(
        user,
        payload.assignment_areas,
        payload.max_concurrent_load,
        payload.is_available,
        payload.priority_weight,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return _admin_user_item(user)


@router.put("/users/{user_id}/assignment-profile", response_model=AdminUserItem)
def update_user_assignment_profile(
    user_id: int,
    payload: AdminUserAssignmentProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_admin(current_user)

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role != "ar_staff":
        raise HTTPException(status_code=400, detail="Assignment profiles apply only to AR staff")

    _apply_assignment_profile_to_user(
        user,
        payload.assignment_areas,
        payload.max_concurrent_load,
        payload.is_available,
        payload.priority_weight,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _admin_user_item(user)


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    payload: AdminUserDeleteRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Admin-only: delete a user after confirming the acting admin's password."""
    require_admin(current_user)

    if not bcrypt.verify(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect admin password")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    has_related_records = any(
        [
            db.query(Conversation).filter(Conversation.user_id == user_id).first(),
            db.query(Ticket).filter((Ticket.student_id == user_id) | (Ticket.assigned_to == user_id)).first(),
            db.query(TicketMessage).filter(TicketMessage.sender_id == user_id).first(),
            db.query(TicketUpdate).filter(TicketUpdate.updated_by == user_id).first(),
            db.query(InPersonAssistance).filter(InPersonAssistance.ar_staff_id == user_id).first(),
            db.query(RefreshToken).filter(RefreshToken.user_id == user_id).first(),
        ]
    )

    if has_related_records:
        raise HTTPException(
            status_code=400,
            detail="This user has related records and cannot be deleted safely",
        )

    db.delete(user)
    db.commit()

    return {"message": "User deleted"}


def _rebuild_faiss_from_db(db: Session):
    """Rebuild FAISS index from remaining DocumentChunk rows."""
    index_path = vector_store_manager.index_path
    if os.path.exists(index_path):
        try:
            shutil.rmtree(index_path)
        except Exception:
            pass

    # Reset in-memory store
    vector_store_manager.vector_store = None
    reset_bm25_corpus()

    chunks = db.query(DocumentChunk).order_by(DocumentChunk.id).all()
    for chunk in chunks:
        embedding_id = vector_store_manager.add_text(
            text=chunk.chunk_text,
            metadata={"document_id": chunk.document_id}
        )
        if embedding_id:
            chunk.embedding_id = embedding_id

    db.commit()
