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