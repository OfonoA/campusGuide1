import logging
import os
import json
import re
import subprocess
import sys
from time import perf_counter
from typing import Any, Optional

from dotenv import load_dotenv
from openai import APIError, APIStatusError, AuthenticationError, OpenAI, RateLimitError
try:
    from rank_bm25 import BM25Okapi
except Exception:  # pragma: no cover - optional dependency fallback
    BM25Okapi = None  # type: ignore[assignment]

from app.bm25_store import BM25_CORPUS_PATH, load_bm25_corpus
from app.vector_store import vector_store_manager

load_dotenv()

logger = logging.getLogger("must.retrieval")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
VECTOR_TOP_K = 40
BM25_TOP_K = 30
FINAL_TOP_K = 5
ENABLE_LLM_QUERY_EXPANSION = os.getenv("ENABLE_LLM_QUERY_EXPANSION", "0").strip().lower() in {"1", "true", "yes", "on"}
OPENAI_REQUEST_TIMEOUT_SECONDS = float(os.getenv("OPENAI_REQUEST_TIMEOUT_SECONDS", "20"))
ENABLE_CROSS_ENCODER_RERANKING = os.getenv("ENABLE_CROSS_ENCODER_RERANKING", "0").strip().lower() in {"1", "true", "yes", "on"}
CROSS_ENCODER_MODEL = os.getenv("CROSS_ENCODER_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2")
CROSS_ENCODER_TIMEOUT_SECONDS = int(os.getenv("CROSS_ENCODER_TIMEOUT_SECONDS", "20"))
CROSS_ENCODER_MAX_CANDIDATES = int(os.getenv("CROSS_ENCODER_MAX_CANDIDATES", "12"))

_bm25_index_cache: Optional[BM25Okapi] = None
_bm25_entries_ref: Optional[list[dict[str, Any]]] = None
_openai_client: Optional[OpenAI] = None


def _preview_text(text: str, max_chars: int = 160) -> str:
    normalized = " ".join(str(text or "").split())
    if len(normalized) <= max_chars:
        return normalized
    return normalized[: max_chars - 3] + "..."


def _format_candidate_metadata(metadata: dict[str, Any] | None) -> str:
    meta = dict(metadata or {})
    return (
        f"source={meta.get('source')} "
        f"title={meta.get('title') or meta.get('filename') or meta.get('source_reference')} "
        f"url={meta.get('url') or meta.get('source_url')} "
        f"vector_score={meta.get('_vector_score')} "
        f"bm25_score={meta.get('_bm25_score')}"
    )


def _log_candidate_stage(stage: str, query: str, candidates, limit: int = 5) -> None:
    trimmed = list(candidates[:limit]) if candidates else []
    logger.info(
        "[retrieval:%s] query=%r total=%d showing=%d",
        stage,
        query,
        len(candidates or []),
        len(trimmed),
    )
    for idx, (chunk, score, metadata) in enumerate(trimmed, start=1):
        logger.info(
            "[retrieval:%s] rank=%d score=%s %s preview=%r",
            stage,
            idx,
            round(float(score), 4) if isinstance(score, (int, float)) else score,
            _format_candidate_metadata(metadata if isinstance(metadata, dict) else {}),
            _preview_text(chunk),
        )


def _normalize_vector_signal(score: float | None) -> float:
    if score is None:
        return 0.0
    bounded = max(float(score), 0.0)
    return 1.0 / (1.0 + bounded)


def _normalize_bm25_signal(score: float | None, max_score: float) -> float:
    if score is None or max_score <= 0:
        return 0.0
    return max(float(score), 0.0) / max_score


def _compute_rank_score(vector_score: float | None, bm25_score: float | None, bm25_max: float) -> float:
    vector_signal = _normalize_vector_signal(vector_score)
    bm25_signal = _normalize_bm25_signal(bm25_score, bm25_max)
    overlap_bonus = 0.1 if vector_score is not None and bm25_score is not None else 0.0
    return (0.7 * vector_signal) + (0.3 * bm25_signal) + overlap_bonus


def _distance_proxy_from_rank(rank_score: float) -> float:
    return max(0.0, 1.0 - rank_score)


def _query_terms(query: str) -> set[str]:
    return {term for term in re.findall(r"[a-z0-9]+", str(query or "").lower()) if len(term) > 1}


