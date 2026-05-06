from app.scraper.ingest_web import WebIngestionService
from database.orm_models import DocumentChunk, RAGDocument


def test_build_bm25_metadata_preserves_source_fields():
    service = WebIngestionService(db_session=None)  # type: ignore[arg-type]
    chunk = DocumentChunk(document_id=12, embedding_id="emb-123", chunk_text="chunk body")
    document = RAGDocument(
        id=12,
        source="manual",
        title="Administrative Staff",
        source_reference="https://profiles.must.ac.ug/administrative-staff/3",
        source_url="https://profiles.must.ac.ug/administrative-staff/3",
        source_type="web_page",
    )

    metadata = service._build_bm25_metadata(chunk, document)

    assert metadata == {
        "document_id": 12,
        "embedding_id": "emb-123",
        "source": "web_page",
        "title": "Administrative Staff",
        "url": "https://profiles.must.ac.ug/administrative-staff/3",
        "source_url": "https://profiles.must.ac.ug/administrative-staff/3",
        "source_reference": "https://profiles.must.ac.ug/administrative-staff/3",
        "page_type": "web_page",
    }
