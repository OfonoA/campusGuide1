#!/usr/bin/env python3
import os
import sys
import time
import json
import traceback

repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
# Ensure Python can import the `app` package under backend/
sys.path.insert(0, os.path.join(repo_root, "backend"))

print('Repository root:', repo_root)

# Probe FAISS index
index_path = os.path.join(repo_root, 'backend', 'faiss_index', 'index.faiss')
try:
    import faiss
    import numpy as np
except Exception as e:
    print('faiss import failed:', e)
    print('Skipping FAISS probes.')
    faiss = None

if faiss and os.path.exists(index_path):
    try:
        t0 = time.perf_counter()
        idx = faiss.read_index(index_path)
        t1 = time.perf_counter()
        print('\nFAISS index loaded:')
        print('  class:', type(idx))
        print('  load_time_ms: {:.2f}'.format((t1 - t0) * 1000))
        ntotal = getattr(idx, 'ntotal', None)
        print('  ntotal:', ntotal)

        # metric type if available
        metric = getattr(idx, 'metric_type', None)
        try:
            if metric is not None:
                print('  metric_type (raw):', metric)
                if metric == faiss.METRIC_L2:
                    print('  metric_type: METRIC_L2')
                elif metric == faiss.METRIC_INNER_PRODUCT:
                    print('  metric_type: METRIC_INNER_PRODUCT')
        except Exception:
            pass

        # unwrap IndexIDMap if present
        try:
            underlying = getattr(idx, 'index', None)
            if underlying is not None:
                print('  underlying index type:', type(underlying))
            else:
                underlying = idx
        except Exception:
            underlying = idx

        if ntotal and ntotal > 0:
            try:
                # reconstruct first vector
                v = underlying.reconstruct(0)
                v = np.array(v, dtype='float32')
                print('  reconstructed vector length:', v.shape)

                q = np.array([v], dtype='float32')
                # measure search latency
                t0 = time.perf_counter()
                D, I = underlying.search(q, 5)
                t1 = time.perf_counter()
                print('  search_time_ms: {:.2f}'.format((t1 - t0) * 1000))
                print('  D (distances):', D)
                print('  I (indices):', I)

                # sanity check: top hit should be index 0 (or mapped id)
                print('  top_hit_index:', int(I[0][0]))
            except Exception as e:
                print('  error reconstruct/search:', e)
                traceback.print_exc()
        else:
            print('  index empty or ntotal==0; cannot reconstruct/search sample vector')
    except Exception as e:
        print('Error reading FAISS index:', e)
        traceback.print_exc()
else:
    print('\nNo FAISS index file found at', index_path)

# Probe BM25 corpus
try:
    from app.bm25_store import load_bm25_corpus
    entries = load_bm25_corpus()
    print('\nBM25 corpus entries:', len(entries))
    sample_text = entries[0]['text'][:200] if entries else '(none)'
    print('Sample entry:', sample_text)

    try:
        from rank_bm25 import BM25Okapi
        tokenized = [e['text'].split() for e in entries]
        t0 = time.perf_counter()
        bm = BM25Okapi(tokenized)
        t1 = time.perf_counter()
        print('BM25 build_time_ms: {:.2f}'.format((t1 - t0) * 1000))

        query = 'tuition fees'
        tokens = query.split()
        t0 = time.perf_counter()
        scores = bm.get_scores(tokens)
        t1 = time.perf_counter()
        print('BM25 get_scores_time_ms: {:.2f}'.format((t1 - t0) * 1000))
        # show top 5
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)[:5]
        print('BM25 top 5 indices/scores:')
        for idx, sc in ranked:
            print(' ', idx, round(float(sc), 4), (entries[idx]['text'][:120].replace('\n', ' ')))
    except Exception as e:
        print('rank_bm25 not available or failed:', e)
        print('Skipping BM25 timing probe.')
except Exception as e:
    print('Failed to load BM25 corpus:', e)

print('\nProbe complete.')
