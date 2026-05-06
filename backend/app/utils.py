from typing import List, TypedDict

ATTACHMENT_INGESTION_START = "\n\n[Attachment ingestion content]\n"
ATTACHMENT_INGESTION_END = "\n[End attachment ingestion content]"

class _SimpleDocument:
    def __init__(self, page_content: str):
        self.page_content = page_content


class RecursiveCharacterTextSplitter:
    """Minimal internal splitter to avoid heavy optional dependency imports at startup."""

    def __init__(
        self,
        chunk_size: int,
        chunk_overlap: int,
        separators: list[str] | None = None,
        length_function=len,
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.separators = separators or ["\n\n", "\n", " "]
        self.length_function = length_function

    def _split_text(self, text: str) -> list[str]:
        text = (text or "").strip()
        if not text:
            return []
        if self.length_function(text) <= self.chunk_size:
            return [text]

        chunks: list[str] = []
        start = 0
        text_len = len(text)
        while start < text_len:
            end = min(start + self.chunk_size, text_len)
            chunk = text[start:end]
            if end < text_len:
                best_break = -1
                for separator in self.separators:
                    if not separator:
                        continue
                    idx = chunk.rfind(separator)
                    if idx > best_break:
                        best_break = idx + len(separator)
                if best_break > 0:
                    chunk = chunk[:best_break]
                    end = start + best_break
            cleaned = chunk.strip()
            if cleaned:
                chunks.append(cleaned)
            if end >= text_len:
                break
            start = max(end - self.chunk_overlap, start + 1)
        return chunks

    def create_documents(self, texts: list[str]) -> list[_SimpleDocument]:
        docs: list[_SimpleDocument] = []
        for text in texts:
            docs.extend(_SimpleDocument(chunk) for chunk in self._split_text(text))
        return docs

DEFAULT_CHUNK_SIZE = 1000
DEFAULT_CHUNK_OVERLAP = 100


class ContentBlock(TypedDict):
    type: str
    content: str


def chunk_documents(
    texts: list[str],
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
):
    """Splits a list of texts into smaller chunks with overlap."""
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n"],
        length_function=len,
    )
    chunks = text_splitter.create_documents(texts)
    return [chunk.page_content for chunk in chunks]


def chunk_content_blocks(
    blocks: list[ContentBlock],
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
):
    """Split extracted content blocks while preserving table blocks as atomic units."""
    if not blocks:
        return []

    chunks: list[str] = []
    text_buffer: list[str] = []

    def flush_text_buffer():
        if not text_buffer:
            return
        buffered_text = "\n\n".join(part for part in text_buffer if part.strip())
        text_buffer.clear()
        if not buffered_text.strip():
            return
        chunks.extend(
            chunk_documents(
                [buffered_text],
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
            )
        )

    for block in blocks:
        block_type = block.get("type", "text")
        content = block.get("content", "")
        if not content or not content.strip():
            continue
        if block_type == "table":
            flush_text_buffer()
            chunks.append(content)
            continue
        text_buffer.append(content)

    flush_text_buffer()
    return chunks


def chunk_text(
    text: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
):
    """Chunk a single text string into a list of chunk strings."""
    if not text:
        return []
    return chunk_documents([text], chunk_size=chunk_size, chunk_overlap=chunk_overlap)


def build_stored_message_content(visible_content: str, extracted_sections: list[str]) -> str:
    visible = (visible_content or "").strip()
    sections = [section.strip() for section in extracted_sections if section and section.strip()]
    if not sections:
        return visible
    hidden_payload = "\n\n".join(sections)
    return f"{visible}{ATTACHMENT_INGESTION_START}{hidden_payload}{ATTACHMENT_INGESTION_END}".strip()


def strip_attachment_ingestion_content(text: str | None) -> str:
    content = (text or "").strip()
    if not content:
        return ""
    start = content.find(ATTACHMENT_INGESTION_START)
    if start == -1:
        return content
    return content[:start].rstrip()


def build_ingestion_text(text: str | None) -> str:
    content = (text or "").strip()
    if not content:
        return ""

    start = content.find(ATTACHMENT_INGESTION_START)
    end = content.find(ATTACHMENT_INGESTION_END)
    if start == -1 or end == -1 or end < start:
        return content

    visible = content[:start].strip()
    hidden = content[start + len(ATTACHMENT_INGESTION_START):end].strip()
    parts = [part for part in [visible, hidden] if part]
    return "\n\n".join(parts).strip()


def generate_reference_code(prefix: str = "AR") -> str:
    """Generate ticket reference code as PREFIX-<timestamp_ms>-<random_suffix>."""
    from datetime import datetime, timezone
    import secrets
    import string

    timestamp_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    alphabet = string.ascii_uppercase + string.digits
    random_suffix = "".join(secrets.choice(alphabet) for _ in range(6))
    return f"{prefix}-{timestamp_ms}-{random_suffix}"
