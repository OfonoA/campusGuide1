"""Web ingestion pipeline that reuses chunking/FAISS helpers."""
import logging
import os
import random
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional, Tuple

import requests
from sqlalchemy.orm import Session

from app.bm25_store import save_bm25_corpus
from app.utils import chunk_content_blocks
from app.vector_store import vector_store_manager
from database.orm_models import DocumentChunk, RAGDocument
from .extractor import ExtractionResult, extract_html_page, extract_pdf_from_url, extract_profiles_page

logger = logging.getLogger("must.scraper.ingest_web")

SCRAPER_DELAY = float(os.environ.get("SCRAPER_CRAWL_DELAY", "1.5"))
SCRAPER_TIMEOUT = float(os.environ.get("SCRAPER_REQUEST_TIMEOUT", "15"))


@dataclass
class IngestResult:
    url: str
    status: str
    chunks_added: int
    chunks_removed: int
    error: Optional[str]


@dataclass
class BatchIngestResult:
    total: int
    ingested: int
    skipped: int
    failed: int
    errors: List[Tuple[str, str]]
    duration_seconds: float


class WebIngestionService:
    """Handles extraction, change detection, and vector updates for web sources."""

    def __init__(self, db_session: Session):
        self.db = db_session

    def _build_bm25_metadata(self, chunk: DocumentChunk, document: Optional[RAGDocument]) -> dict:
        doc = document or RAGDocument()
        return {
            "document_id": chunk.document_id,
            "embedding_id": chunk.embedding_id,
            "source": doc.source_type or doc.source,
            "title": doc.title,
            "url": doc.source_url,
            "source_url": doc.source_url,
            "source_reference": doc.source_reference,
            "page_type": doc.source_type,
        }

    def _sync_bm25_corpus(self) -> None:
        rows = (
            self.db.query(DocumentChunk, RAGDocument)
            .outerjoin(RAGDocument, RAGDocument.id == DocumentChunk.document_id)
            .order_by(DocumentChunk.id)
            .all()
        )
        save_bm25_corpus(
            [chunk.chunk_text for chunk, _document in rows],
            [self._build_bm25_metadata(chunk, document) for chunk, document in rows],
        )

    def _build_content_blocks(self, url: str, result: ExtractionResult) -> list[dict[str, str]]:
        clean_text = str(result.clean_text or "").strip()
        if not clean_text:
            return []

        if "profiles.must.ac.ug" in str(url or "").lower() and "/staff_member/" not in str(url or "").lower():
            blocks = [
                {"type": "text", "content": block.strip()}
                for block in clean_text.split("\n\n")
                if block and block.strip()
            ]
            if blocks:
                return blocks

        return [{"type": "text", "content": clean_text}]

    def ingest_url(self, url: str, force: bool = False) -> IngestResult:
        """Ingest a single URL, returns status + stats."""
        try:
            result = self._extract_url(url)
            if result.error:
                raise RuntimeError(result.error)
        except Exception as exc:
            logger.warning("Extraction failed for %s: %s", url, exc)
            return IngestResult(url=url, status="failed", chunks_added=0, chunks_removed=0, error=str(exc))

        if len(result.clean_text.strip()) < 200:
            logger.info("Skipping %s: clean text too short", url)
            return IngestResult(url=url, status="skipped", chunks_added=0, chunks_removed=0, error="text too short")

        doc = self.db.query(RAGDocument).filter(RAGDocument.source_url == url).first()
        if not force and not self._check_changed(doc, result):
            if doc:
                doc.last_scraped_at = datetime.utcnow()
                doc.scrape_status = "skipped"
                self.db.commit()
            return IngestResult(url=url, status="skipped", chunks_added=0, chunks_removed=0, error=None)

        chunks_removed = 0
        if doc:
            chunks_removed = self._delete_existing_chunks(doc.id)
        else:
            doc = RAGDocument()
            self.db.add(doc)
            self.db.flush()

        chunks = chunk_content_blocks(self._build_content_blocks(url, result))
        added = 0
        for chunk in chunks:
            embedding_id = vector_store_manager.add_text(
                text=chunk,
                metadata={"source": result.source_type, "url": url},
            )
            if not embedding_id:
                continue
            self.db.add(DocumentChunk(document_id=doc.id, chunk_text=chunk, embedding_id=embedding_id))
            added += 1

        doc.source = doc.source or "manual"
        doc.title = result.title or doc.title
        doc.source_reference = url
        doc.content_hash = result.content_hash
        doc.source_type = result.source_type
        doc.source_url = url
        doc.last_scraped_at = datetime.utcnow()
        doc.scrape_status = "success"
        doc.http_etag = result.http_etag
        doc.http_last_mod = result.http_last_modified
        doc.created_at = doc.created_at or datetime.utcnow()
        self.db.commit()
        self._sync_bm25_corpus()

        return IngestResult(
            url=url,
            status="ingested",
            chunks_added=added,
            chunks_removed=chunks_removed,
            error=None,
        )

    def _check_changed(self, doc: Optional[RAGDocument], result: ExtractionResult) -> bool:
        if doc is None:
            return True
        if doc.http_etag and result.http_etag and doc.http_etag == result.http_etag:
            return False
        if doc.http_last_mod and result.http_last_modified and doc.http_last_mod == result.http_last_modified:
            return False
        if doc.content_hash and result.content_hash and doc.content_hash == result.content_hash:
            return False
        return True

    def _delete_existing_chunks(self, rag_document_id: int) -> int:
        chunks = (
            self.db.query(DocumentChunk)
            .filter(DocumentChunk.document_id == rag_document_id)
            .all()
        )
        embedding_ids = [chunk.embedding_id for chunk in chunks if chunk.embedding_id]
        removed = vector_store_manager.remove_by_ids(embedding_ids)
        for chunk in chunks:
            self.db.delete(chunk)
        self.db.commit()
        return removed

    def ingest_batch(self, urls: List[str], force: bool = False) -> BatchIngestResult:
        """Sequentially ingest URLs with delays."""
        start = time.perf_counter()
        ingested = skipped = failed = 0
        errors: List[Tuple[str, str]] = []
        for idx, url in enumerate(urls, start=1):
            result = self.ingest_url(url, force=force)
            if result.status == "ingested":
                ingested += 1
            elif result.status == "skipped":
                skipped += 1
            else:
                failed += 1
                errors.append((url, result.error or "unknown"))
            if idx % 10 == 0:
                logger.info("Processed %d URLs (ingested=%d skipped=%d failed=%d)", idx, ingested, skipped, failed)
            delay = SCRAPER_DELAY + random.uniform(0, 0.5)
            time.sleep(delay)
        duration = time.perf_counter() - start
        return BatchIngestResult(
            total=len(urls),
            ingested=ingested,
            skipped=skipped,
            failed=failed,
            errors=errors,
            duration_seconds=duration,
        )

    def _extract_url(self, url: str) -> ExtractionResult:
        if url.lower().endswith(".pdf"):
            return extract_pdf_from_url(url)
        if "profiles.must.ac.ug" in url:
            return extract_profiles_page(url)
        response = requests.get(url, timeout=SCRAPER_TIMEOUT, headers={"User-Agent": "MUSTRagBot/1.0"})
        response.raise_for_status()
        return extract_html_page(url, response.text, response.headers)
