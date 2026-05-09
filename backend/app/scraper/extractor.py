"""Content extractor for MUST scraped pages and PDFs."""
import hashlib
import logging
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Optional, Tuple

import requests
import trafilatura
from bs4 import BeautifulSoup

from scripts.ingest_documents import extract_content_with_table_handling

logger = logging.getLogger("must.scraper.extractor")

ENABLE_PLAYWRIGHT = os.environ.get("ENABLE_PLAYWRIGHT", "false").strip().lower() == "true"
PDF_HEAD_TIMEOUT = float(os.environ.get("SCRAPER_PDF_HEAD_TIMEOUT", "15"))
PDF_DOWNLOAD_TIMEOUT = float(os.environ.get("SCRAPER_PDF_DOWNLOAD_TIMEOUT", "90"))
PDF_MAX_MB = float(os.environ.get("SCRAPER_PDF_MAX_MB", "300"))
PROFILE_LISTING_SEGMENTS = ("/academic-staff", "/administrative-staff", "/support-staff")
PROFILE_BOILERPLATE_TERMS = {
    "skip to content",
    "search",
    "home",
    "management",
    "academic staff",
    "administrative staff",
    "support must website",
    "must | directory",
}


@dataclass
class ExtractionResult:
    url: str
    title: str
    clean_text: str
    content_hash: str
    source_type: str  # "web_page" | "web_pdf"
    http_etag: Optional[str]
    http_last_modified: Optional[str]
    extracted_at: datetime
    error: Optional[str]


