#!/usr/bin/env python3
import os
import sys
import time
import random
import statistics
from concurrent.futures import ThreadPoolExecutor, as_completed

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(repo_root, "backend"))

from app.retrieval import retrieve_relevant_context_scored
from app.vector_store import vector_store_manager
from app.bm25_store import load_bm25_corpus

# Benchmark parameters
NUM_REQUESTS = 200
CONCURRENCY = 20
SAMPLE_QUERIES = [
    "tuition fees",
    "application deadline",
    "how to get transcript",
    "payment reference number PRN",
    "course registration",
    "exam timetable",
    "library opening hours",
    "scholarship application",
    "contact academic registrar",
    "change of programme",
]

# Warmup: ensure vector store and BM25 are loaded in memory
def warmup():
    print('Warming FAISS and BM25 caches...')
    try:
        vector_store_manager.load_or_create_store()
        print('FAISS load attempted, index_path=', vector_store_manager.index_path)
    except Exception as e:
        print('FAISS warmup error:', e)
    try:
        entries = load_bm25_corpus()
        print('BM25 entries loaded:', len(entries))
    except Exception as e:
        print('BM25 warmup error:', e)


def worker(query):
    start = time.perf_counter()
    try:
        results = retrieve_relevant_context_scored(query, top_k=5)
        elapsed = (time.perf_counter() - start) * 1000
        return True, elapsed, len(results)
    except Exception as e:
        elapsed = (time.perf_counter() - start) * 1000
        return False, elapsed, str(e)


def main():
    warmup()
    queries = [random.choice(SAMPLE_QUERIES) for _ in range(NUM_REQUESTS)]
    latencies = []
    successes = 0
    failures = 0
    results_counts = []

    print(f'Starting {NUM_REQUESTS} requests with concurrency={CONCURRENCY}...')
    start_all = time.perf_counter()
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        futures = [ex.submit(worker, q) for q in queries]
        for fut in as_completed(futures):
            ok, elapsed, info = fut.result()
            latencies.append(elapsed)
            if ok:
                successes += 1
                results_counts.append(info)
            else:
                failures += 1
    total_ms = (time.perf_counter() - start_all) * 1000

    print('\nBenchmark complete')
    print('Total requests:', NUM_REQUESTS)
    print('Successes:', successes, 'Failures:', failures)
    if latencies:
        print('Total wall time ms:', round(total_ms, 2))
        print('Mean ms:', round(statistics.mean(latencies), 2))
        print('Median (p50) ms:', round(statistics.median(latencies), 2))
        print('p90 ms:', round(statistics.quantiles(latencies, n=100)[89], 2))
        print('p95 ms:', round(statistics.quantiles(latencies, n=100)[94], 2))
        print('p99 ms:', round(statistics.quantiles(latencies, n=100)[98], 2))
        print('Max ms:', round(max(latencies), 2))
    if results_counts:
        print('Result counts: mean', round(statistics.mean(results_counts), 2), 'min', min(results_counts), 'max', max(results_counts))

if __name__ == '__main__':
    main()
