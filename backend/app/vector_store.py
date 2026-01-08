import os
from typing import List
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import FAISS
from dotenv import load_dotenv

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

class VectorStoreManager:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(VectorStoreManager, cls).__new__(cls)
            cls._instance.embeddings = OpenAIEmbeddings(openai_api_key=OPENAI_API_KEY)
            cls._instance.vector_store = None
        return cls._instance

    def load_or_create_store(self, texts: List[str] = None, index_path: str = "faiss_index"):
        """Loads an existing FAISS index or creates a new one from texts."""
        if os.path.exists(index_path):
            try:
                self.vector_store = FAISS.load_local(
                    index_path,
                    self.embeddings,
                    allow_dangerous_deserialization=True  # Add this parameter
                )
                print(f"Loaded existing FAISS index from {index_path}")
            except Exception as e:
                import traceback
                print(f"Error loading existing FAISS index: {e}")
                traceback.print_exc()
                self.vector_store = None # Handle loading failure
        elif texts:
            try:
                self.vector_store = FAISS.from_texts(texts, self.embeddings)
                self.vector_store.save_local(index_path)
                print(f"Created and saved new FAISS index to {index_path}")
            except Exception as e:
                print(f"Error saving FAISS index: {e}")
                self.vector_store = None
        else:
            self.vector_store = None
            print("No existing FAISS index found and no texts provided.")

    def add_documents(self, texts: List[str], index_path: str = "faiss_index"):
        """Adds new documents to the existing FAISS index."""
        if self.vector_store is None:
            self.load_or_create_store(index_path=index_path)
        if self.vector_store:
            new_vector_store = FAISS.from_texts(texts, self.embeddings)
            self.vector_store.merge_from(new_vector_store)
            self.vector_store.save_local(index_path)
            print(f"Added new documents and updated FAISS index at {index_path}")
        else:
            print("Vector store not initialized. Cannot add documents.")

    def search(self, query: str, k: int = 5):
        """Searches the FAISS index for the top k relevant documents."""
        if self.vector_store:
            return self.vector_store.similarity_search(query, k=k)
        else:
            print("Vector store not initialized. Cannot perform search.")
            return []

# Singleton instance of the VectorStoreManager
vector_store_manager = VectorStoreManager()
