#!/usr/bin/env python3
import os
import sys
import time
from collections import defaultdict

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(repo_root, "backend"))

from app.retrieval import (
    expand_query,
    bm25_retrieve,
    _merge_result_sets,
    _rerank_scored_chunks,
)
from app.vector_store import vector_store_manager

SAMPLE_QUERIES = [
    "tuition fees",
    "application deadline",
    "how to get transcript",
]


def aggregate_merged_lists(all_merged):
    combined = {}
    for merged in all_merged:
        for chunk, score, metadata in merged:
            text = (chunk or '').strip()
            if not text:
                continue
            existing = combined.get(text)
            if existing is None:
                combined[text] = (chunk, score, dict(metadata or {}))
                continue
            existing_chunk, existing_score, existing_metadata = existing
            merged_metadata = dict(existing_metadata or {})
            merged_metadata.update(dict(metadata or {}))
            existing_rank = float((existing_metadata or {}).get('_rank_score', 0.0))
            current_rank = float((metadata or {}).get('_rank_score', 0.0))
            if current_rank > existing_rank:
                combined[text] = (chunk, score, merged_metadata)
            else:
                combined[text] = (existing_chunk, existing_score, merged_metadata)
    return list(combined.values())


def profile_query(query):
    timings = defaultdict(float)
    details = {}

    start_total = time.perf_counter()
    expansions_start = time.perf_counter()
    expansions = expand_query(query)
    timings['expansion_ms'] = (time.perf_counter() - expansions_start) * 1000
    if not expansions:
        expansions = [query]

    all_merged = []
    for ex in expansions:
        v_start = time.perf_counter()
        vector_results = vector_store_manager.search_with_score(ex, k=40)
        timings.setdefault('vector_ms', 0)
        timings['vector_ms'] += (time.perf_counter() - v_start) * 1000

        b_start = time.perf_counter()
        bm25_results = bm25_retrieve(ex, top_k=30)
        timings.setdefault('bm25_ms', 0)
        timings['bm25_ms'] += (time.perf_counter() - b_start) * 1000

        m_start = time.perf_counter()
        merged = _merge_result_sets(ex, vector_results, bm25_results)
        timings.setdefault('merge_ms', 0)
        timings['merge_ms'] += (time.perf_counter() - m_start) * 1000

        all_merged.append(merged)

    combined_list = aggregate_merged_lists(all_merged)
    timings['combined_count'] = len(combined_list)

    rerank_start = time.perf_counter()
    reranked = _rerank_scored_chunks(query, combined_list, top_k=5)
    timings['rerank_ms'] = (time.perf_counter() - rerank_start) * 1000

    timings['total_ms'] = (time.perf_counter() - start_total) * 1000
    details['expansions'] = expansions
    details['per_expansion_vector_counts'] = [len(m) for m in all_merged]
    details['top_results_preview'] = [(item[0][:200].replace('\n', ' '), item[1], item[2].get('source') if isinstance(item[2], dict) else None) for item in reranked]

    return timings, details


if __name__ == '__main__':
    print('Detail timing probe')
    for q in SAMPLE_QUERIES:
        print('\nQuery:', q)
        try:
            timings, details = profile_query(q)
            for k, v in timings.items():
                if k.endswith('_ms'):
                    print(f'  {k}: {v:.2f} ms')
                else:
                    print(f'  {k}: {v}')
            print('  expansions:', details['expansions'])
            print('  per_expansion_vector_counts:', details['per_expansion_vector_counts'])
            print('  top_results_preview:')
            for i, (text, score, src) in enumerate(details['top_results_preview'], start=1):
                print(f'   {i}. score={score:.4f} source={src} preview="{text}"')
        except Exception as e:
            print('  error profiling query:', e)
