**Retrieval Pipeline Analysis**

Summary of all probes and checks run on this repository's retrieval pipeline.

**Artifacts**
- **Probe scripts and helpers:** [backend/scripts/check_retrieval_probe.py](backend/scripts/check_retrieval_probe.py), [backend/scripts/run_hybrid_probe.py](backend/scripts/run_hybrid_probe.py), [backend/scripts/concurrency_benchmark.py](backend/scripts/concurrency_benchmark.py), [backend/scripts/detail_timing_probe.py](backend/scripts/detail_timing_probe.py), [backend/scripts/accuracy_probe.py](backend/scripts/accuracy_probe.py), [backend/scripts/accuracy_report.py](backend/scripts/accuracy_report.py), [backend/scripts/check_citation_matches.py](backend/scripts/check_citation_matches.py)
- **Generated reports:** [accuracy_report.json](accuracy_report.json) (also copied to [backend/scripts/accuracy_report.json](backend/scripts/accuracy_report.json)), [backend/scripts/accuracy_mismatch_report.json](backend/scripts/accuracy_mismatch_report.json)

**High-level findings**
- Vector store: FAISS index present in `backend/faiss_index/index.faiss`.
  - Index type: IndexFlatL2 (L2 distances, lower = better).
  - Total vectors: 17,453; embedding dim: 1536.
  - Load-time (read_index): ~266–372 ms (observed runs).
  - Single-vector search time (sample): ~14–22 ms.
- BM25: persisted corpus at `backend/bm25_corpus.pkl` with 17,453 entries.
  - BM25 build: ~615 ms (first build), BM25 scoring: ~13–90 ms per query (varied).
- Hybrid retrieval (vector + BM25 + merge + rerank): per-query retrieval observed
  - Cold/first-run overhead: large (example ~64s in one run, due to cold loads).
  - Warm retrievals: ~1.0–6.0 s depending on query and expansions.
- Concurrency benchmark (200 requests, concurrency=20):
  - Total wall time: ~22.4s
  - Mean latency: ~2,108 ms
  - Median (p50): ~1,091 ms
  - p90: ~8,434 ms, p95: ~10,118 ms, p99: ~12,614 ms
  - No failures observed in the run.
- Per-stage profiling (sample queries): major time spent in vector search:
  - Example: "tuition fees": vector ~5,155 ms, BM25 ~901 ms, merge/rerank negligible.

**Accuracy checks**
- Evidence keyword matching showed relevant terms in retrieved chunks for tested queries.
- LLM answers (via `ask_campusguide`) were produced and cited chunk indices; most answers were supported by cited chunks.
- Citation check (heuristic) flagged 2 mismatches for the query "payment reference number PRN" where cited chunk previews did not contain the specific expected keywords (possible chunking granularity or citation-index mismatch).

**Immediate recommendations**
- Warm FAISS index into memory at service startup (or run a persistent FAISS service) to avoid cold-start overheads.
- Replace IndexFlatL2 with an approximate index (HNSW or IVF+PQ) for lower per-query latency if slight recall loss is acceptable.
- Reduce per-query vector work: lower `VECTOR_TOP_K` and limit number of query expansions by default.
- Ensure consistent chunking so exact phrases are available in the chunk cited by the LLM; add verification that LLM-cited chunk contains key answer phrases.

**Next steps available (pick one)**
- Re-run warmed benchmarks after loading index into memory and prebuilding BM25 to validate tail latency improvements.
- Convert the JSON accuracy report into a human-readable Markdown/HTML report (I can generate this automatically).
- Implement automated tests asserting that canonical queries return expected snippets and that LLM citations contain key phrases.

If you want I can now generate the human-readable Markdown/HTML report from the JSON artifacts, or run the warmed benchmarks — which would you like next?
