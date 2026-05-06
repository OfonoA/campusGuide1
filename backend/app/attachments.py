from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
import os
import secrets

from fastapi import HTTPException, UploadFile


MAX_ATTACHMENT_FILES = 3
MAX_ATTACHMENT_FILE_BYTES = 5 * 1024 * 1024
MAX_ATTACHMENT_TEXT_CHARS = 12000
ATTACHMENT_STORAGE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "uploaded_attachments")
)


@dataclass
class ProcessedAttachment:
    original_filename: str
    stored_filename: str
    stored_path: str
    content_type: str | None
    file_size_bytes: int
    extracted_text: str


def _safe_filename(filename: str) -> str:
    cleaned = os.path.basename((filename or "attachment").strip()) or "attachment"
    return "".join(ch for ch in cleaned if ch.isalnum() or ch in {"-", "_", ".", " "}).strip() or "attachment"


def _extract_text_from_bytes(filename: str, raw: bytes) -> str:
    suffix = os.path.splitext(filename.lower())[1]
    if suffix in {".txt", ".md", ".csv"}:
        return raw.decode("utf-8", errors="ignore").strip()
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader

            reader = PdfReader(BytesIO(raw))
            return "\n".join((page.extract_text() or "") for page in reader.pages).strip()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Could not read PDF {filename}: {exc}") from exc
    raise HTTPException(status_code=400, detail=f"Unsupported file type for {filename}. Use PDF, TXT, MD, or CSV.")


def process_message_uploads(files: list[UploadFile]) -> list[ProcessedAttachment]:
    if not files:
        return []
    if len(files) > MAX_ATTACHMENT_FILES:
        raise HTTPException(status_code=400, detail=f"You can attach up to {MAX_ATTACHMENT_FILES} files per message")

    os.makedirs(ATTACHMENT_STORAGE_DIR, exist_ok=True)
    processed: list[ProcessedAttachment] = []

    for file in files:
        filename = _safe_filename(file.filename or "attachment")
        raw = file.file.read()
        if not raw:
            continue
        if len(raw) > MAX_ATTACHMENT_FILE_BYTES:
            raise HTTPException(status_code=400, detail=f"{filename} exceeds the 5 MB upload limit")

        stored_filename = f"{secrets.token_hex(8)}_{filename}"
        stored_path = os.path.join(ATTACHMENT_STORAGE_DIR, stored_filename)
        with open(stored_path, "wb") as target:
            target.write(raw)

        processed.append(
            ProcessedAttachment(
                original_filename=filename,
                stored_filename=stored_filename,
                stored_path=stored_path,
                content_type=file.content_type,
                file_size_bytes=len(raw),
                extracted_text=_extract_text_from_bytes(filename, raw),
            )
        )

    return processed


def build_attachment_note(file_names: list[str]) -> str:
    if not file_names:
        return ""
    return f"\n\n[Attached files: {', '.join(file_names)}]"
