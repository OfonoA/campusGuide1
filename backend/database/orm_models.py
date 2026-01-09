from sqlalchemy import Column, Integer, String, Enum, Text, ForeignKey, Float, Boolean, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from backend.database.database import Base

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
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # compatibility property: some code expects `timestamp`
    @property
    def timestamp(self):
        return self.created_at

    conversation = relationship("Conversation", back_populates="messages")

class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True)
    reference_code = Column(String(20), unique=True, nullable=False)
    conversation_id = Column(Integer, ForeignKey("conversations.id"))
    student_id = Column(Integer, ForeignKey("users.id"))
    status = Column(Enum("open", "in_progress", "resolved", "closed"), default="open")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True))
    conversation = relationship("Conversation", back_populates="tickets")
    student = relationship("User", foreign_keys=[student_id])
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


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, ForeignKey("rag_documents.id"))
    chunk_text = Column(Text, nullable=False)
    embedding_id = Column(String(255))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