def compute_hash(text: str) -> str:
    """SHA-256 hex digest of UTF-8 text."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _decode_cloudflare_email(encoded: str) -> str:
    encoded = (encoded or "").strip()
    if len(encoded) < 2 or len(encoded) % 2 != 0:
        return ""

    try:
        key = int(encoded[:2], 16)
        return "".join(
            chr(int(encoded[index:index + 2], 16) ^ key)
            for index in range(2, len(encoded), 2)
        )
    except ValueError:
        return ""


def _replace_cloudflare_protected_emails(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    for node in soup.select(".__cf_email__"):
        encoded = node.get("data-cfemail") or ""
        decoded = _decode_cloudflare_email(encoded)
        if decoded:
            node.replace_with(decoded)

    for anchor in soup.find_all("a", href=True):
        href = anchor.get("href", "")
        match = re.search(r"/cdn-cgi/l/email-protection#([0-9a-fA-F]+)", href)
        if not match:
            continue
        decoded = _decode_cloudflare_email(match.group(1))
        if decoded:
            anchor["href"] = f"mailto:{decoded}"
            if not anchor.get_text(strip=True) or "[email protected]" in anchor.get_text(strip=True).lower():
                anchor.string = decoded

    return str(soup)


def _response_is_pdf(response: requests.Response) -> bool:
    content_type = response.headers.get("Content-Type", "").lower()
    if "application/pdf" in content_type:
        return True
    return response.url.lower().endswith(".pdf")


def _download_pdf(
    session: requests.Session,
    url: str,
    max_mb: float,
) -> Tuple[Optional[bytes], Optional[str], Optional[requests.Response]]:
    try:
        response = session.get(url, timeout=PDF_DOWNLOAD_TIMEOUT, allow_redirects=True, stream=True)
    except Exception as exc:
        return None, str(exc), None

    try:
        if response.status_code != 200:
            return None, f"GET returned {response.status_code}", response
        if not _response_is_pdf(response):
            return None, "Content-Type is not PDF", response

        content_length = response.headers.get("Content-Length")
        if content_length:
            size_mb = int(content_length) / (1024 ** 2)
            if size_mb > max_mb:
                return None, f"PDF skipped due to size limit ({size_mb:.1f} MB)", response

        pdf_bytes = bytearray()
        max_bytes = int(max_mb * 1024 ** 2)
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if not chunk:
                continue
            pdf_bytes.extend(chunk)
            if len(pdf_bytes) > max_bytes:
                size_mb = len(pdf_bytes) / (1024 ** 2)
                return None, f"PDF skipped due to size limit ({size_mb:.1f} MB)", response

        return bytes(pdf_bytes), None, response
    finally:
        response.close()


def _clean_html(html: str) -> str:
    html = _replace_cloudflare_protected_emails(html)
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.select("nav, header, footer, script, style"):
        tag.decompose()
    target = soup.find("main") or soup.find("article") or soup.body
    if target is None:
        return ""
    return "\n".join(part.strip() for part in target.stripped_strings)


def _is_profile_listing_url(url: str) -> bool:
    lowered = str(url or "").lower()
    return "profiles.must.ac.ug" in lowered and any(segment in lowered for segment in PROFILE_LISTING_SEGMENTS) and "/staff_member/" not in lowered


def _looks_like_profile_name(line: str) -> bool:
    text = str(line or "").strip()
    if not text:
        return False
    lowered = text.lower()
    if lowered in PROFILE_BOILERPLATE_TERMS:
        return False
    if any(char.isdigit() for char in text) or "@" in text or "http" in lowered:
        return False
    words = [word for word in text.split() if word]
    if not 2 <= len(words) <= 6:
        return False
    lowercase_connectors = {"of", "and", "for", "in", "to", "the"}
    return all(word[:1].isupper() or word.lower() in lowercase_connectors for word in words)


def _group_profile_listing_lines(lines: list[str]) -> list[str]:
    entries: list[list[str]] = []
    current: list[str] = []

    for raw_line in lines:
        line = str(raw_line or "").strip()
        if not line:
            continue
        lowered = line.lower()
        if lowered in PROFILE_BOILERPLATE_TERMS:
            continue
        if _looks_like_profile_name(line):
            if current:
                entries.append(current)
            current = [line]
            continue
        if current:
            current.append(line)

    if current:
        entries.append(current)

    return ["\n".join(entry) for entry in entries if entry]


def extract_html_page(url: str, html: str, response_headers: Dict[str, str]) -> ExtractionResult:
    """Extract clean readable text from an HTML page."""
    html = _replace_cloudflare_protected_emails(html)
    clean_text = trafilatura.extract(html, include_tables=True, include_links=False) or ""
    if len((clean_text or "").strip()) < 200:
        clean_text = _clean_html(html)
    title_tag = BeautifulSoup(html, "html.parser").find("title")
    title_text = title_tag.get_text(strip=True) if title_tag else ""
    hash_value = compute_hash(clean_text or "")
    return ExtractionResult(
        url=url,
        title=title_text,
        clean_text="\n".join(clean_text.splitlines()),
        content_hash=hash_value,
        source_type="web_page",
        http_etag=response_headers.get("ETag"),
        http_last_modified=response_headers.get("Last-Modified"),
        extracted_at=datetime.utcnow(),
        error=None,
    )


def extract_pdf_from_url(url: str) -> ExtractionResult:
    """Download and extract text from a remotely hosted PDF."""
    temp_path: Optional[str] = None
    session = requests.Session()
    session.headers.update({"User-Agent": "MUSTRagBot/1.0"})
    try:
        head = None
        try:
            head = session.head(url, timeout=PDF_HEAD_TIMEOUT, allow_redirects=True)
        except Exception as exc:
            logger.info("HEAD failed for PDF %s, falling back to GET: %s", url, exc)

        pdf_bytes = None
        download_response = None
        download_error = None

        if head is not None and head.status_code == 200 and _response_is_pdf(head):
            pdf_bytes, download_error, download_response = _download_pdf(session, url, PDF_MAX_MB)
        elif head is not None and head.status_code == 404:
            pdf_bytes, download_error, download_response = _download_pdf(session, url, PDF_MAX_MB)
            if pdf_bytes is None and download_response is None:
                return ExtractionResult(
                    url=url,
                    title="",
                    clean_text="",
                    content_hash="",
                    source_type="web_pdf",
                    http_etag=head.headers.get("ETag"),
                    http_last_modified=head.headers.get("Last-Modified"),
                    extracted_at=datetime.utcnow(),
                    error="HEAD returned 404",
                )
        else:
            pdf_bytes, download_error, download_response = _download_pdf(session, url, PDF_MAX_MB)

        if pdf_bytes is None:
            metadata_response = download_response or head
            return ExtractionResult(
                url=url,
                title="",
                clean_text="",
                content_hash="",
                source_type="web_pdf",
                http_etag=metadata_response.headers.get("ETag") if metadata_response is not None else None,
                http_last_modified=metadata_response.headers.get("Last-Modified") if metadata_response is not None else None,
                extracted_at=datetime.utcnow(),
                error=download_error or (f"HEAD returned {head.status_code}" if head is not None else "PDF download failed"),
            )

        temp_dir = tempfile.gettempdir()
        temp_path = os.path.join(temp_dir, f"must_scraped_{compute_hash(url)[:8]}.pdf")
        with open(temp_path, "wb") as tmp:
            tmp.write(pdf_bytes)
        blocks = extract_content_with_table_handling(temp_path)
        clean_text = "\n\n".join(block.get("content", "") for block in blocks)
        raw_hash = hashlib.sha256(pdf_bytes).hexdigest()
        return ExtractionResult(
            url=url,
            title=os.path.basename(url),
            clean_text=clean_text.strip(),
            content_hash=raw_hash,
            source_type="web_pdf",
            http_etag=(download_response.headers.get("ETag") if download_response is not None else (head.headers.get("ETag") if head is not None else None)),
            http_last_modified=(
                download_response.headers.get("Last-Modified")
                if download_response is not None
                else (head.headers.get("Last-Modified") if head is not None else None)
            ),
            extracted_at=datetime.utcnow(),
            error=None,
        )
    except Exception as exc:
        logger.warning("Failed to extract PDF %s: %s", url, exc)
        return ExtractionResult(
            url=url,
            title="",
            clean_text="",
            content_hash="",
            source_type="web_pdf",
            http_etag=None,
            http_last_modified=None,
            extracted_at=datetime.utcnow(),
            error=str(exc),
        )
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                logger.exception("Failed to remove temp file %s", temp_path)


def extract_profiles_page(url: str) -> ExtractionResult:
    """Extract staff profile content, using Playwright if enabled."""
    try:
        if ENABLE_PLAYWRIGHT:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch()
                page = browser.new_page(user_agent="MUSTRagBot/1.0")
                page.goto(url)
                page.wait_for_timeout(4000)
                html = page.content()
                page.close()
                browser.close()
        else:
            response = requests.get(url, timeout=20, headers={"User-Agent": "MUSTRagBot/1.0"})
            response.raise_for_status()
            html = response.text
        html = _replace_cloudflare_protected_emails(html)
        soup = BeautifulSoup(html, "html.parser")
        header = soup.find("h1")
        meta_sections = soup.select(".staff-content, .content") or [soup.body]
        text_lines: list[str] = []
        if header:
            text_lines.append(header.get_text(strip=True))
        for section in meta_sections:
            text_lines.extend(part.strip() for part in section.stripped_strings if part and part.strip())

        if _is_profile_listing_url(url):
            grouped_entries = _group_profile_listing_lines(text_lines)
            clean_text = "\n\n".join(grouped_entries)
        else:
            clean_text = "\n".join(text_lines)
        if len(clean_text) < 100:
            clean_text += "\n" + url
        hash_value = compute_hash(clean_text)
        return ExtractionResult(
            url=url,
            title=header.get_text(strip=True) if header else "",
            clean_text=clean_text,
            content_hash=hash_value,
            source_type="web_page",
            http_etag=None,
            http_last_modified=None,
            extracted_at=datetime.utcnow(),
            error=None,
        )
    except Exception as exc:
        logger.warning("Failed to extract profile %s: %s", url, exc)
        return ExtractionResult(
            url=url,
            title="",
            clean_text="",
            content_hash="",
            source_type="web_page",
            http_etag=None,
            http_last_modified=None,
            extracted_at=datetime.utcnow(),
            error=str(exc),
        )
