#!/usr/bin/env python3
import os
import sys
import time
import json

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(repo_root, "backend"))

from app.retrieval import retrieve_relevant_context_scored
from app.bm25_store import load_bm25_corpus
from app.llm import ask_campusguide

QUERIES = [
    "tuition fees",
    "application deadline",
    "how to get transcript",
    "payment reference number PRN",
    "exam timetable",
]


def find_matches_in_corpus(chunk_text, entries):
    """Return list of matches with (entry_index, source, char_offset, snippet_preview)."""
    matches = []
    needle = (chunk_text or "").strip()
    for idx, entry in enumerate(entries):
        text = entry.get('text', '')
        metadata = entry.get('metadata') or {}
        src = metadata.get('source') or metadata.get('filename') or metadata.get('source_reference') or metadata.get('url') or metadata.get('source_url')
        if not needle:
            continue
        # exact equality
        if text.strip() == needle:
            matches.append({'entry_index': idx, 'source': src, 'offset': 0, 'match_type': 'exact'})
            continue
        # substring
        off = text.find(needle)
        if off != -1:
            matches.append({'entry_index': idx, 'source': src, 'offset': int(off), 'match_type': 'substring'})
            continue
        # fuzzy fallback: check if chunk is contained in a shorter form
        # skip for performance
    return matches


def generate_report(output_path='accuracy_report.json'):
    report = {'generated_at': time.asctime(), 'queries': []}

    entries = load_bm25_corpus()

    for q in QUERIES:
        item = {'query': q, 'retrieval_ms': None, 'results': [], 'llm': None}
        start = time.perf_counter()
        scored = retrieve_relevant_context_scored(q, top_k=8)
        elapsed = (time.perf_counter() - start) * 1000
        item['retrieval_ms'] = round(elapsed, 2)

        for rank, (chunk, score, metadata) in enumerate(scored, start=1):
            chunk_text = chunk or ''
            preview = chunk_text.replace('\n', ' ')[:400]
            matches = find_matches_in_corpus(chunk_text, entries)
            item['results'].append({
                'rank': rank,
                'score': float(score),
                'preview': preview,
                'metadata': metadata if isinstance(metadata, dict) else {},
                'bm25_matches': matches,
            })

        # call LLM for final answer (ask_campusguide) and include its citations if available
        try:
            llm_start = time.perf_counter()
            llm_out = ask_campusguide(q)
            llm_elapsed = (time.perf_counter() - llm_start) * 1000
            item['llm'] = {'elapsed_ms': round(llm_elapsed, 2), 'response': llm_out}
        except Exception as e:
            item['llm'] = {'error': str(e)}

        report['queries'].append(item)

    with open(output_path, 'w', encoding='utf-8') as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False)

    print('Report written to', output_path)
    return report


if __name__ == '__main__':
    generate_report()
