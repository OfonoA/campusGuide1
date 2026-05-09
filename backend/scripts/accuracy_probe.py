#!/usr/bin/env python3
import os
import re
import sys
import time
from typing import List

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(repo_root, "backend"))

from app.retrieval import retrieve_relevant_context_scored
from app.llm import ask_campusguide

QUERIES = [
    "tuition fees",
    "application deadline",
    "how to get transcript",
    "payment reference number PRN",
    "exam timetable",
]

KEYWORDS = {
    "tuition fees": ["tuition", "fee", "fees", "payment reference", "prn", "surcharge", "bank"],
    "application deadline": ["deadline", "closing date", "closes", "apply by", "submission", r"\d{4}", r"\d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)"],
    "how to get transcript": ["transcript", "graduation fees", "bank deposit", "bank slip", "present", "receipt"],
    "payment reference number PRN": ["payment reference", "prn", "payment reference number", "ura", "uganda revenue authority"],
    "exam timetable": ["timetable", "exam", "examination", "dates", "schedule"],
}

PATTERNS = {q: [re.compile(p, re.I) if isinstance(p, str) else p for p in KEYWORDS[q]] for q in KEYWORDS}


def evidence_check(query: str, chunks: List[str]) -> dict:
    patterns = PATTERNS.get(query, [])
    findings = {p.pattern if hasattr(p, 'pattern') else str(p): 0 for p in patterns}
    for chunk in chunks:
        text = chunk or ""
        for pat in patterns:
            if pat.search(text):
                findings[pat.pattern if hasattr(pat, 'pattern') else str(pat)] += 1
    return findings


if __name__ == '__main__':
    print('Accuracy probe starting')
    openai_key = os.getenv('OPENAI_API_KEY')
    print('OPENAI_API_KEY present:', bool(openai_key))

    for q in QUERIES:
        print('\n---')
        print('Query:', q)
        start = time.perf_counter()
        scored = retrieve_relevant_context_scored(q, top_k=8)
        elapsed = (time.perf_counter() - start) * 1000
        print('Retrieval time ms:', round(elapsed, 2))
        chunks = [c for c, _s, _m in scored]
        sources = [(_m.get('source') if isinstance(_m, dict) else None) for _c, _s, _m in scored]
        for i, (chunk, src) in enumerate(zip(chunks, sources), start=1):
            preview = (chunk or '').replace('\n', ' ')[:300]
            print(f' {i}. source={src} preview="{preview}"')

        findings = evidence_check(q, chunks)
        total_hits = sum(v for v in findings.values())
        print('Evidence keyword hits total:', total_hits)
        for pat, cnt in findings.items():
            if cnt:
                print(' ', pat, '->', cnt)

        # Optionally run the LLM answer if key exists
        if openai_key:
            try:
                print('\nCalling LLM (ask_campusguide) for final answer...')
                llm_start = time.perf_counter()
                llm_out = ask_campusguide(q)
                llm_elapsed = (time.perf_counter() - llm_start) * 1000
                print('LLM elapsed ms:', round(llm_elapsed, 2))
                print('LLM output:', llm_out)
            except Exception as e:
                print('LLM call failed:', e)
        else:
            print('Skipping LLM answer (no API key)')

    print('\nAccuracy probe complete')
