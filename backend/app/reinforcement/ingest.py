from sqlalchemy.orm import Session

from database.orm_models import (
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

    # Fetch un-ingested validated feedback
    feedback_entries = db.query(RLFeedback).filter(
        RLFeedback.ingested == False,
        RLFeedback.confidence == "high"
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

        #  Chunk the validated answer
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

            # Persist chunk metadata
            chunk_record = DocumentChunk(
                document_id=rag_doc.id,
                chunk_text=chunk,
                embedding_id=embedding_id
            )
            db.add(chunk_record)

        # Mark feedback as ingested
        feedback.ingested = True

        db.commit()

    print("Reinforcement ingestion completed.")
