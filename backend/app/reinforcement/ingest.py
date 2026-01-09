from sqlalchemy.orm import Session

from backend.database.orm_models import (
    RLFeedback,
    RAGDocument,
    DocumentChunk
)

from app.vector_store import vector_store_manager
from app.utils import chunk_text


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
