import os
from dotenv import load_dotenv
import pdfplumber
from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import FAISS

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
                    table_string = "TABLE START\n"
                    if table[0]:
                        table_string += "| " + " | ".join(table[0]) + " |\n"
                        table_string += "| " + " | ".join(["---"] * len(table[0])) + " |\n"
                    for row in table[1:]:
                        clean_row = [cell.replace("\n", " ").strip() if cell else "" for cell in row]
                        table_string += "| " + " | ".join(clean_row) + " |\n"
                    table_string += "TABLE END"
                    content_blocks.append({"type": "table", "content": table_string})
    except Exception as e:
        print(f"Error processing {pdf_path}: {e}")
        # Fallback: basic text extraction
        loader = PyPDFLoader(pdf_path)
        documents = loader.load()
        for doc in documents:
            content_blocks.append({"type": "text", "content": doc.page_content})
    return content_blocks

# --- Chunking ---

def chunk_documents(blocks, chunk_size=1000, chunk_overlap=100):
    """
    Splits content into chunks while preserving table blocks.
    """
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    chunks = []

    for block in blocks:
        if block["type"] == "table":
            chunks.append(block["content"])
        else:
            split_texts = text_splitter.split_text(block["content"])
            chunks.extend(split_texts)

    return chunks

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
                    texts = chunk_documents(content_blocks)
                    all_texts.extend(texts)
                    metadatas.extend([{"source": filename} for _ in texts])
            except Exception as e:
                print(f"Error processing {file_path}: {e}")

    if all_texts:
        try:
            vector_store = FAISS.from_texts(all_texts, EMBEDDINGS, metadatas=metadatas)
            vector_store.save_local(index_path)
            print("Document ingestion and indexing complete.")
        except Exception as e:
            print(f"Error saving FAISS index: {e}")
    else:
        print("No text extracted from documents.")

# --- Retrieval ---

def retrieve_relevant_context(query, index_path="faiss_index", top_k=5):
    """
    Searches the FAISS index and returns top_k most relevant document chunks for a query.
    """
    try:
        print(f"Attempting to load FAISS index from {index_path}")
        if not os.path.exists(index_path):
            raise FileNotFoundError(f"Index directory {index_path} does not exist")
            
        # Verify index files exist
        required_files = ['index.faiss', 'index.pkl']
        for f in required_files:
            if not os.path.exists(os.path.join(index_path, f)):
                raise FileNotFoundError(f"Missing index file: {f}")

        # Load with explicit permissions
        vector_store = FAISS.load_local(
            index_path, 
            EMBEDDINGS,
            allow_dangerous_deserialization=True
        )
        
        print(f"Running similarity search for: '{query}'")
        docs_and_scores = vector_store.similarity_search_with_score(query, k=top_k)
        
        if not docs_and_scores:
            print("Warning: No results found for query")
            return []
            
        print("Top results:")
        for i, (doc, score) in enumerate(docs_and_scores):
            print(f"[{i+1}] Score: {score:.2f}")
            print(f"Content: {doc.page_content[:200]}...")
            print(f"Metadata: {doc.metadata}\n")
            
        return [doc.page_content for doc, _ in docs_and_scores]
        
    except Exception as e:
        print(f"Error retrieving context: {str(e)}")
        return []

# --- Optional: Adding new documents later ---

def add_new_document(file_path, index_path="faiss_index"):
    """
    Adds a single new PDF to the existing FAISS index.
    """
    try:
        content_blocks = extract_content_with_table_handling(file_path)
        new_chunks = chunk_documents(content_blocks)
        vector_store = FAISS.load_local(index_path, EMBEDDINGS)
        vector_store.add_texts(new_chunks, metadatas=[{"source": file_path} for _ in new_chunks])
        vector_store.save_local(index_path)
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


    