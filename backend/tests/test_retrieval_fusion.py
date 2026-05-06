from app import retrieval


def test_merge_result_sets_blends_vector_and_bm25_signals():
    vector_results = [
        ("shared policy chunk", 0.2, {"source": "web_page", "url": "https://must.ac.ug/shared"}),
        ("vector only chunk", 0.35, {"source": "web_page", "url": "https://must.ac.ug/vector"}),
    ]
    bm25_results = [
        ("shared policy chunk", 8.0, {"source": "web_page", "url": "https://must.ac.ug/shared"}),
        ("bm25 only chunk", 7.0, {"source": "web_page", "url": "https://must.ac.ug/bm25"}),
    ]

    merged = retrieval._merge_result_sets("policy", vector_results, bm25_results)

    assert merged[0][0] == "shared policy chunk"
    assert merged[0][2]["_bm25_score"] == 8.0
    assert merged[0][2]["_vector_score"] == 0.2

    bm25_only = next(item for item in merged if item[0] == "bm25 only chunk")
    assert bm25_only[1] != float("inf")
    assert bm25_only[2]["_rank_score"] > 0
