#!/usr/bin/env python3
import os
import sys
import json
import re

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(repo_root, 'backend'))

REPORT_PATH = os.path.join(os.path.dirname(__file__), 'accuracy_report.json')

KEYWORDS = {
    "tuition fees": ["tuition", "fee", "fees", "payment reference", "prn", "surcharge", "bank"],
    "application deadline": ["deadline", "closing date", "closes", "apply by", "submission", r"\d{1,2} [A-Za-z]+ \d{4}", r"\d{4}"],
    "how to get transcript": ["transcript", "graduation fees", "bank deposit", "bank slip", "present", "receipt"],
    "payment reference number PRN": ["payment reference", "prn", "payment reference number", "ura", "uganda revenue authority"],
    "exam timetable": ["timetable", "exam", "examination", "dates", "schedule", "publish"],
}


def load_report(path=REPORT_PATH):
    with open(path, 'r', encoding='utf-8') as fh:
        return json.load(fh)


def keyword_found_in_text(query, text):
    patterns = KEYWORDS.get(query, [])
    text = (text or '').lower()
    for p in patterns:
        try:
            if re.search(p, text, re.I):
                return True
        except re.error:
            if p.lower() in text:
                return True
    return False


def check_report(report):
    mismatches = []
    for entry in report.get('queries', []):
        q = entry.get('query')
        results = entry.get('results', [])
        llm = entry.get('llm') or {}
        resp = llm.get('response') if isinstance(llm, dict) else None
        citations = []
        if isinstance(resp, dict):
            citations = resp.get('citations') or []
        # Map rank->result
        rank_map = {r['rank']: r for r in results}
        for c in citations:
            if not isinstance(c, int):
                mismatches.append({'query': q, 'citation': c, 'reason': 'non-int-citation'})
                continue
            if c not in rank_map:
                mismatches.append({'query': q, 'citation': c, 'reason': 'citation-index-out-of-range', 'results_count': len(results)})
                continue
            chunk = rank_map[c]
            preview = chunk.get('preview', '')
            if not keyword_found_in_text(q, preview):
                mismatches.append({'query': q, 'citation': c, 'reason': 'no-keyword-match', 'preview': preview[:400]})
    return mismatches


if __name__ == '__main__':
    if not os.path.exists(REPORT_PATH):
        print('Report not found at', REPORT_PATH)
        sys.exit(1)
    report = load_report()
    mismatches = check_report(report)
    print('\nCitation mismatches found:', len(mismatches))
    for m in mismatches:
        print('-', m)
    if not mismatches:
        print('No mismatches detected: all cited chunks contain query keywords (by heuristic).')
