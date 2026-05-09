from app.main import (
    CLARIFICATION_LOOP_FALLBACK,
    _apply_clarification_loop_guard,
    _clarification_loop_state,
)


def test_clarification_loop_guard_overrides_third_consecutive_clarification():
    session_id = 9001
    _clarification_loop_state.pop(session_id, None)

    first = _apply_clarification_loop_guard(
        session_id,
        "clarification_needed",
        True,
        "Which programme are you asking about?",
    )
    second = _apply_clarification_loop_guard(
        session_id,
        "clarification_needed",
        True,
        "Which semester do you mean?",
    )
    third = _apply_clarification_loop_guard(
        session_id,
        "clarification_needed",
        True,
        "Is this for undergraduate or postgraduate study?",
    )

    assert first == ("clarification_needed", True, "Which programme are you asking about?")
    assert second == ("clarification_needed", True, "Which semester do you mean?")
    assert third == ("answered", True, CLARIFICATION_LOOP_FALLBACK)
    assert _clarification_loop_state[session_id] == 0


def test_clarification_loop_guard_resets_after_non_clarification_response():
    session_id = 9002
    _clarification_loop_state.pop(session_id, None)

    _apply_clarification_loop_guard(
        session_id,
        "clarification_needed",
        True,
        "Which programme are you asking about?",
    )
    result = _apply_clarification_loop_guard(
        session_id,
        "answered",
        True,
        "The tuition is UGX 1,000,000 per semester.",
    )

    assert result == ("answered", True, "The tuition is UGX 1,000,000 per semester.")
    assert session_id not in _clarification_loop_state
