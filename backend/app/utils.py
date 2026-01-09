from typing import List
from langchain.text_splitter import RecursiveCharacterTextSplitter

def chunk_documents(texts: list[str], chunk_size: int = 1500, chunk_overlap: int = 0):
    """Splits a list of texts into smaller chunks with overlap."""
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n"],
        length_function=len,
    )
    chunks = text_splitter.create_documents(texts)
    return [chunk.page_content for chunk in chunks]


def chunk_text(text: str, chunk_size: int = 1500, chunk_overlap: int = 0):
    """Chunk a single text string into a list of chunk strings."""
    if not text:
        return []
    return chunk_documents([text], chunk_size=chunk_size, chunk_overlap=chunk_overlap)


def generate_reference_code(prefix: str = "AR") -> str:
    """Generate a short, human-friendly reference code for tickets.

    The format is PREFIX-YYYYMMDDHHMMSS to keep codes compact and reasonably unique.
    """
    from datetime import datetime

    return f"{prefix}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"