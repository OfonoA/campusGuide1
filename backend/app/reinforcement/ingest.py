from sqlalchemy.orm import Session

from database.orm_models import (
    RLFeedback,
    RAGDocument,
    DocumentChunk,
    TicketMessage,
    Message,
    Ticket,
)

from app.vector_store import vector_store_manager
from app.utils import build_ingestion_text, chunk_text


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

        # 2️⃣ Create a RAG document entry
        rag_doc = RAGDocument(
            source="ar_resolution",
            title=f"AR Resolution for Ticket {feedback.ticket_id}",
            source_reference=f"TICKET-{feedback.ticket_id}"
        )
        db.add(rag_doc)
        db.commit()
        db.refresh(rag_doc)

        # 3️⃣ Chunk the validated answer
        chunks = chunk_text(feedback.validated_answer)

        for chunk in chunks:
            # 4️⃣ Add to vector store
            embedding_id = vector_store_manager.add_text(
                text=chunk,
                metadata={
                    "source": "ar_resolution",
                    "ticket_id": feedback.ticket_id
                }
            )

            # 5️⃣ Persist chunk metadata (only if embedding succeeded)
            if embedding_id:
                chunk_record = DocumentChunk(
                    document_id=rag_doc.id,
                    chunk_text=chunk,
                    embedding_id=embedding_id
                )
                db.add(chunk_record)
            else:
                print(f"Warning: embedding failed for ticket {feedback.ticket_id}, skipping chunk persist.")

        # 6️⃣ Mark feedback as ingested
        feedback.ingested = True

        db.commit()

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

    # create RAG document
    rag_doc = RAGDocument(
        source="ar_resolution",
        title=f"AR Resolution for Ticket {feedback.ticket_id}",
        source_reference=f"TICKET-{feedback.ticket_id}"
    )
    db.add(rag_doc)
    db.commit()
    db.refresh(rag_doc)

    chunks = chunk_text(feedback.validated_answer)
    any_added = False
    for chunk in chunks:
        embedding_id = vector_store_manager.add_text(
            text=chunk,
            metadata={"source": "ar_resolution", "ticket_id": feedback.ticket_id}
        )
        if embedding_id:
            chunk_record = DocumentChunk(document_id=rag_doc.id, chunk_text=chunk, embedding_id=embedding_id)
            db.add(chunk_record)
            any_added = True
        else:
            print(f"Warning: embedding failed for feedback id={feedback.id}")

    # mark ingested only if at least one chunk was added
    if any_added:
        feedback.ingested = True
        db.commit()
        return True

    return False


def ingest_ticket_conversation(db: Session, ticket: Ticket):
    """Ingest full resolved ticket conversation into the RAG store."""
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
    conversation_parts: list[str] = []
    for message in convo_messages:
        ingested_content = build_ingestion_text(message.content)
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
    ticket_parts: list[str] = []
    for message in ticket_messages:
        ingested_content = build_ingestion_text(message.content)
        if ingested_content:
            ticket_parts.append(ingested_content)
    ticket_text = "\n".join(ticket_parts) if ticket_parts else ""

    full_text = "\n\n".join([t for t in [initial_text, ticket_text] if t])
    if not full_text.strip():
        print(f"No conversation text to ingest for ticket {ticket.id}")
        return False

    rag_doc = RAGDocument(
        source="ar_resolution",
        title=f"Resolved Ticket Conversation {ticket.id}",
        source_reference=f"TICKET-{ticket.id}"
    )
    db.add(rag_doc)
    db.commit()
    db.refresh(rag_doc)

    chunks = chunk_text(full_text)
    any_added = False
    for chunk in chunks:
        embedding_id = vector_store_manager.add_text(
            text=chunk,
            metadata={"source": "ar_resolution", "ticket_id": ticket.id}
        )
        if embedding_id:
            db.add(DocumentChunk(document_id=rag_doc.id, chunk_text=chunk, embedding_id=embedding_id))
            any_added = True

    if any_added:
        # Create/update RLFeedback for audit
        feedback = db.query(RLFeedback).filter(RLFeedback.ticket_id == ticket.id).first()
        if feedback:
            feedback.validated_answer = full_text
            feedback.ingested = True
        else:
            feedback = RLFeedback(
                ticket_id=ticket.id,
                validated_answer=full_text,
                ingested=True
            )
            db.add(feedback)

        db.commit()
        return True

    return False
