import pickle
from pathlib import Path
from typing import Any, Optional

BM25_CORPUS_PATH = Path(__file__).resolve().parents[1] / "bm25_corpus.pkl"

_bm25_entries_cache: Optional[list[dict[str, Any]]] = None
_bm25_mtime_cache: Optional[float] = None


def _normalize_entries(payload: Any) -> list[dict[str, Any]]:
    if not payload:
        return []

    entries: list[dict[str, Any]] = []
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, str):
                text = item.strip()
                if text:
                    entries.append({"text": text, "metadata": {}})
            elif isinstance(item, dict):
                text = str(item.get("text", "") or "").strip()
                if text:
                    metadata = item.get("metadata", {})
                    entries.append({"text": text, "metadata": metadata if isinstance(metadata, dict) else {}})
    return entries


def _set_cache(entries: list[dict[str, Any]], path: Path) -> list[dict[str, Any]]:
    global _bm25_entries_cache, _bm25_mtime_cache
    _bm25_entries_cache = entries
    _bm25_mtime_cache = path.stat().st_mtime if path.exists() else None
    return entries


def load_bm25_corpus(corpus_path: Path | str = BM25_CORPUS_PATH) -> list[dict[str, Any]]:
    path = Path(corpus_path)
    global _bm25_entries_cache, _bm25_mtime_cache

    if not path.exists():
        return _set_cache([], path)

    mtime = path.stat().st_mtime
    if _bm25_entries_cache is not None and _bm25_mtime_cache == mtime:
        return _bm25_entries_cache

    with path.open("rb") as fh:
        payload = pickle.load(fh)
    return _set_cache(_normalize_entries(payload), path)


def save_bm25_corpus(
    texts: list[str],
    metadatas: Optional[list[dict[str, Any]]] = None,
    corpus_path: Path | str = BM25_CORPUS_PATH,
) -> list[dict[str, Any]]:
    path = Path(corpus_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    entries: list[dict[str, Any]] = []
    for idx, text in enumerate(texts):
        normalized_text = str(text or "").strip()
        if not normalized_text:
            continue
        metadata = {}
        if metadatas and idx < len(metadatas) and isinstance(metadatas[idx], dict):
            metadata = dict(metadatas[idx])
        entries.append({"text": normalized_text, "metadata": metadata})

    with path.open("wb") as fh:
        pickle.dump(entries, fh)
    return _set_cache(entries, path)


def append_bm25_entry(
    text: str,
    metadata: Optional[dict[str, Any]] = None,
    corpus_path: Path | str = BM25_CORPUS_PATH,
) -> list[dict[str, Any]]:
    normalized_text = str(text or "").strip()
    if not normalized_text:
        return load_bm25_corpus(corpus_path)

    entries = list(load_bm25_corpus(corpus_path))
    entries.append({"text": normalized_text, "metadata": dict(metadata or {})})
    return save_bm25_corpus(
        [entry["text"] for entry in entries],
        [entry["metadata"] for entry in entries],
        corpus_path,
    )


def reset_bm25_corpus(corpus_path: Path | str = BM25_CORPUS_PATH) -> None:
    path = Path(corpus_path)
    if path.exists():
        path.unlink()
    _set_cache([], path)
