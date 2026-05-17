from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import assignment
from app.assignment import (
    ASSIGNMENT_AREA_ADMISSIONS,
    ASSIGNMENT_AREA_DOCUMENTS,
    ASSIGNMENT_AREA_GENERAL,
    ASSIGNMENT_AREA_RESULTS,
    AssignmentRoutingDecision,
    apply_ticket_recommendation,
    classify_ticket_area,
    get_user_assignment_areas,
    serialize_assignment_areas,
)
from database.database import Base
from database.orm_models import Conversation, Message, Ticket, User


def _build_session():
    engine = create_engine("sqlite:///:memory:")
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestingSessionLocal()


def test_classify_ticket_area_detects_results_query(monkeypatch):
    db = _build_session()
    student = User(username="student_results", hashed_password="x", role="student")
    db.add(student)
    db.commit()
    db.refresh(student)

    conversation = Conversation(user_id=student.id, title="Results question")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    ticket = Ticket(reference_code="AR-RES-1", conversation_id=conversation.id, student_id=student.id, status="open")
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    db.add(Message(conversation_id=conversation.id, sender="user", content="My results are missing for anatomy"))
    db.commit()

    monkeypatch.setattr(
        assignment,
        "_classify_ticket_area_with_llm",
        lambda text: AssignmentRoutingDecision(
            area=ASSIGNMENT_AREA_RESULTS,
            confidence=0.92,
            reason="The student is asking about missing results.",
        ),
    )

    routing = classify_ticket_area(db, ticket)

    assert routing.area == ASSIGNMENT_AREA_RESULTS
    assert "results" in routing.reason.lower()


def test_apply_ticket_recommendation_prefers_matching_specialist_over_general(monkeypatch):
    db = _build_session()
    student = User(username="student_docs", hashed_password="x", role="student")
    specialist = User(
        username="docs_officer",
        hashed_password="x",
        role="ar_staff",
        assignment_areas=serialize_assignment_areas([ASSIGNMENT_AREA_DOCUMENTS]),
        is_available=True,
        priority_weight=1.0,
    )
    general = User(
        username="general_officer",
        hashed_password="x",
        role="ar_staff",
        assignment_areas=serialize_assignment_areas([ASSIGNMENT_AREA_GENERAL]),
        is_available=True,
        priority_weight=1.0,
    )
    db.add_all([student, specialist, general])
    db.commit()
    db.refresh(student)
    db.refresh(specialist)
    db.refresh(general)

    conversation = Conversation(user_id=student.id, title="Transcript help")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    ticket = Ticket(reference_code="AR-DOC-1", conversation_id=conversation.id, student_id=student.id, status="open")
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    db.add(Message(conversation_id=conversation.id, sender="user", content="I need a transcript and certified copy"))
    db.commit()

    monkeypatch.setattr(
        assignment,
        "_classify_ticket_area_with_llm",
        lambda text: AssignmentRoutingDecision(
            area=ASSIGNMENT_AREA_DOCUMENTS,
            confidence=0.94,
            reason="The request is about a transcript and certified copy.",
        ),
    )

    recommendation = apply_ticket_recommendation(db, ticket)
    db.refresh(ticket)

    assert recommendation is not None
    assert recommendation.officer_id == specialist.id
    assert ticket.assignment_area == ASSIGNMENT_AREA_DOCUMENTS


def test_apply_ticket_recommendation_falls_back_to_general_when_no_specialist_exists(monkeypatch):
    db = _build_session()
    student = User(username="student_fallback", hashed_password="x", role="student")
    general = User(
        username="general_only",
        hashed_password="x",
        role="ar_staff",
        assignment_areas=serialize_assignment_areas([ASSIGNMENT_AREA_GENERAL]),
        is_available=True,
        priority_weight=1.0,
    )
    db.add_all([student, general])
    db.commit()
    db.refresh(student)
    db.refresh(general)

    conversation = Conversation(user_id=student.id, title="Admission help")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    ticket = Ticket(reference_code="AR-ADM-1", conversation_id=conversation.id, student_id=student.id, status="open")
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    db.add(Message(conversation_id=conversation.id, sender="user", content="I need help with admission requirements"))
    db.commit()

    monkeypatch.setattr(
        assignment,
        "_classify_ticket_area_with_llm",
        lambda text: AssignmentRoutingDecision(
            area=ASSIGNMENT_AREA_ADMISSIONS,
            confidence=0.91,
            reason="The request is about admission requirements.",
        ),
    )

    recommendation = apply_ticket_recommendation(db, ticket)
    db.refresh(ticket)

    assert recommendation is not None
    assert recommendation.officer_id == general.id
    assert ticket.assignment_area == ASSIGNMENT_AREA_ADMISSIONS


def test_apply_ticket_recommendation_reuses_existing_routing_decision(monkeypatch):
    db = _build_session()
    student = User(username="student_once", hashed_password="x", role="student")
    general = User(
        username="general_once",
        hashed_password="x",
        role="ar_staff",
        assignment_areas=serialize_assignment_areas([ASSIGNMENT_AREA_GENERAL]),
        is_available=True,
        priority_weight=1.0,
    )
    db.add_all([student, general])
    db.commit()
    db.refresh(student)
    db.refresh(general)

    conversation = Conversation(user_id=student.id, title="General help")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    ticket = Ticket(reference_code="AR-ONE-1", conversation_id=conversation.id, student_id=student.id, status="open")
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    db.add(Message(conversation_id=conversation.id, sender="user", content="Please help me with registration guidance"))
    db.commit()

    call_count = {"count": 0}

    def fake_classifier(_text: str):
        call_count["count"] += 1
        return AssignmentRoutingDecision(
            area=ASSIGNMENT_AREA_GENERAL,
            confidence=0.88,
            reason="General registration guidance request.",
        )

    monkeypatch.setattr(assignment, "_classify_ticket_area_with_llm", fake_classifier)

    recommendation = apply_ticket_recommendation(db, ticket)
    db.refresh(ticket)

    assert recommendation is not None
    assert recommendation.officer_id == general.id
    assert ticket.assignment_area == ASSIGNMENT_AREA_GENERAL
    assert call_count["count"] == 1


def test_get_user_assignment_areas_defaults_ar_staff_to_general():
    officer = User(username="default_officer", hashed_password="x", role="ar_staff")

    assert get_user_assignment_areas(officer) == [ASSIGNMENT_AREA_GENERAL]


def test_classify_ticket_area_falls_back_to_general_when_llm_fails(monkeypatch):
    db = _build_session()
    student = User(username="student_general", hashed_password="x", role="student")
    db.add(student)
    db.commit()
    db.refresh(student)

    conversation = Conversation(user_id=student.id, title="Fallback question")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    ticket = Ticket(reference_code="AR-GEN-1", conversation_id=conversation.id, student_id=student.id, status="open")
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    db.add(Message(conversation_id=conversation.id, sender="user", content="Please help me with this issue"))
    db.commit()

    def _raise(_text: str):
        raise RuntimeError("classifier failed")

    monkeypatch.setattr(assignment, "_classify_ticket_area_with_llm", _raise)

    routing = classify_ticket_area(db, ticket)

    assert routing.area == ASSIGNMENT_AREA_GENERAL
    assert "llm classification failed" in routing.reason.lower()
