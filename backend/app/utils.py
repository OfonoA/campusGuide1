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
        """Split text into chunks by sentences to preserve sentence integrity.

        Heuristic sentence splitter (regex) avoids heavy dependencies and
        builds chunks by joining sentences until reaching `chunk_size`. The
        overlap is applied in sentence units approximated from average
        sentence length to preserve context across chunk boundaries.
        """
        text = (text or "").strip()
        if not text:
            return []
        if self.length_function(text) <= self.chunk_size:
            return [text]

        # Simple sentence splitter (keeps delimiters)
        import re

        sentence_end_re = re.compile(r"(.+?(?:[\.\!\?][\)\]\"']*|\n)(?:\s+|$))", re.S)
        sentences = [m.group(0).strip() for m in sentence_end_re.finditer(text)]
        if not sentences:
            # Fallback to character-based splitting if sentence tokenizer fails
            sentences = [text]

        total_sentences = len(sentences)
        avg_sent_len = max(40, sum(len(s) for s in sentences) // max(1, total_sentences))
        # approximate overlap in sentences
        overlap_sentences = max(1, int(self.chunk_overlap // avg_sent_len))

        chunks: list[str] = []
        start_idx = 0
        while start_idx < total_sentences:
            previous_start_idx = start_idx
            cur_len = 0
            end_idx = start_idx
            while end_idx < total_sentences and cur_len + len(sentences[end_idx]) <= self.chunk_size:
                cur_len += len(sentences[end_idx]) + 1
                end_idx += 1

            # If a single sentence is longer than chunk_size, force split character-wise
            if end_idx == start_idx:
                long_sentence = sentences[start_idx]
                # fallback: split long sentence into char chunks
                pos = 0
                while pos < len(long_sentence):
                    part = long_sentence[pos : pos + self.chunk_size]
                    chunks.append(part.strip())
                    pos += self.chunk_size - self.chunk_overlap if self.chunk_size > self.chunk_overlap else self.chunk_size
                start_idx += 1
                continue

            chunk = " ".join(sentences[start_idx:end_idx]).strip()
            if chunk:
                chunks.append(chunk)

            if end_idx >= total_sentences:
                break

            # move start_idx back by overlap_sentences to create overlap
            start_idx = max(0, end_idx - overlap_sentences)

            # avoid infinite loops
            if start_idx <= previous_start_idx:
                start_idx = end_idx
            if start_idx >= total_sentences:
                break

        return chunks

    def create_documents(self, texts: list[str]) -> list[_SimpleDocument]:
        docs: list[_SimpleDocument] = []
        for text in texts:
            docs.extend(_SimpleDocument(chunk) for chunk in self._split_text(text))
        return docs

DEFAULT_CHUNK_SIZE = 800
DEFAULT_CHUNK_OVERLAP = 200


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
