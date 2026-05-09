import logging

from sqlalchemy.orm import Session

from database.orm_models import (
    RLFeedback,
    RAGDocument,
    DocumentChunk,
    TicketMessage,
    Message,
    MessageAttachment,
    Ticket,
)

from app.vector_store import vector_store_manager
from app.utils import build_ingestion_text, chunk_text

logger = logging.getLogger("must.reinforcement")


def _append_attachment_text(base_text: str, attachments: list[MessageAttachment]) -> str:
    text = (base_text or "").strip()
    if not attachments:
        return text

    attachment_sections: list[str] = []
    appended_count = 0
    for attachment in attachments:
        extracted_text = (attachment.extracted_text or "").strip()
        if not extracted_text:
            continue
        filename = (attachment.original_filename or "attachment").strip()
        section = f"[File: {filename}]\n{extracted_text}".strip()
        if section and section not in text:
            attachment_sections.append(section)
            appended_count += 1

    logger.info(
        "reinforcement_attachment_merge attachments=%d appended=%d base_len=%d appended_chars=%d",
        len(attachments),
        appended_count,
        len(text),
        sum(len(section) for section in attachment_sections),
    )

    parts = [part for part in [text, "\n\n".join(attachment_sections).strip()] if part]
    return "\n\n".join(parts).strip()


def _build_message_ingestion_text(message: Message | TicketMessage) -> str:
    base_text = build_ingestion_text(message.content)
    attachments = getattr(message, "attachments", []) or []
    merged_text = _append_attachment_text(base_text, attachments)
    logger.info(
        "reinforcement_message_text_built message_type=%s message_id=%s attachments=%d raw_len=%d base_len=%d merged_len=%d hidden_marker=%s",
        type(message).__name__,
        getattr(message, "id", None),
        len(attachments),
        len((message.content or "").strip()),
        len(base_text),
        len(merged_text),
        str("[Attachment ingestion content]" in (message.content or "")).lower(),
    )
    return merged_text


def _upsert_ticket_feedback(db: Session, ticket_id: int, full_text: str) -> RLFeedback:
    feedback = db.query(RLFeedback).filter(RLFeedback.ticket_id == ticket_id).first()
    if feedback:
        feedback.validated_answer = full_text
        feedback.ingested = False
        return feedback

    feedback = RLFeedback(
        ticket_id=ticket_id,
        validated_answer=full_text,
        ingested=False,
    )
    db.add(feedback)
    return feedback


def _persist_feedback_chunks(db: Session, feedback: RLFeedback) -> bool:
    rag_doc = RAGDocument(
        source="ar_resolution",
        title=f"AR Resolution for Ticket {feedback.ticket_id}",
        source_reference=f"TICKET-{feedback.ticket_id}"
    )
    db.add(rag_doc)
    db.commit()
    db.refresh(rag_doc)

    chunks = chunk_text(feedback.validated_answer)
    logger.info(
        "reinforcement_chunking ticket_id=%s feedback_id=%s validated_answer_len=%d chunks=%d",
        feedback.ticket_id,
        feedback.id,
        len(feedback.validated_answer or ""),
        len(chunks),
    )
    any_added = False
    for chunk in chunks:
        embedding_id = vector_store_manager.add_text(
            text=chunk,
            metadata={"source": "ar_resolution", "ticket_id": feedback.ticket_id}
        )
        if embedding_id:
            db.add(DocumentChunk(document_id=rag_doc.id, chunk_text=chunk, embedding_id=embedding_id))
            any_added = True
        else:
            print(f"Warning: embedding failed for ticket {feedback.ticket_id}, skipping chunk persist.")
            logger.warning(
                "reinforcement_embedding_failed ticket_id=%s feedback_id=%s chunk_len=%d",
                feedback.ticket_id,
                feedback.id,
                len(chunk),
            )

    if any_added:
        feedback.ingested = True
        db.commit()
        logger.info(
            "reinforcement_ingest_success ticket_id=%s feedback_id=%s persisted_chunks=%d",
            feedback.ticket_id,
            feedback.id,
            len(chunks),
        )
        return True

    db.delete(rag_doc)
    db.commit()
    print(
        f"Reinforcement ingestion produced no persisted chunks for ticket {feedback.ticket_id}; "
        "feedback remains pending."
    )
    logger.warning(
        "reinforcement_ingest_no_chunks ticket_id=%s feedback_id=%s validated_answer_len=%d",
        feedback.ticket_id,
        feedback.id,
        len(feedback.validated_answer or ""),
    )
    return False


def run_reinforcement_ingestion(db: Session):
    """
    Pulls validated AR resolutions and injects them into the RAG knowledge base.
    """

    # 1️⃣ Fetch un-ingested validated feedback
    feedback_entries = db.query(RLFeedback).filter(
        RLFeedback.ingested == False
    ).all()

    if not feedback_entries:
        print("No reinforcement data to ingest.")
        return

    for feedback in feedback_entries:
        ticket = db.query(Ticket).filter(Ticket.id == feedback.ticket_id).first() if feedback.ticket_id else None
        if ticket and ticket.exclude_from_ingestion:
            print(f"Skipping ingestion for ticket {ticket.id}: ticket is excluded from ingestion.")
            continue

        _persist_feedback_chunks(db, feedback)

    print("Reinforcement ingestion completed.")


