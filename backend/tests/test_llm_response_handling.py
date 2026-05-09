from app import llm, retrieval
import pytest


def test_parse_structured_llm_output_accepts_code_fenced_json():
    payload = llm._parse_structured_llm_output(
        """```json
{"can_answer": true, "needs_clarification": false, "answer": "Office hours are weekdays.", "clarifying_question": null, "citations": [1]}
```"""
    )

    assert payload["can_answer"] is True
    assert payload["citations"] == [1]


def test_system_prompt_prefers_detailed_answers_when_context_supports_them():
    prompt = llm.SYSTEM_PROMPT

    assert "Prefer complete, helpful answers" in prompt
    assert "Match the level of detail to the question." in prompt
    assert "include as many steps as the context supports" in prompt
    assert 'Eligibility Criteria' in prompt
    assert '"answer": "final answer for the user"' in prompt


def test_normalize_structured_response_filters_invalid_citations():
    normalized = llm._normalize_structured_response(
        {
            "can_answer": True,
            "needs_clarification": False,
            "answer": "Use the registrar office from context.",
            "clarifying_question": None,
            "citations": [1, "2", 9, "bad", 2],
        },
        context_count=3,
    )

    assert normalized == {
        "can_answer": True,
        "needs_clarification": False,
        "answer": "Use the registrar office from context.",
        "clarifying_question": "",
        "citations": [1, 2],
    }


def test_normalize_structured_response_rejects_answer_without_citations():
    with pytest.raises(ValueError, match="without citations"):
        llm._normalize_structured_response(
            {
                "can_answer": True,
                "needs_clarification": False,
                "answer": "Office hours are weekdays.",
                "clarifying_question": None,
                "citations": [],
            },
            context_count=3,
        )


def test_normalize_structured_response_rejects_conflicting_decision_flags():
    with pytest.raises(ValueError, match="both answer and request clarification"):
        llm._normalize_structured_response(
            {
                "can_answer": True,
                "needs_clarification": True,
                "answer": "Office hours are weekdays.",
                "clarifying_question": "Which office?",
                "citations": [1],
            },
            context_count=3,
        )


def test_format_chat_history_keeps_only_latest_turn():
    formatted = llm._format_chat_history(
        [
            ("First question", "First answer"),
            ("Second question", "Second answer"),
        ]
    )

    assert "Second question" in formatted
    assert "Second answer" in formatted
    assert "First question" not in formatted


def test_rewrite_query_with_history_does_not_anchor_unrelated_standalone_question():
    rewritten = llm._rewrite_query_with_history(
        "how do i pay fees?",
        [("who is the vice chancellor?", "The vice chancellor is ...")],
    )

    assert rewritten == "how do i pay fees?"


def test_rewrite_query_with_history_keeps_dependent_followup():
    rewritten = llm._rewrite_query_with_history(
        "what are the requirements?",
        [("How do I apply for postgraduate admission?", "You need to submit ...")],
    )

    assert "How do I apply for postgraduate admission?" in rewritten
    assert "Follow-up: what are the requirements?" in rewritten


def test_ask_campusguide_returns_clarifying_question_without_escalation(monkeypatch):
    monkeypatch.setattr(
        llm,
        "retrieve_relevant_context_scored",
        lambda *_args, **_kwargs: [("Relevant policy text", 0.5, {"_vector_score": 0.5})],
    )
    monkeypatch.setattr(llm, "get_live_context", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        llm,
        "generate_response",
        lambda *_args, **_kwargs: {
            "can_answer": False,
            "needs_clarification": True,
            "answer": "",
            "clarifying_question": "Which programme are you asking about?",
            "citations": [1],
        },
    )

    result = llm.ask_campusguide("What are the requirements?", [])

    assert result["found_answer"] is True
    assert result["reason"] == "clarification_needed"
    assert result["answer"] == "Which programme are you asking about?"
    assert result["citations"] == [1]


def test_ask_campusguide_returns_no_answer_when_model_cannot_answer(monkeypatch):
    monkeypatch.setattr(
        llm,
        "retrieve_relevant_context_scored",
        lambda *_args, **_kwargs: [("Sparse policy text", 0.6, {"_vector_score": 0.6})],
    )
    monkeypatch.setattr(llm, "get_live_context", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        llm,
        "generate_response",
        lambda *_args, **_kwargs: {
            "can_answer": False,
            "needs_clarification": False,
            "answer": "I cannot answer from the current context.",
            "clarifying_question": "",
            "citations": [],
        },
    )

    result = llm.ask_campusguide("What is the exact deadline?", [])

    assert result["found_answer"] is False
    assert result["reason"] == "no_answer"
    assert "rephrase your question" in result["answer"].lower()
    assert result["citations"] == []


def test_ask_campusguide_returns_answer_and_citations(monkeypatch):
    monkeypatch.setattr(
        llm,
        "retrieve_relevant_context_scored",
        lambda *_args, **_kwargs: [("Office hours are 8am to 5pm.", 0.3, {"_vector_score": 0.3})],
    )
    monkeypatch.setattr(llm, "get_live_context", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        llm,
        "generate_response",
        lambda *_args, **_kwargs: {
            "can_answer": True,
            "needs_clarification": False,
            "answer": "Office hours are 8am to 5pm.",
            "clarifying_question": "",
            "citations": [1],
        },
    )

    result = llm.ask_campusguide("When are office hours?", [])

    assert result["found_answer"] is True
    assert result["reason"] == "answered"
    assert result["answer"] == "Office hours are 8am to 5pm."
    assert result["citations"] == [1]

def test_expand_query_uses_heuristics_without_llm(monkeypatch):
    monkeypatch.setattr(retrieval, "ENABLE_LLM_QUERY_EXPANSION", False)
    monkeypatch.setattr(
        retrieval,
        "_get_openai_client",
        lambda: pytest.fail("LLM query expansion should be disabled by default"),
    )

    expanded = retrieval.expand_query("How do I pay fees with a PRN?")

    assert expanded
    assert expanded[0] == "How do I pay fees with a PRN?"
    assert any("payment reference number" in item.lower() for item in expanded)
