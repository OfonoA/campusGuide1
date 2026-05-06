import os
import logging
from typing import List

import faiss
import numpy as np
from dotenv import load_dotenv
from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings
from openai import APIError, APIStatusError, AuthenticationError, RateLimitError
from app.bm25_store import append_bm25_entry, save_bm25_corpus

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
DEFAULT_INDEX_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "faiss_index")
)

logger = logging.getLogger("must.scraper.vector_store")


def _is_openai_provider_error(exc: Exception) -> bool:
    return isinstance(exc, (APIError, APIStatusError, AuthenticationError, RateLimitError))


class VectorStoreManager:
    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(VectorStoreManager, cls).__new__(cls)
            cls._instance.embeddings = OpenAIEmbeddings(openai_api_key=OPENAI_API_KEY)
            cls._instance.vector_store = None
            cls._instance.index_path = DEFAULT_INDEX_PATH
            cls._instance._id_map_wrapped = False
            cls._instance._migration_warned = False
        return cls._instance

    def _resolve_index_path(self, index_path: str | None = None) -> str:
        return os.path.abspath(index_path or self.index_path)

    def load_or_create_store(self, texts: List[str] = None, index_path: str | None = None):
        """Loads an existing FAISS index or creates a new one from texts."""
        resolved_index_path = self._resolve_index_path(index_path)
        if os.path.exists(resolved_index_path):
            try:
                self.vector_store = FAISS.load_local(
                    resolved_index_path,
                    self.embeddings,
                    allow_dangerous_deserialization=True,
                )
                self.index_path = resolved_index_path
                logger.info("Loaded existing FAISS index from %s", resolved_index_path)
            except Exception as exc:  # pragma: no cover - operational
                logger.error("Error loading existing FAISS index: %s", exc)
                self.vector_store = None
        elif texts:
            try:
                self.vector_store = FAISS.from_texts(texts, self.embeddings)
                os.makedirs(resolved_index_path, exist_ok=True)
                self.vector_store.save_local(resolved_index_path)
                save_bm25_corpus(texts)
                self.index_path = resolved_index_path
                logger.info("Created and saved new FAISS index to %s", resolved_index_path)
            except Exception as exc:  # pragma: no cover - operational
                logger.error("Error saving FAISS index: %s", exc)
                self.vector_store = None
        else:
            self.vector_store = None
            logger.warning("No existing FAISS index found and no texts provided.")

    def add_documents(self, texts: List[str], index_path: str | None = None):
        """Adds new documents to the existing FAISS index."""
        resolved_index_path = self._resolve_index_path(index_path)
        if self.vector_store is None:
            self.load_or_create_store(index_path=resolved_index_path)
        if self.vector_store:
            new_vector_store = FAISS.from_texts(texts, self.embeddings)
            self.vector_store.merge_from(new_vector_store)
            self.vector_store.save_local(resolved_index_path)
            for text in texts:
                append_bm25_entry(text)
            self.index_path = resolved_index_path
            logger.info("Added new documents and updated FAISS index at %s", resolved_index_path)
        else:
            logger.warning("Vector store not initialized. Cannot add documents.")

    def add_text(self, text: str, metadata: dict | None = None, index_path: str | None = None) -> str:
        """Adds a single text chunk to the FAISS index and returns a generated embedding id."""
        import uuid

        resolved_index_path = self._resolve_index_path(index_path)
        if self.vector_store is None:
            self.load_or_create_store(index_path=resolved_index_path)

        embedding_id = str(uuid.uuid4())
        metadata = metadata or {}
        metadata_with_id = dict(metadata)
        metadata_with_id["embedding_id"] = embedding_id

        try:
            new_vector_store = FAISS.from_texts(
                [text],
                self.embeddings,
                metadatas=[metadata_with_id],
                ids=[embedding_id],
            )
            if self.vector_store:
                self.vector_store.merge_from(new_vector_store)
            else:
                self.vector_store = new_vector_store
            os.makedirs(resolved_index_path, exist_ok=True)
            self.vector_store.save_local(resolved_index_path)
            append_bm25_entry(text, metadata_with_id)
            self.index_path = resolved_index_path
            logger.info("Added text to FAISS index with embedding_id=%s", embedding_id)
            return embedding_id
        except Exception as exc:  # pragma: no cover - operational
            logger.error("Failed to add text to vector store: %s", exc)
            return ""

    def search(self, query: str, k: int = 5):
        """Searches the FAISS index for the top k relevant documents."""
        if self.vector_store:
            return self.vector_store.similarity_search(query, k=k)
        logger.warning("Vector store not initialized. Cannot perform search.")
        return []

    def search_with_score(self, query: str, k: int = 40) -> list[tuple[str, float, dict]]:
        """Return scored chunks from the loaded store."""
        if self.vector_store is None:
            self.load_or_create_store(index_path=self.index_path)

        if not self.vector_store:
            logger.warning("Vector store not initialized. Cannot perform scored search.")
            return []

        try:
            docs_and_scores = self.vector_store.similarity_search_with_score(query, k=k)
        except Exception as exc:  # pragma: no cover - operational
            if _is_openai_provider_error(exc):
                raise
            logger.error("Error running scored search: %s", exc)
            return []

        return [
            (doc.page_content, float(score), getattr(doc, "metadata", {}) or {})
            for doc, score in docs_and_scores
        ]

    def _ensure_id_map(self) -> None:
        """Wraps the FAISS index in an IndexIDMap when needed."""
        if not self.vector_store or self._id_map_wrapped:
            return

        current_index = self.vector_store.index
        if isinstance(current_index, faiss.IndexIDMap):
            self._id_map_wrapped = True
            return

        try:
            wrapped = faiss.IndexIDMap(current_index)
            self.vector_store.index = wrapped
            self._id_map_wrapped = True
            if not self._migration_warned:
                logger.warning("Wrapped FAISS index into IndexIDMap for deletion support")
                self._migration_warned = True
        except Exception as exc:  # pragma: no cover - operational
            logger.error("Failed to wrap FAISS index in IndexIDMap: %s", exc)

    def remove_by_ids(self, embedding_ids: List[str]) -> int:
        """Remove vectors whose docstore ids match the provided embedding ids."""
        if not self.vector_store or not embedding_ids:
            return 0

        self._ensure_id_map()
        reverse_index = {
            docstore_id: idx
            for idx, docstore_id in self.vector_store.index_to_docstore_id.items()
        }
        target_idxs = [reverse_index[id_] for id_ in embedding_ids if id_ in reverse_index]

        if not target_idxs:
            logger.debug("No FAISS indexes found for embedding ids %s", embedding_ids)
            return 0

        ids_array = np.array(target_idxs, dtype=np.int64)
        try:
            self.vector_store.index.remove_ids(ids_array)
        except Exception as exc:  # pragma: no cover - operational
            logger.error("Failed to remove ids from FAISS index: %s", exc)
            return 0

        try:
            self.vector_store.docstore.delete(embedding_ids)
        except Exception as exc:  # pragma: no cover - operational
            logger.warning("Failed to delete docs from docstore: %s", exc)

        for idx in target_idxs:
            self.vector_store.index_to_docstore_id.pop(idx, None)

        if self.index_path:
            os.makedirs(self.index_path, exist_ok=True)
            self.vector_store.save_local(self.index_path)
        logger.info("Removed %d vectors from FAISS index", len(target_idxs))
        return len(target_idxs)


# Singleton instance of the VectorStoreManager
vector_store_manager = VectorStoreManager()
