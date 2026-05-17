from app.scraper import freshness_router


def test_is_freshness_sensitive_accepts_topic_mapped_academic_calendar_query():
    assert freshness_router.is_freshness_sensitive("what is the academic calendar for this year?") is True


def test_get_live_context_fetches_topic_mapped_query_without_extra_freshness_words(monkeypatch):
    captured = {}

    class DummyResponse:
        text = "<html><body><main>Semester II starts on 27 January 2026.</main></body></html>"
        headers = {}

        def raise_for_status(self):
            return None

    def fake_get(url, timeout, headers):
        captured["url"] = url
        return DummyResponse()

    monkeypatch.setattr(freshness_router.requests, "get", fake_get)
    monkeypatch.setattr(
        freshness_router,
        "extract_html_page",
        lambda url, html, response_headers: type(
            "Result",
            (),
            {"clean_text": "Semester II starts on 27 January 2026."},
        )(),
    )
    monkeypatch.setattr(
        freshness_router,
        "chunk_content_blocks",
        lambda blocks: [blocks[0]["content"]],
    )

    docs = freshness_router.get_live_context("what is the academic calendar for this year?")

    assert captured["url"] == "https://www.must.ac.ug/academic-calendar/"
    assert docs is not None
    assert len(docs) == 1
    assert "27 January 2026" in docs[0].page_content


def test_get_live_context_routes_current_dvc_aa_query_to_management_page(monkeypatch):
    captured = {}

    class DummyResponse:
        text = "<html><body><main>University Management</main></body></html>"
        headers = {}

        def raise_for_status(self):
            return None

    def fake_get(url, timeout, headers):
        captured["url"] = url
        return DummyResponse()

    monkeypatch.setattr(freshness_router.requests, "get", fake_get)
    monkeypatch.setattr(
        freshness_router,
        "extract_html_page",
        lambda url, html, response_headers: type(
            "Result",
            (),
            {"clean_text": "Deputy Vice Chancellor for Academic Affairs"},
        )(),
    )
    monkeypatch.setattr(
        freshness_router,
        "chunk_content_blocks",
        lambda blocks: [blocks[0]["content"]],
    )

    docs = freshness_router.get_live_context("who is the current DVC AA")

    assert captured["url"] == "https://www.must.ac.ug/about-us/governance/university-management/"
    assert docs is not None
    assert len(docs) == 1
    assert "Academic Affairs" in docs[0].page_content