def ingest_feedback_entry(db: Session, feedback: RLFeedback):
    """Ingest a single RLFeedback entry into the RAG store.

    This function reuses the same steps as `run_reinforcement_ingestion` but
    focuses on a single feedback row. It performs in-place DB updates on the
    provided session and returns True on success.
    """
    if not feedback or not feedback.validated_answer or not feedback.validated_answer.strip():
        print(f"Skipping ingestion: empty validated_answer for feedback id={getattr(feedback, 'id', None)}")
        return False

    ticket = db.query(Ticket).filter(Ticket.id == feedback.ticket_id).first() if feedback.ticket_id else None
    if ticket and ticket.exclude_from_ingestion:
        print(f"Skipping ingestion for feedback id={feedback.id}: ticket {ticket.id} is excluded from ingestion.")
        return False

    return _persist_feedback_chunks(db, feedback)


def ingest_ticket_conversation(db: Session, ticket: Ticket):
    """Ingest full resolved ticket conversation into the RAG store."""
    print(f"[reinforcement] start ticket_id={ticket.id}", flush=True)
    if ticket.exclude_from_ingestion:
        print(f"Skipping conversation ingestion for ticket {ticket.id}: ticket is excluded from ingestion.")
        return False

    # Gather initial student inquiry from conversation (exclude bot)
    convo_messages = (
        db.query(Message)
        .filter(Message.conversation_id == ticket.conversation_id, Message.sender == "user")
        .order_by(Message.created_at)
        .all()
    )
    logger.info(
        "reinforcement_ticket_ingest_start ticket_id=%d conversation_id=%s conversation_messages=%d",
        ticket.id,
        ticket.conversation_id,
        len(convo_messages),
    )
    print(
        f"[reinforcement] loaded_conversation_messages ticket_id={ticket.id} count={len(convo_messages)}",
        flush=True,
    )
    conversation_parts: list[str] = []
    for message in convo_messages:
        ingested_content = _build_message_ingestion_text(message)
        if ingested_content:
            conversation_parts.append(ingested_content)
    initial_text = "\n".join(conversation_parts) if conversation_parts else ""

    # Gather ticket chat messages (student + officer)
    ticket_messages = (
        db.query(TicketMessage)
        .filter(TicketMessage.ticket_id == ticket.id)
        .order_by(TicketMessage.created_at)
        .all()
    )
    logger.info(
        "reinforcement_ticket_messages_loaded ticket_id=%d ticket_messages=%d",
        ticket.id,
        len(ticket_messages),
    )
    print(
        f"[reinforcement] loaded_ticket_messages ticket_id={ticket.id} count={len(ticket_messages)}",
        flush=True,
    )
    ticket_parts: list[str] = []
    for message in ticket_messages:
        ingested_content = _build_message_ingestion_text(message)
        if ingested_content:
            ticket_parts.append(ingested_content)
    ticket_text = "\n".join(ticket_parts) if ticket_parts else ""

    full_text = "\n\n".join([t for t in [initial_text, ticket_text] if t])
    logger.info(
        "reinforcement_ticket_text_assembled ticket_id=%d initial_len=%d ticket_len=%d full_len=%d",
        ticket.id,
        len(initial_text),
        len(ticket_text),
        len(full_text),
    )
    print(
        f"[reinforcement] assembled_text ticket_id={ticket.id} initial_len={len(initial_text)} "
        f"ticket_len={len(ticket_text)} full_len={len(full_text)}",
        flush=True,
    )
    if not full_text.strip():
        print(f"No conversation text to ingest for ticket {ticket.id}")
        return False

    feedback = _upsert_ticket_feedback(db, ticket.id, full_text)
    db.commit()
    db.refresh(feedback)
    print(
        f"[reinforcement] feedback_upserted ticket_id={ticket.id} feedback_id={feedback.id} len={len(full_text)}",
        flush=True,
    )

    rag_doc = RAGDocument(
        source="ar_resolution",
        title=f"Resolved Ticket Conversation {ticket.id}",
        source_reference=f"TICKET-{ticket.id}"
    )
    db.add(rag_doc)
    db.commit()
    db.refresh(rag_doc)
    print(
        f"[reinforcement] rag_doc_created ticket_id={ticket.id} rag_doc_id={rag_doc.id}",
        flush=True,
    )

    chunks = chunk_text(full_text)
    print(
        f"[reinforcement] chunked ticket_id={ticket.id} chunks={len(chunks)}",
        flush=True,
    )
    any_added = False
    for chunk in chunks:
        print(
            f"[reinforcement] embedding_chunk ticket_id={ticket.id} chunk_len={len(chunk)}",
            flush=True,
        )
        embedding_id = vector_store_manager.add_text(
            text=chunk,
            metadata={"source": "ar_resolution", "ticket_id": ticket.id}
        )
        if embedding_id:
            db.add(DocumentChunk(document_id=rag_doc.id, chunk_text=chunk, embedding_id=embedding_id))
            any_added = True
            print(
                f"[reinforcement] embedding_chunk_done ticket_id={ticket.id} embedding_id={embedding_id}",
                flush=True,
            )

    if any_added:
        feedback.ingested = True
        db.commit()
        print(f"[reinforcement] success ticket_id={ticket.id}", flush=True)
        return True

    db.delete(rag_doc)
    db.commit()
    print(
        f"Conversation ingestion produced no persisted chunks for ticket {ticket.id}; "
        "left RLFeedback pending for retry."
    )
    print(f"[reinforcement] no_chunks_persisted ticket_id={ticket.id}", flush=True)
    return False
