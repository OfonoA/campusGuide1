#!/usr/bin/env python3
import os
import sys
import time
import json

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
# Ensure imports of `app` work
sys.path.insert(0, os.path.join(repo_root, "backend"))

from app.retrieval import retrieve_relevant_context_scored

queries = [
    "tuition fees", 
    "application deadline", 
    "how to get transcript",
    "payment reference number PRN",
]

print('Running hybrid retrieval probe for sample queries...')
for q in queries:
    try:
        start = time.perf_counter()
        results = retrieve_relevant_context_scored(q, top_k=5)
        elapsed_ms = (time.perf_counter() - start) * 1000
        print('\nQuery:', q)
        print('  retrieval_time_ms: {:.2f}'.format(elapsed_ms))
        print('  returned:', len(results))
        for i, (chunk, score, metadata) in enumerate(results, start=1):
            preview = (chunk or '').replace('\n', ' ')[:240]
            print(f'   {i}. score={score:.4f} meta_source={metadata.get("source") if isinstance(metadata, dict) else None} preview="{preview}"')
    except Exception as e:
        print('Error for query', q, str(e))

print('\nHybrid probe complete.')
