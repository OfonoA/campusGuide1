from app import retrieval


def test_rerank_scored_chunks_uses_fallback_query_overlap(monkeypatch):
    monkeypatch.setattr(retrieval, "ENABLE_CROSS_ENCODER_RERANKING", False)
    scored_chunks = [
        (
            "The annual report summarizes governance and outreach activities.",
            0.05,
            {"_rank_score": 0.9, "_vector_score": 0.4},
        ),
        (
            "Functional fees are paid alongside tuition using the university payment process.",
            0.2,
            {"_rank_score": 0.7, "_vector_score": 0.7},
        ),
    ]

    reranked = retrieval._rerank_scored_chunks("functional fees payment", scored_chunks, top_k=2)

    assert reranked[0][0].startswith("Functional fees are paid")
