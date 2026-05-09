#!/usr/bin/env python3
import os
import sys
import json
import re
from collections import defaultdict

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(repo_root, "backend"))

INPUT = os.path.join(os.path.dirname(__file__), 'accuracy_report.json')
OUTPUT = os.path.join(os.path.dirname(__file__), 'accuracy_mismatch_report.json')

TOKEN_RE = re.compile(r"[a-z0-9]{4,}", re.I)
DATE_RE = re.compile(r"\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June|Jul|July|Aug|August|Sep|September|Oct|October|Nov|November|Dec|December)|\d{4})\b", re.I)


def tokens_of(text):
    return set(m.group(0).lower() for m in TOKEN_RE.finditer(text or ""))


def find_date(text):
    return DATE_RE.search(text or "")


def check_query(query_item):
    res = {'query': query_item.get('query'), 'retrieval_ms': query_item.get('retrieval_ms'), 'mismatches': []}
    llm = query_item.get('llm') or {}
    resp = llm.get('response') if isinstance(llm, dict) else None
    answer_text = ''
    citations = []
    if isinstance(resp, dict):
        answer_text = (resp.get('answer') or '')
        citations = resp.get('citations') or []
    # fallback: if llm is a dict with 'response' string
    if not answer_text and isinstance(llm, dict) and isinstance(llm.get('response'), str):
        answer_text = llm.get('response')

    answer_tokens = tokens_of(answer_text)
    answer_has_date = bool(find_date(answer_text))

    results = query_item.get('results') or []

    for c in citations:
        try:
            idx = int(c) - 1
        except Exception:
            continue
        entry = results[idx] if 0 <= idx < len(results) else None
        chunk_preview = entry.get('preview') if entry else ''
        chunk_tokens = tokens_of(chunk_preview)
        overlap = 0
        denom = max(1, len(answer_tokens))
        if answer_tokens:
            overlap = len(answer_tokens & chunk_tokens) / denom
        date_in_chunk = bool(find_date(chunk_preview))
        mismatch = False
        reasons = []
        # If answer contains date but chunk doesn't -> mismatch
        if answer_has_date and not date_in_chunk:
            mismatch = True
            reasons.append('date_missing')
        # If token overlap fraction low -> mismatch
        if answer_tokens and overlap < 0.20:
            mismatch = True
            reasons.append(f'low_token_overlap:{overlap:.2f}')
        if mismatch:
            res['mismatches'].append({
                'citation': c,
                'rank_preview': chunk_preview[:300],
                'reasons': reasons,
                'overlap': round(overlap, 3),
            })
    return res


def main():
    if not os.path.exists(INPUT):
        print('Input not found:', INPUT)
        return
    with open(INPUT, 'r', encoding='utf-8') as fh:
        report = json.load(fh)
    out = {'generated_at': report.get('generated_at'), 'queries': []}
    for q in report.get('queries', []):
        out_item = check_query(q)
        out['queries'].append(out_item)
    with open(OUTPUT, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
    print('Mismatch report written to', OUTPUT)

if __name__ == '__main__':
    main()
