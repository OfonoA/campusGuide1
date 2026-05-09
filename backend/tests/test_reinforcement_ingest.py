from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.reinforcement.ingest import ingest_ticket_conversation
from app.utils import build_stored_message_content
from database.database import Base
from database.orm_models import Conversation, Message, MessageAttachment, RLFeedback, RAGDocument, Ticket, TicketMessage, User


def _build_session():
    engine = create_engine("sqlite:///:memory:")
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestingSessionLocal()


def test_ingest_ticket_conversation_preserves_retryable_feedback_when_embedding_fails(monkeypatch):
    db = _build_session()

    student = User(username="student1", hashed_password="x", role="student")
    officer = User(username="officer1", hashed_password="x", role="ar_staff")
    db.add_all([student, officer])
    db.commit()
    db.refresh(student)
    db.refresh(officer)

    conversation = Conversation(user_id=student.id, title="Ticket 67")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    ticket = Ticket(
        reference_code="AR-TEST-67",
        conversation_id=conversation.id,
        student_id=student.id,
        assigned_to=officer.id,
        status="resolved",
        exclude_from_ingestion=False,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    db.add(
        Message(
            conversation_id=conversation.id,
            sender="user",
            content="What are the requirements for medical laboratory science?",
        )
    )
    db.add(
        TicketMessage(
            ticket_id=ticket.id,
            sender_role="ar_staff",
            sender_id=officer.id,
            content="Direct entry requires Biology and Chemistry.",
        )
    )
    db.commit()

    monkeypatch.setattr(
        "app.reinforcement.ingest.vector_store_manager.add_text",
        lambda text, metadata=None: "",
    )

    result = ingest_ticket_conversation(db, ticket)

    assert result is False

    feedback = db.query(RLFeedback).filter(RLFeedback.ticket_id == ticket.id).one()
    assert feedback.ingested is False
    assert "medical laboratory science" in feedback.validated_answer

    assert db.query(RAGDocument).filter(RAGDocument.source_reference == f"TICKET-{ticket.id}").count() == 0


def test_ingest_ticket_conversation_includes_hidden_attachment_text(monkeypatch):
    db = _build_session()

    student = User(username="student2", hashed_password="x", role="student")
    officer = User(username="officer2", hashed_password="x", role="ar_staff")
    db.add_all([student, officer])
    db.commit()
    db.refresh(student)
    db.refresh(officer)

    conversation = Conversation(user_id=student.id, title="Ticket 68")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    ticket = Ticket(
        reference_code="AR-TEST-68",
        conversation_id=conversation.id,
        student_id=student.id,
        assigned_to=officer.id,
        status="resolved",
        exclude_from_ingestion=False,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    stored_message = build_stored_message_content(
        "Please review the attached file.\n\n[Attached files: answer.txt]",
        ["[File: answer.txt]\nThe official requirement is Biology and Chemistry."],
    )

    db.add(
        TicketMessage(
            ticket_id=ticket.id,
            sender_role="ar_staff",
            sender_id=officer.id,
            content=stored_message,
        )
    )
    db.commit()

    captured_chunks = []

    def _fake_add_text(text, metadata=None):
        captured_chunks.append(text)
        return f"embed-{len(captured_chunks)}"

    monkeypatch.setattr(
        "app.reinforcement.ingest.vector_store_manager.add_text",
        _fake_add_text,
    )

    result = ingest_ticket_conversation(db, ticket)

    assert result is True

    feedback = db.query(RLFeedback).filter(RLFeedback.ticket_id == ticket.id).one()
    assert feedback.ingested is True
    assert "Please review the attached file." in feedback.validated_answer
    assert "The official requirement is Biology and Chemistry." in feedback.validated_answer
    assert captured_chunks
    assert any("The official requirement is Biology and Chemistry." in chunk for chunk in captured_chunks)


def test_ingest_ticket_conversation_falls_back_to_attachment_rows_when_hidden_payload_missing(monkeypatch):
    db = _build_session()

    student = User(username="student3", hashed_password="x", role="student")
    officer = User(username="officer3", hashed_password="x", role="ar_staff")
    db.add_all([student, officer])
    db.commit()
    db.refresh(student)
    db.refresh(officer)

    conversation = Conversation(user_id=student.id, title="Ticket 69")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)

    ticket = Ticket(
        reference_code="AR-TEST-69",
        conversation_id=conversation.id,
        student_id=student.id,
        assigned_to=officer.id,
        status="resolved",
        exclude_from_ingestion=False,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    message = TicketMessage(
        ticket_id=ticket.id,
        sender_role="ar_staff",
        sender_id=officer.id,
        content="Please review the attached file.\n\n[Attached files: MUST_Admission_Requirements_2026-2027.pdf]",
    )
    db.add(message)
    db.commit()
    db.refresh(message)

    db.add(
        MessageAttachment(
            ticket_message_id=message.id,
            uploaded_by_user_id=officer.id,
            original_filename="MUST_Admission_Requirements_2026-2027.pdf",
            stored_filename="stored.pdf",
            stored_path="/tmp/stored.pdf",
            content_type="application/pdf",
            file_size_bytes=1234,
            extracted_text="Admission requirement details from the PDF go here.",
        )
    )
    db.commit()
    db.refresh(message)

    captured_chunks = []

    def _fake_add_text(text, metadata=None):
        captured_chunks.append(text)
        return f"embed-{len(captured_chunks)}"

    monkeypatch.setattr(
        "app.reinforcement.ingest.vector_store_manager.add_text",
        _fake_add_text,
    )

    result = ingest_ticket_conversation(db, ticket)

    assert result is True

    feedback = db.query(RLFeedback).filter(RLFeedback.ticket_id == ticket.id).one()
    assert feedback.ingested is True
    assert "Please review the attached file." in feedback.validated_answer
    assert "Admission requirement details from the PDF go here." in feedback.validated_answer
    assert captured_chunks
    assert any("Admission requirement details from the PDF go here." in chunk for chunk in captured_chunks)
