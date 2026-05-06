import logging

from app import retrieval


def test_log_candidate_stage_emits_metadata_and_preview(caplog):
    candidates = [
        (
            "Functional fees are paid together with tuition at designated banks.",
            0.42,
            {
                "source": "web_page",
                "title": "Fees Policy",
                "url": "https://www.must.ac.ug/fees-policy",
                "_vector_score": 0.42,
                "_bm25_score": 7.5,
            },
        )
    ]

    with caplog.at_level(logging.INFO, logger="must.retrieval"):
        retrieval._log_candidate_stage("vector", "functional fees", candidates)

    messages = [record.getMessage() for record in caplog.records]
    assert any("[retrieval:vector]" in message and "query='functional fees'" in message for message in messages)
    assert any("source=web_page" in message and "title=Fees Policy" in message for message in messages)
    assert any("preview='Functional fees are paid together with tuition" in message for message in messages)
