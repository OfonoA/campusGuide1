import os
from time import perf_counter
from dotenv import load_dotenv
import pdfplumber
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import FAISS
from app.bm25_store import append_bm25_entry, save_bm25_corpus
from app.retrieval import (
    retrieve_relevant_context as hybrid_retrieve_relevant_context,
    retrieve_relevant_context_scored as hybrid_retrieve_relevant_context_scored,
)
from app.utils import chunk_content_blocks

# --- Load environment ---
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
EMBEDDINGS = OpenAIEmbeddings(openai_api_key=OPENAI_API_KEY)

# --- PDF Content Extraction ---

def extract_content_with_table_handling(pdf_path):
    """
    Extracts text and tables from a PDF, preserving table structure in markdown.
    Returns a list of content blocks.
    """
    content_blocks = []
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                table_bboxes = [table.bbox for table in tables if hasattr(table, 'bbox')]

                def clean_cell(cell):
                    if cell is None:
                        return ""
                    return str(cell).replace("\n", " ").strip()

                def is_within_table(obj):
                    for bbox in table_bboxes:
                        if bbox[0] <= obj['x0'] < obj['x1'] <= bbox[2] and bbox[1] <= obj['top'] < obj['bottom'] <= bbox[3]:
                            return True
                    return False

                # Non-table text
                text_elements = [obj['text'] for obj in page.extract_words() if not is_within_table(obj)]
                page_text = " ".join(text_elements).strip()
                if page_text:
                    content_blocks.append({"type": "text", "content": page_text})

                # Tables
                for table in tables:
                    if not table:
                        continue
                    table_string = "TABLE START\n"
                    if table[0]:
                        header_row = [clean_cell(cell) for cell in table[0]]
                        table_string += "| " + " | ".join(header_row) + " |\n"
                        table_string += "| " + " | ".join(["---"] * len(table[0])) + " |\n"
                    for row in table[1:]:
                        clean_row = [clean_cell(cell) for cell in row]
                        table_string += "| " + " | ".join(clean_row) + " |\n"
                    table_string += "TABLE END"
                    content_blocks.append({"type": "table", "content": table_string})
    except Exception as e:
        print(f"Error processing {pdf_path}: {e}")
        # Fallback: basic text extraction
        from langchain_community.document_loaders import PyPDFLoader
        loader = PyPDFLoader(pdf_path)
        documents = loader.load()
        for doc in documents:
            content_blocks.append({"type": "text", "content": doc.page_content})
    return content_blocks

# --- Ingestion ---

def ingest_documents(directory="university_documents", index_path="faiss_index"):
    """
    Extracts, chunks, and indexes PDF documents into FAISS.
    """
    all_texts = []
    metadatas = []

    for filename in os.listdir(directory):
        if filename.endswith(".pdf"):
            file_path = os.path.join(directory, filename)
            print(f"Processing: {file_path}")
            try:
                content_blocks = extract_content_with_table_handling(file_path)
                if content_blocks:
                    texts = chunk_content_blocks(content_blocks)
                    all_texts.extend(texts)
                    metadatas.extend([{"source": filename} for _ in texts])
            except Exception as e:
                print(f"Error processing {file_path}: {e}")

    if all_texts:
        try:
            vector_store = FAISS.from_texts(all_texts, EMBEDDINGS, metadatas=metadatas)
            vector_store.save_local(index_path)
            save_bm25_corpus(all_texts, metadatas)
            print("Document ingestion and indexing complete.")
        except Exception as e:
            print(f"Error saving FAISS index: {e}")
    else:
        print("No text extracted from documents.")

# --- Retrieval ---

def retrieve_relevant_context_scored(query, index_path="faiss_index", top_k=5):
    start = perf_counter()
    try:
        results = hybrid_retrieve_relevant_context_scored(query, index_path=index_path, top_k=top_k)
        retrieval_ms = (perf_counter() - start) * 1000
        print(f"[perf] retrieval_ms={retrieval_ms:.2f} top_k={top_k} returned={len(results)}")
        return results
    except Exception as e:
        print(f"Error retrieving context: {str(e)}")
        retrieval_ms = (perf_counter() - start) * 1000
        print(f"[perf] retrieval_ms={retrieval_ms:.2f} top_k={top_k} returned=0 error=1")
        return []


def retrieve_relevant_context(query, index_path="faiss_index", top_k=5):
    """
    Backward-compatible wrapper that returns only chunk text.
    """
    return hybrid_retrieve_relevant_context(query, index_path=index_path, top_k=top_k)

# --- Optional: Adding new documents later ---

def add_new_document(file_path, index_path="faiss_index"):
    """
    Adds a single new PDF to the existing FAISS index.
    """
    try:
        content_blocks = extract_content_with_table_handling(file_path)
        new_chunks = chunk_content_blocks(content_blocks)
        vector_store = FAISS.load_local(index_path, EMBEDDINGS)
        vector_store.add_texts(new_chunks, metadatas=[{"source": file_path} for _ in new_chunks])
        vector_store.save_local(index_path)
        for chunk in new_chunks:
            append_bm25_entry(chunk, {"source": file_path})
        print(f"{file_path} added to index.")
    except Exception as e:
        print(f"Error adding new document: {e}")

def inspect_index(index_path="faiss_index"):
    """Debug function to inspect index contents"""
    try:
        from faiss import read_index
        import pickle
        
        # Load FAISS index
        faiss_index = read_index(os.path.join(index_path, "index.faiss"))
        
        # Load metadata - now handles both tuple and dict formats
        with open(os.path.join(index_path, "index.pkl"), "rb") as f:
            metadata = pickle.load(f)
            
        print(f"\n=== Index Overview ===")
        print(f"Vectors: {faiss_index.ntotal}")
        
        # Handle different metadata formats
        if isinstance(metadata, dict):
            print("\nMetadata format: dict")
            print(f"Keys: {metadata.keys()}")
            if 'documents' in metadata:
                print(f"\nSample document (first 200 chars):")
                print(metadata['documents'][0][:200] + "...")
        elif isinstance(metadata, tuple):
            print("\nMetadata format: tuple")
            print(f"Length: {len(metadata)}")
            print("\nFirst 3 items in tuple:")
            for i, item in enumerate(metadata[:3]):
                print(f"[{i}] Type: {type(item)}, Length: {len(item) if hasattr(item, '__len__') else 'N/A'}")
                print(f"Sample: {str(item)[:100]}...")
        else:
            print(f"\nUnknown metadata type: {type(metadata)}")
            
        # Additional checks
        print("\n=== Index Health Check ===")
        try:
            test_query = "university"
            vector_store = FAISS.load_local(index_path, EMBEDDINGS, allow_dangerous_deserialization=True)
            results = vector_store.similarity_search(test_query, k=1)
            print(f"Test query '{test_query}' returned {len(results)} results")
            if results:
                print(f"Top result: {results[0].page_content[:200]}...")
        except Exception as e:
            print(f"Query test failed: {str(e)}")
            
    except Exception as e:
        print(f"\nError inspecting index: {str(e)}")
        if "index.faiss" in str(e):
            print("-> Missing or corrupt FAISS index file")
        elif "index.pkl" in str(e):
            print("-> Missing or corrupt metadata file")
            
# --- Main execution ---

if __name__ == "__main__":
    ingest_documents()
    inspect_index() 


    
