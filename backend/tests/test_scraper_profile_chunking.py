from datetime import datetime

from app.scraper.extractor import _group_profile_listing_lines
from app.scraper.ingest_web import WebIngestionService
from app.scraper.extractor import ExtractionResult


def test_group_profile_listing_lines_creates_entry_blocks():
    lines = [
        "Administrative Staff",
        "Kemirembe Moreen",
        "Assistant Academic Registrar",
        "Office of the Academic Registrar",
        "Lasto Mubiru",
        "Senior IT Officer",
        "Department of ICT Services",
    ]

    grouped = _group_profile_listing_lines(lines)

    assert len(grouped) == 2
    assert grouped[0].startswith("Kemirembe Moreen")
    assert "Assistant Academic Registrar" in grouped[0]
    assert grouped[1].startswith("Lasto Mubiru")


def test_build_content_blocks_splits_profile_listings_on_blank_lines():
    service = WebIngestionService(db_session=None)  # type: ignore[arg-type]
    result = ExtractionResult(
        url="https://profiles.must.ac.ug/administrative-staff/3",
        title="Administrative Staff",
        clean_text="Kemirembe Moreen\nAssistant Academic Registrar\n\nLasto Mubiru\nSenior IT Officer",
        content_hash="hash",
        source_type="web_page",
        http_etag=None,
        http_last_modified=None,
        extracted_at=datetime.utcnow(),
        error=None,
    )

    blocks = service._build_content_blocks(result.url, result)

    assert blocks == [
        {"type": "text", "content": "Kemirembe Moreen\nAssistant Academic Registrar"},
        {"type": "text", "content": "Lasto Mubiru\nSenior IT Officer"},
    ]
