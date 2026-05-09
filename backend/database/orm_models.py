from datetime import datetime
from sqlalchemy import Column, Integer, String, Enum, Text, ForeignKey, Float, Boolean, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    # Keep optional name/email for profile purposes, but add username/hashed_password
    username = Column(String(150), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    name = Column(String(255), nullable=True)
    email = Column(String(255), unique=True, nullable=True)
    role = Column(Enum("student", "ar_staff", "admin"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_active_at = Column(DateTime(timezone=True), nullable=True)
    refresh_tokens = relationship("RefreshToken", back_populates="user")

class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    # Optional human-readable title for the conversation (used by UI)
    title = Column(String(255), nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    ended_at = Column(DateTime(timezone=True))
    # created_at kept for compatibility with previous code that orders by created_at
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    messages = relationship("Message", back_populates="conversation")
    tickets = relationship("Ticket", back_populates="conversation")

class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"))
    sender = Column(Enum("user", "bot", "ar_staff"), nullable=False)
    content = Column(Text, nullable=False)
    confidence_score = Column(Float)
    found_answer = Column(Boolean, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # compatibility property: some code expects `timestamp`
    @property
    def timestamp(self):
        return self.created_at

    conversation = relationship("Conversation", back_populates="messages")
    attachments = relationship("MessageAttachment", back_populates="message")

class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True)
    reference_code = Column(String(40), unique=True, nullable=False)
    conversation_id = Column(Integer, ForeignKey("conversations.id"))
    student_id = Column(Integer, ForeignKey("users.id"))
    assigned_to = Column(Integer, ForeignKey("users.id"), nullable=True)
    recommended_officer_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    recommendation_score = Column(Float, nullable=True)
    recommendation_reason = Column(Text, nullable=True)
    recommendation_created_at = Column(DateTime(timezone=True), nullable=True)
    auto_assigned = Column(Boolean, nullable=False, default=False)
    assignment_reviewed = Column(Boolean, nullable=False, default=False)
    status = Column(Enum("open", "assigned", "in_progress", "resolved", "closed"), default="open")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True))
    false_generated = Column(Boolean, nullable=False, default=False)
    exclude_from_ingestion = Column(Boolean, nullable=False, default=False)
    conversation = relationship("Conversation", back_populates="tickets")
    student = relationship("User", foreign_keys=[student_id])
    assigned_officer = relationship("User", foreign_keys=[assigned_to])
    recommended_officer = relationship("User", foreign_keys=[recommended_officer_id])
    updates = relationship("TicketUpdate", back_populates="ticket")
    in_person_assistances = relationship("InPersonAssistance", back_populates="ticket")

class TicketUpdate(Base):
    __tablename__ = "ticket_updates"

    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"))
    updated_by = Column(Integer, ForeignKey("users.id"))
    note = Column(Text)
    status_change = Column(String(50))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    ticket = relationship("Ticket", back_populates="updates")

class InPersonAssistance(Base):
    __tablename__ = "in_person_assistances"

    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"))
    ar_staff_id = Column(Integer, ForeignKey("users.id"))
    actions_taken = Column(Text)
    resolution_summary = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    ticket = relationship("Ticket", back_populates="in_person_assistances")
    ar_staff = relationship("User", foreign_keys=[ar_staff_id])

class RLFeedback(Base):
    __tablename__ = "rl_feedback"

    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"))
    # Link this feedback to a specific bot Message so we can enforce
    # "one feedback per bot message". This is nullable at creation
    # but we mark it non-nullable when a message is specified.
    message_id = Column(Integer, ForeignKey("messages.id"), unique=True, nullable=True)
    validated_answer = Column(Text, nullable=False)
    confidence = Column(Enum("high", "medium"))
    ingested = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class StudentFeedback(Base):
    __tablename__ = "student_feedback"

    id = Column(Integer, primary_key=True)
    message_id = Column(Integer, ForeignKey("messages.id"), unique=True, nullable=False)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    satisfactory = Column(Boolean, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # relationships are optional for this lightweight attachment


class RAGDocument(Base):
    __tablename__ = "rag_documents"

    id = Column(Integer, primary_key=True)
    source = Column(Enum("manual", "policy", "faq", "ar_resolution"))
    title = Column(String(255))
    source_reference = Column(String(255))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    source_url = Column(String(512), nullable=True)
    source_type = Column(String(50), default="pdf")
    content_hash = Column(String(128), nullable=True)
    last_scraped_at = Column(DateTime, nullable=True)
    scrape_status = Column(String(50), nullable=True)
    http_etag = Column(String(255), nullable=True)
    http_last_mod = Column(String(255), nullable=True)


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("rag_documents.id"))
    chunk_text = Column(Text, nullable=False)
    embedding_id = Column(String(255))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WatchedURL(Base):
    __tablename__ = "watched_urls"

    id = Column(Integer, primary_key=True)
    url = Column(String(512), unique=True, nullable=False)
    label = Column(String(255), nullable=True)
    frequency_hours = Column(Integer, default=24)
    last_scraped_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(255), nullable=True)


class TicketMessage(Base):
    __tablename__ = "ticket_messages"

    id = Column(Integer, primary_key=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"))
    sender_role = Column(Enum("student", "ar_staff"), nullable=False)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    attachments = relationship("MessageAttachment", back_populates="ticket_message")


class MessageAttachment(Base):
    __tablename__ = "message_attachments"

    id = Column(Integer, primary_key=True)
    message_id = Column(Integer, ForeignKey("messages.id"), nullable=True)
    ticket_message_id = Column(Integer, ForeignKey("ticket_messages.id"), nullable=True)
    uploaded_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    original_filename = Column(String(255), nullable=False)
    stored_filename = Column(String(255), nullable=False)
    stored_path = Column(String(512), nullable=False)
    content_type = Column(String(100), nullable=True)
    file_size_bytes = Column(Integer, nullable=False)
    extracted_text = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    message = relationship("Message", back_populates="attachments")
    ticket_message = relationship("TicketMessage", back_populates="attachments")
    uploader = relationship("User", foreign_keys=[uploaded_by_user_id])


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True)
    token_id = Column(String(64), unique=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    hashed_token = Column(String(255), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True))

    user = relationship("User", back_populates="refresh_tokens")


class AppSetting(Base):
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True)
    setting_key = Column(String(100), unique=True, nullable=False)
    value = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
