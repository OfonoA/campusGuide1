"""Live fetching helpers for freshness-sensitive queries."""
import logging
from datetime import datetime
from typing import Dict, List, Optional

import requests
from app.document_model import Document
from app.utils import chunk_content_blocks

from .extractor import extract_html_page

logger = logging.getLogger("must.scraper.freshness")

FRESHNESS_URL_MAP = {
    "entry requirements": "https://www.must.ac.ug/study-at-must/admissions/application-guidelines/",
    "application deadline": "https://www.must.ac.ug/announcement_type/call-for-applications/",
    "deadline": "https://www.must.ac.ug/notice-board/",
    "admission list": "https://www.must.ac.ug/admission-lists/",
    "academic calendar": "https://www.must.ac.ug/academic-calendar/",
    "scholarship": "https://www.must.ac.ug/announcement_type/scholarship-opportunities/",
    "postgraduate program": "https://www.must.ac.ug/graduate-programmes/",
    "postgraduate programme": "https://www.must.ac.ug/graduate-programmes/",
    "graduate program": "https://www.must.ac.ug/graduate-programmes/",
    "graduate programme": "https://www.must.ac.ug/graduate-programmes/",
    "masters": "https://www.must.ac.ug/graduate-programmes/",
    "master's": "https://www.must.ac.ug/graduate-programmes/",
    "phd": "https://www.must.ac.ug/graduate-programmes/",
    "announcement": "https://www.must.ac.ug/notice-board/",
    "notice": "https://www.must.ac.ug/notice-board/",
    "fees": "https://www.must.ac.ug/undergraduate-programmes/",
    "tuition": "https://www.must.ac.ug/undergraduate-programmes/",
    "news": "https://www.must.ac.ug/news/",
}

FRESHNESS_SIGNALS = [
    "today",
    "current",
    "latest",
    "now",
    "this week",
    "this semester",
    "deadline",
    "opening",
    "notice",
    "announcement",
    "recent",
    "2025",
    "2026",
    "2027",
]


def is_freshness_sensitive(query: str) -> bool:
    """Return True if query contains any freshness signal."""
    lowered = query.lower()
    if any(term in lowered for term in (
        "postgraduate program",
        "postgraduate programme",
        "graduate program",
        "graduate programme",
        "masters",
        "master's",
        "phd",
    )):
        return True
    return any(signal in lowered for signal in FRESHNESS_SIGNALS)


def _pick_url(query: str) -> Optional[str]:
    lowered = query.lower()
    for topic, url in FRESHNESS_URL_MAP.items():
        if topic in lowered:
            return url
    return None


def get_live_context(query: str) -> Optional[List[Document]]:
    """Return live chunks for freshness-sensitive queries."""
    if not is_freshness_sensitive(query):
        return None
    url = _pick_url(query)
    if not url:
        return None
    try:
        headers = {"User-Agent": "MUSTRagBot/1.0"}
        response = requests.get(url, timeout=15, headers=headers)
        response.raise_for_status()
        result = extract_html_page(url, response.text, response.headers)
        if not result.clean_text:
            return None
        chunks = chunk_content_blocks([{"type": "text", "content": result.clean_text}])
        documents: List[Document] = []
        for chunk in chunks:
            documents.append(Document(
                page_content=chunk,
                metadata={
                    "source": "live_fetch",
                    "url": url,
                    "fetched_at": datetime.utcnow().isoformat(),
                },
            ))
        return documents
    except Exception as exc:  # pragma: no cover
        logger.warning("Live fetch failed for %s: %s", url, exc)
        return None