def _fallback_rerank_score(query: str, chunk: str, metadata: dict[str, Any] | None) -> float:
    rank_score = float((metadata or {}).get("_rank_score", 0.0))
    query_terms = _query_terms(query)
    if not query_terms:
        return rank_score
    chunk_terms = set(re.findall(r"[a-z0-9]+", str(chunk or "").lower()))
    overlap = len(query_terms & chunk_terms) / len(query_terms)
    return (0.75 * rank_score) + (0.25 * overlap)


def _cross_encoder_payload(query: str, documents: list[str]) -> str:
    pairs = [(query, document) for document in documents]
    return (
        "import json\n"
        f"from sentence_transformers import CrossEncoder\n"
        f"model = CrossEncoder({CROSS_ENCODER_MODEL!r})\n"
        f"scores = model.predict({pairs!r})\n"
        "print(json.dumps([float(score) for score in scores]))\n"
    )


def _cross_encoder_scores(query: str, documents: list[str]) -> Optional[list[float]]:
    if not ENABLE_CROSS_ENCODER_RERANKING or not documents:
        return None
    try:
        proc = subprocess.run(
            [sys.executable, "-c", _cross_encoder_payload(query, documents)],
            capture_output=True,
            text=True,
            timeout=CROSS_ENCODER_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning("Cross-encoder rerank failed to execute for %r: %s", query, exc)
        return None

    if proc.returncode != 0:
        logger.warning("Cross-encoder rerank returned code %s for %r: %s", proc.returncode, query, proc.stderr.strip())
        return None

    try:
        payload = json.loads(proc.stdout.strip())
    except json.JSONDecodeError as exc:
        logger.warning("Cross-encoder rerank emitted invalid JSON for %r: %s", query, exc)
        return None

    if not isinstance(payload, list) or len(payload) != len(documents):
        logger.warning("Cross-encoder rerank returned unexpected payload size for %r", query)
        return None
    return [float(score) for score in payload]


def _is_openai_provider_error(exc: Exception) -> bool:
    return isinstance(exc, (APIError, APIStatusError, AuthenticationError, RateLimitError))


def _get_openai_client() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI(api_key=OPENAI_API_KEY)
    return _openai_client


def _get_bm25_index() -> tuple[Optional[BM25Okapi], list[dict[str, Any]]]:
    global _bm25_index_cache, _bm25_entries_ref
    entries = load_bm25_corpus(BM25_CORPUS_PATH)
    if BM25Okapi is None:
        return None, entries
    if _bm25_entries_ref is not entries:
        tokenized = [entry["text"].split() for entry in entries]
        _bm25_index_cache = BM25Okapi(tokenized) if tokenized else None
        _bm25_entries_ref = entries
    return _bm25_index_cache, entries


def _dedupe_queries(queries: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for query in queries:
        normalized = str(query or "").strip()
        if not normalized:
            continue
        lowered = normalized.lower()
        if lowered in seen:
            continue
        deduped.append(normalized)
        seen.add(lowered)
    return deduped


def _heuristic_query_expansions(query: str) -> list[str]:
    normalized = str(query or "").strip()
    if not normalized:
        return []

    lowered = normalized.lower()
    variants = [normalized]

    replacements = (
        ("prn", "payment reference number"),
        ("payment reference number", "prn"),
        ("fees", "tuition fees"),
        ("tuition", "school fees"),
        ("admission", "application"),
        ("deadline", "closing date"),
        ("requirements", "eligibility requirements"),
        ("transcript", "academic transcript"),
    )
    for old, new in replacements:
        if old in lowered:
            variants.append(normalized.replace(old, new))

    return _dedupe_queries(variants)[:3]


def expand_query(query):
    """Generate alternative retrieval phrasings, using the LLM only when explicitly enabled."""
    normalized = (query or "").strip()
    if not normalized:
        return []

    heuristic_expansions = _heuristic_query_expansions(normalized)
    if not ENABLE_LLM_QUERY_EXPANSION:
        return heuristic_expansions

    prompt = (
        "Generate 3 concise alternative search queries for the same information need.\n"
        "Return one query per line with no numbering or commentary.\n"
        f"Original query: {normalized}"
    )

    try:
        response = _get_openai_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            timeout=OPENAI_REQUEST_TIMEOUT_SECONDS,
        )
        content = response.choices[0].message.content or ""
    except Exception as exc:
        if _is_openai_provider_error(exc):
            raise
        logger.warning("Query expansion failed for '%s': %s", normalized, exc)
        return heuristic_expansions

    expanded = list(heuristic_expansions)
    seen = {item.lower() for item in expanded}
    for raw_line in content.splitlines():
        line = raw_line.strip().lstrip("-").strip()
        if not line:
            continue
        lowered = line.lower()
        if lowered in seen:
            continue
        expanded.append(line)
        seen.add(lowered)
        if len(expanded) >= 4:
            break
    return expanded


def bm25_retrieve(query, top_k=BM25_TOP_K):
    """Run BM25 keyword retrieval against the persisted chunk corpus."""
    bm25_index, entries = _get_bm25_index()
    if bm25_index is None or not entries:
        return []

    tokens = str(query or "").split()
    if not tokens:
        return []

    try:
        scores = bm25_index.get_scores(tokens)
    except Exception as exc:
        logger.warning("BM25 scoring failed for '%s': %s", query, exc)
        return []

    ranked_indices = sorted(range(len(scores)), key=lambda idx: scores[idx], reverse=True)
    results = []
    for idx in ranked_indices:
        score = float(scores[idx])
        if score <= 0:
            continue
        entry = entries[idx]
        results.append((entry["text"], score, dict(entry.get("metadata", {}) or {})))
        if len(results) >= top_k:
            break
    return results


def _merge_result_sets(query, vector_results, bm25_results):
    combined: dict[str, dict[str, Any]] = {}
    bm25_max = max((float(score) for _chunk, score, _metadata in bm25_results), default=0.0)

    for chunk, score, metadata in vector_results:
        text = (chunk or "").strip()
        if not text:
            continue
        vector_score = float(score)
        rank_score = _compute_rank_score(vector_score, None, bm25_max)
        combined[text] = {
            "text": text,
            "score": _distance_proxy_from_rank(rank_score),
            "metadata": {
                **dict(metadata or {}),
                "_vector_score": vector_score,
                "_rank_score": rank_score,
                "_retrieval_query": query,
            },
        }

    for chunk, score, metadata in bm25_results:
        text = (chunk or "").strip()
        if not text:
            continue
        bm25_score = float(score)
        if text in combined:
            vector_score = combined[text]["metadata"].get("_vector_score")
            rank_score = _compute_rank_score(float(vector_score) if vector_score is not None else None, bm25_score, bm25_max)
            combined[text]["score"] = _distance_proxy_from_rank(rank_score)
            combined[text]["metadata"]["_bm25_score"] = bm25_score
            combined[text]["metadata"]["_rank_score"] = rank_score
            continue
        rank_score = _compute_rank_score(None, bm25_score, bm25_max)
        combined[text] = {
            "text": text,
            "score": _distance_proxy_from_rank(rank_score),
            "metadata": {
                **dict(metadata or {}),
                "_bm25_score": bm25_score,
                "_vector_score": None,
                "_rank_score": rank_score,
                "_retrieval_query": query,
            },
        }
    merged = [
        (entry["text"], float(entry["score"]), dict(entry["metadata"]))
        for entry in combined.values()
    ]
    merged.sort(
        key=lambda item: (
            -float((item[2] or {}).get("_rank_score", 0.0)),
            float(item[1]),
        )
    )
    return merged


def hybrid_retrieve(query):
    """Combine vector and BM25 candidates with OR-union semantics."""
    vector_results = vector_store_manager.search_with_score(query, k=VECTOR_TOP_K)
    bm25_results = bm25_retrieve(query, top_k=BM25_TOP_K)
    return _merge_result_sets(query, vector_results, bm25_results)


def rerank_documents(query, documents, top_k=FINAL_TOP_K):
    """Fallback document reranking based on lexical overlap when no cross-encoder is used."""
    if not documents:
        return []
    query_terms = _query_terms(query)
    ranked = []
    for document in documents:
        doc_terms = set(re.findall(r"[a-z0-9]+", str(document or "").lower()))
        overlap = len(query_terms & doc_terms) / len(query_terms) if query_terms else 0.0
        ranked.append((overlap, document))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [document for _overlap, document in ranked[:top_k]]


def _rerank_scored_chunks(query: str, scored_chunks, top_k=FINAL_TOP_K):
    if not scored_chunks:
        return []

    unique_docs = []
    doc_lookup = {}
    for chunk, score, metadata in scored_chunks:
        text = (chunk or "").strip()
        if not text or text in doc_lookup:
            continue
        doc_lookup[text] = (chunk, score, metadata)
        unique_docs.append(text)

    cross_encoder_docs = unique_docs[:CROSS_ENCODER_MAX_CANDIDATES]
    cross_encoder_scores = _cross_encoder_scores(query, cross_encoder_docs)
    if cross_encoder_scores is not None:
        paired = list(zip(cross_encoder_docs, cross_encoder_scores))
        paired.sort(key=lambda item: item[1], reverse=True)
        selected = [doc_lookup[text] for text, _score in paired[:top_k] if text in doc_lookup]
        if selected:
            logger.info("[retrieval:rerank] query=%r strategy=cross_encoder candidates=%d selected=%d", query, len(cross_encoder_docs), len(selected))
            return selected

    ranked_chunks = sorted(
        (doc_lookup[text] for text in unique_docs),
        key=lambda item: (
            -_fallback_rerank_score(query, item[0], item[2] if isinstance(item[2], dict) else {}),
            -float((item[2] or {}).get("_rank_score", 0.0)),
            float(item[1]),
        ),
    )
    logger.info("[retrieval:rerank] query=%r strategy=fallback candidates=%d selected=%d", query, len(unique_docs), min(len(ranked_chunks), top_k))
    return ranked_chunks[:top_k]


def retrieve_relevant_context_scored(query, index_path="faiss_index", top_k=FINAL_TOP_K):
    """Backward-compatible scored retrieval upgraded with expansion, hybrid search, and reranking."""
    if index_path and index_path != "faiss_index":
        vector_store_manager.load_or_create_store(index_path=index_path)
    start = perf_counter()

    # 1) Expand the query to improve recall across semantic and keyword search.
    expanded_queries = expand_query(query)
    combined: dict[str, tuple[str, float, dict[str, Any]]] = {}
    total_vector_results = 0
    total_bm25_results = 0

    for expanded_query in expanded_queries:
        # 2) Retrieve candidates from both FAISS and BM25 for each expanded query.
        vector_results = vector_store_manager.search_with_score(expanded_query, k=VECTOR_TOP_K)
        bm25_results = bm25_retrieve(expanded_query, top_k=BM25_TOP_K)
        _log_candidate_stage("vector", expanded_query, vector_results)
        _log_candidate_stage("bm25", expanded_query, bm25_results)
        total_vector_results += len(vector_results)
        total_bm25_results += len(bm25_results)
        merged_results = _merge_result_sets(expanded_query, vector_results, bm25_results)
        _log_candidate_stage("merged", expanded_query, merged_results)
        for chunk, score, metadata in merged_results:
            text = (chunk or "").strip()
            if not text:
                continue
            existing = combined.get(text)
            if existing is None:
                combined[text] = (chunk, score, metadata)
                continue
            existing_chunk, existing_score, existing_metadata = existing
            merged_metadata = dict(existing_metadata or {})
            merged_metadata.update(dict(metadata or {}))
            existing_rank = float((existing_metadata or {}).get("_rank_score", 0.0))
            current_rank = float((metadata or {}).get("_rank_score", 0.0))
            if current_rank > existing_rank:
                combined[text] = (chunk, score, merged_metadata)
            else:
                combined[text] = (existing_chunk, existing_score, merged_metadata)

    # 3) Rerank the unioned candidates with a cross-encoder and keep the final top-k.
    candidates = sorted(
        combined.values(),
        key=lambda item: (
            -float((item[2] or {}).get("_rank_score", 0.0)),
            float(item[1]),
        ),
    )
    _log_candidate_stage("combined", query, candidates)
    reranked = _rerank_scored_chunks(query, candidates, top_k=top_k)
    _log_candidate_stage("final", query, reranked, limit=top_k)

    retrieval_ms = (perf_counter() - start) * 1000
    logger.info(
        "Hybrid retrieval query='%s' expanded=%d vector_results=%d bm25_results=%d combined=%d reranked=%d retrieval_ms=%.2f",
        query,
        len(expanded_queries),
        total_vector_results,
        total_bm25_results,
        len(candidates),
        len(reranked),
        retrieval_ms,
    )
    return reranked


def retrieve_relevant_context(query, index_path="faiss_index", top_k=FINAL_TOP_K):
    scored = retrieve_relevant_context_scored(query, index_path=index_path, top_k=top_k)
    return [chunk for chunk, _score, _metadata in scored]
