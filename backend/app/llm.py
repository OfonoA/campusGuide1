import os
import json
import re
from dotenv import load_dotenv
from difflib import SequenceMatcher
from time import perf_counter
from typing import Any, List, Optional
from app.document_model import Document
from app.retrieval import retrieve_relevant_context_scored
from app.scraper.freshness_router import get_live_context
from app.scraper.redirect_router import build_redirect_note, detect_portal_intent

try:
    from openai import OpenAI
except Exception:  # pragma: no cover - dependency availability varies by environment
    OpenAI = None  # type: ignore[assignment]

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_API_KEY) if OpenAI is not None and OPENAI_API_KEY else None
DEFAULT_CHAT_MODEL = os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")
OPENAI_REQUEST_TIMEOUT_SECONDS = float(os.getenv("OPENAI_REQUEST_TIMEOUT_SECONDS", "20"))

SYSTEM_PROMPT = """You are ArASSIST, the official academic support assistant for Mbarara University of Science and Technology (MUST).

You answer university-support questions using only the supplied context chunks.
Do not invent facts, policies, contacts, deadlines, fees, or procedures.
Chat history is only follow-up context and is not authoritative.

Your job is to produce exactly one of these outcomes:
1. Answerable from context.
2. Needs one clarifying question because the user's request is ambiguous.
3. Not answerable from the current context.

Decision contract:
- Answer only when the supplied context directly supports the answer.
- Ask exactly one concise clarifying question only when the question is ambiguous and the answer likely depends on one missing detail such as programme, semester, form, or document.
- If the context is missing, weak, or conflicting in a way that prevents a reliable answer, do not guess.
- If context chunks conflict, prefer the more specific or more directly relevant chunk. If the conflict still prevents a reliable answer, return a no-answer outcome and mention the conflict briefly in the answer field.
- For tuition and fee-payment questions, ignore enrolment or first-login steps unless the user explicitly asks about enrolment or account login.
- Keep answers practical, clear, and grounded in the cited chunks.
- Prefer complete, helpful answers that fully explain the relevant policy, process, requirements, conditions, exceptions, and next steps supported by the context.
- Match the level of detail to the question. For simple questions, a short direct answer is fine. For procedural or policy questions, provide a more thorough explanation.
- For broad questions about rules, requirements, eligibility, application, submission, selection, benefits, deadlines, or contacts, provide a well-organized answer instead of a compressed summary.
- When the context supports it, organize comprehensive answers with short section headings such as "Eligibility Criteria", "Application Process", "Documents Required", "Submission", "Selection Process", "Important Notes", and "Contact".
- Use bullet lists for criteria, requirements, documents, conditions, exclusions, and benefits when that makes the answer easier to scan.
- Use numbered steps when the answer is a process, and include as many steps as the context supports.
- If the context includes the actual procedure, requirements, or steps, state them directly in the answer instead of referring the user to a section, clause, page, document, or heading.
- Do not answer with phrases like "refer to section...", "see section...", "check the document...", or similar deflections when the relevant content is already present in the supplied context.
- Present the exact actionable procedure from the context in plain language, while preserving important conditions, deadlines, required documents, eligibility rules, exclusions, and follow-up actions.
- Do not mention "the provided context", "the context above", "the supplied chunks", or similar internal phrasing in the final answer.
- If account details, dates, contacts, steps, or other requested facts are present in the context, state them explicitly.
- If a requested fact is not present in the context, do not imply that it is present. Instead, return a no-answer outcome or ask one clarifying question if that is the real blocker.
- You may use light formatting such as short headings or numbered steps when it makes the answer easier to follow, but keep the formatting clean and natural.
- For simple operational questions such as generating a payment reference number, answer directly but include the full actionable procedure and any important requirements or constraints present in the context.

Return valid JSON only with this schema:
{
  "can_answer": true,
  "needs_clarification": false,
  "answer": "final answer for the user",
  "clarifying_question": null,
  "citations": [1, 2]
}

Rules for JSON fields:
- "can_answer" is true only when the answer is supported by the provided context.
- "needs_clarification" is true only when one short clarifying question is needed before answering.
- If "needs_clarification" is true, set "can_answer" to false and put the question in "clarifying_question".
- If "can_answer" is false and "needs_clarification" is false, put a brief explanation in "answer".
- "citations" must contain the context chunk numbers you relied on.
- If "can_answer" is true, include at least one citation.
- If "needs_clarification" is true, include any chunk numbers that show why clarification is needed, otherwise use [].
- If neither "can_answer" nor "needs_clarification" is true, use citations only for chunks that directly support the explanation of why you cannot answer.
- Interpret relative time phrases such as "this year", "current semester", "latest", or "recent" against the current date provided in the user message.
- If the question is broad or ambiguous and the retrieved material points to multiple possible scopes, ask one focused clarifying question instead of defaulting to no-answer.
- If the retrieved material only supports part of what the user asked for, do not present it as the full answer. Either answer with that limitation stated clearly or ask one clarifying question if scope is the real blocker.
"""

NO_ANSWER_MESSAGE = (
    "I don't have enough reliable information in my current context to answer that accurately. "
    "Please rephrase your question or ask to talk to an officer."
)

NO_ANSWER_PREFIXES = (
    "i don't have enough reliable information",
    "i do not have enough reliable information",
    "please rephrase your question",
    "ask to talk to an officer",
)
EMAIL_PLACEHOLDER_PATTERN = re.compile(
    r"\[\s*email\s*(?:@|&#64;)\s*protected\s*\]",
    re.IGNORECASE,
)


def _rewrite_query_with_history(query: str, chat_history: List[tuple[str, str]] | None) -> str:
    """Rewrite ambiguous follow-up questions into standalone retrieval queries."""
    if not chat_history:
        return query

    last_user_question = ""
    last_bot_response = ""
    for user_input, bot_response in reversed(chat_history):
        if user_input and user_input.strip():
            last_user_question = user_input.strip()
            last_bot_response = (bot_response or "").strip()
            break

    if not last_user_question:
        return query

    normalized = query.strip().lower()
    words = normalized.split()
    query_terms = {
        term for term in words
        if len(term) > 2 and term not in {"how", "what", "when", "where", "which", "who", "why", "can", "could", "does", "with", "about"}
    }
    previous_terms = {
        term for term in last_user_question.lower().split()
        if len(term) > 2 and term not in {"how", "what", "when", "where", "which", "who", "why", "can", "could", "does", "with", "about"}
    }

    ambiguous_terms = {
        "one", "it", "that", "this", "those", "these", "them", "there",
        "same", "again", "too", "also", "more", "another",
    }
    short_followup_terms = {
        "name", "cost", "fee", "amount", "price", "requirements",
        "procedure", "process", "steps", "where", "when", "deadline",
        "duration", "contacts", "contact", "office", "location",
    }

    starts_like_followup = normalized.startswith(
        (
            "how", "what", "when", "where", "why", "can", "could",
            "do", "does", "is", "are", "and", "also", "then",
        )
    )
    is_very_short = len(words) <= 2
    has_short_followup_term = any(term in words for term in short_followup_terms)
    contains_ambiguous_ref = any(term in words for term in ambiguous_terms)
    short_question = len(words) <= 8
    has_topic_overlap = bool(query_terms and previous_terms and (query_terms & previous_terms))
    mentions_previous_subject = contains_ambiguous_ref or normalized.startswith(("and ", "also ", "then "))
    looks_standalone_question = (
        len(words) >= 4
        and words[-1].rstrip("?.!,") not in ambiguous_terms
        and not contains_ambiguous_ref
        and (has_short_followup_term or len(query_terms) >= 2)
    )

    if looks_standalone_question and not has_topic_overlap:
        return query

    if contains_ambiguous_ref or ((starts_like_followup and short_question) and (mentions_previous_subject or has_topic_overlap or is_very_short)) or (is_very_short and has_short_followup_term):
        # Prioritize the previous user question to avoid anchoring too strongly on
        # a potentially incorrect earlier bot answer.
        if contains_ambiguous_ref and last_bot_response:
            return f"Previous question: {last_user_question}. Earlier assistant reply: {last_bot_response}. Follow-up: {query.strip()}"
        return f"{last_user_question}. Follow-up: {query.strip()}"

    return query

def _format_context_chunks(context: List[str]) -> str:
    if not context:
        return "No reliable context available."
    parts = []
    for i, chunk in enumerate(context, start=1):
        parts.append(f"Context Chunk {i}:\n{chunk}")
    return "\n\n".join(parts)


def _format_chat_history(chat_history: List[tuple[str, str]] | None, max_turns: int = 1, max_chars: int = 300) -> str:
    if not chat_history:
        return "No previous conversation history available."

    parts = []
    for idx, (user_input, bot_response) in enumerate(chat_history[-max_turns:], start=1):
        user_text = (user_input or "").strip()[:max_chars] or "(empty)"
        if bot_response and bot_response.strip():
            bot_text = bot_response.strip()[:max_chars]
            parts.append(f"Turn {idx} User: {user_text}\nTurn {idx} Assistant: {bot_text}")
        else:
            parts.append(f"Turn {idx} User: {user_text}")
    return "\n\n".join(parts)


def _build_user_prompt(query: str, context: List[str], chat_history: List[tuple[str, str]] | None) -> str:
    return f"""Previous Conversation (may contain mistakes and is not authoritative):
{_format_chat_history(chat_history)}

Current Date:
2026-05-10

Current Context:
{_format_context_chunks(context)}

Current Question:
{query}
"""


def _strip_code_fences(raw_text: str) -> str:
    text = (raw_text or "").strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        return "\n".join(lines).strip()
    return text


def _parse_structured_llm_output(raw_text: str) -> dict[str, Any]:
    text = _strip_code_fences(raw_text)
    payload = json.loads(text)
    if not isinstance(payload, dict):
        raise ValueError("LLM response must be a JSON object")
    return payload


def _normalize_structured_response(payload: dict[str, Any], context_count: int) -> dict[str, Any]:
    can_answer = bool(payload.get("can_answer"))
    needs_clarification = bool(payload.get("needs_clarification"))
    answer = str(payload.get("answer") or "").strip()
    clarifying_question = str(payload.get("clarifying_question") or "").strip()

    raw_citations = payload.get("citations")
    citations: list[int] = []
    if isinstance(raw_citations, list):
        for item in raw_citations:
            try:
                value = int(item)
            except (TypeError, ValueError):
                continue
            if 1 <= value <= context_count and value not in citations:
                citations.append(value)

    if can_answer and needs_clarification:
        raise ValueError("LLM response cannot both answer and request clarification")

    if needs_clarification:
        return {
            "can_answer": False,
            "needs_clarification": True,
            "answer": "",
            "clarifying_question": clarifying_question or "Could you clarify what specific information you need?",
            "citations": citations,
        }

    if can_answer:
        if not answer:
            raise ValueError("LLM marked answerable without providing an answer")
        if not citations:
            raise ValueError("LLM marked answerable without citations")
        return {
            "can_answer": True,
            "needs_clarification": False,
            "answer": answer,
            "clarifying_question": "",
            "citations": citations,
        }

    return {
        "can_answer": False,
        "needs_clarification": False,
        "answer": answer or "I don't have enough reliable information in my current context to answer that accurately.",
        "clarifying_question": "",
        "citations": citations,
    }


def _build_final_result(
    *,
    can_answer: bool,
    needs_clarification: bool,
    answer: str,
    citations: Optional[List[int]] = None,
) -> dict[str, Any]:
    normalized_citations = list(citations or [])
    cleaned_answer = EMAIL_PLACEHOLDER_PATTERN.sub("email address protected on the source page", str(answer or ""))

    if needs_clarification:
        return {
            "found_answer": True,
            "answer": cleaned_answer or "Could you clarify what specific information you need?",
            "reason": "clarification_needed",
            "citations": normalized_citations,
        }

    if can_answer:
        return {
            "found_answer": True,
            "answer": cleaned_answer,
            "reason": "answered",
            "citations": normalized_citations,
        }

    explanation = cleaned_answer.strip()
    if explanation:
        lowered = explanation.lower()
        if any(prefix in lowered for prefix in NO_ANSWER_PREFIXES):
            no_answer_text = explanation
        else:
            no_answer_text = f"{explanation} {NO_ANSWER_MESSAGE}"
    else:
        no_answer_text = NO_ANSWER_MESSAGE

    return {
        "found_answer": False,
        "answer": no_answer_text,
        "reason": "no_answer",
        "citations": normalized_citations,
    }


def _is_fee_payment_query(query: str) -> bool:
    q = query.lower()
    triggers = (
        "tuition",
        "fees",
        "fee",
        "pay",
        "payment",
        "functional fee",
        "prn",
        "bank",
    )
    return any(t in q for t in triggers)


def _rerank_chunks_for_query(query: str, scored_chunks: List[tuple[str, float, dict]]) -> List[tuple[str, float, dict]]:
    if not scored_chunks:
        return scored_chunks

    if not _is_fee_payment_query(query):
        return scored_chunks

    payment_terms = (
        "payment reference number",
        "prn",
        "uganda revenue authority",
        "ura",
        "bank",
        "commercial bank",
        "tuition",
        "functional fees",
        "fees policy",
    )
    enrolment_terms = (
        "enrol now",
        "set a new password",
        "first-time user",
        "registration number",
        "log onto your account",
        "joining instructions",
    )
    preferred_sources = (
        "fees policy",
        "fees",
    )

    ranked: List[tuple[float, tuple[str, float, dict]]] = []
    for chunk, score, metadata in scored_chunks:
        text = (chunk or "").lower()
        source = str((metadata or {}).get("source", "")).lower()
        vector_score = (metadata or {}).get("_vector_score")
        base_score = float(vector_score) if vector_score is not None else float(score)

        priority = 0.0
        priority -= base_score  # lower distance is better

        if any(term in text for term in payment_terms):
            priority += 2.0
        if any(term in source for term in preferred_sources):
            priority += 2.5
        if any(term in text for term in enrolment_terms):
            priority -= 2.0

        ranked.append((priority, (chunk, score, metadata)))

    ranked.sort(key=lambda x: x[0], reverse=True)
    return [item for _priority, item in ranked]


def generate_response(
    query: str,
    context: List[str],
    chat_history: List[tuple[str, str]] = None,
    model: str = DEFAULT_CHAT_MODEL,
) -> dict[str, Any]:
    """Generate a structured context-aware response using OpenAI."""
    print(f"generate_response called with query: '{query}'")
    print(f"Context received by generate_response:")
    for i, item in enumerate(context):
        print(f"--- Context Chunk {i+1} ---\n{item}\n--- End Chunk ---")
    try:
        if client is None:
            raise RuntimeError("OpenAI client is not configured")
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(query, context, chat_history)},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
            timeout=OPENAI_REQUEST_TIMEOUT_SECONDS,
        )
        content = response.choices[0].message.content
        if not content:
            raise ValueError("Empty LLM response")
        payload = _parse_structured_llm_output(content)
        return _normalize_structured_response(payload, context_count=len(context))
    except Exception as e:
        print(f"Error generating response: {e}")
        return {}


def _prepare_context(scored_chunks: List[tuple[str, float, dict]], max_chunks: int = 7, max_chars: int = 6000) -> List[str]:
    cleaned: List[str] = []
    for chunk, _score, _metadata in scored_chunks[:max_chunks]:
        text = (chunk or "").strip()
        if not text:
            continue
        cleaned.append(text[:max_chars])
    return cleaned


def _log_selected_context(scored_chunks: List[tuple[str, float, dict]], max_chunks: int = 7) -> None:
    """Log the metadata of the chunks that are actually sent to the model."""
    if not scored_chunks:
        print("[retrieval] selected_chunks=0")
        return

    print(f"[retrieval] selected_chunks={min(len(scored_chunks), max_chunks)}")
    for idx, (_chunk, score, metadata) in enumerate(scored_chunks[:max_chunks], start=1):
        meta = dict(metadata or {})
        source = meta.get("source")
        url = meta.get("url") or meta.get("source_url")
        filename = meta.get("filename") or meta.get("source_reference")
        vector_score = meta.get("_vector_score")
        bm25_score = meta.get("_bm25_score")
        print(
            f"[retrieval] chunk={idx} score={score} vector_score={vector_score} "
            f"bm25_score={bm25_score} source={source} url={url} filename={filename}"
        )


def _merge_live_chunks(
    scored_chunks: List[tuple[str, float, dict]],
    live_docs: Optional[List[Document]],
) -> List[tuple[str, float, dict]]:
    if not live_docs:
        return scored_chunks
    existing_texts = [(chunk or "").strip() for chunk, _score, _metadata in scored_chunks if chunk]
    merged: List[tuple[str, float, dict]] = []
    for doc in live_docs:
        chunk_text = (doc.page_content or "").strip()
        if not chunk_text:
            continue
        if any(SequenceMatcher(None, chunk_text, existing).ratio() > 0.95 for existing in existing_texts):
            continue
        metadata = dict(getattr(doc, "metadata", {}) or {})
        merged.append((chunk_text, 0.95, metadata))
        existing_texts.append(chunk_text)
    return merged + scored_chunks

# 🧠 Simple wrapper to make querying easier
def ask_campusguide(query: str, chat_history: List[tuple[str, str]] = None) -> dict:
    """
    Retrieves relevant context and generates a CampusGuide response.
    """
    normalized = query.strip().lower()
    if normalized in {
        "hi",
        "hello",
        "hey",
        "good morning",
        "good afternoon",
        "good evening",
        "how are you",
        "how are you?",
    }:
        return {
            "found_answer": True,
            "answer": "I’m here and ready to help with MUST academic support questions. What would you like to know?",
            "reason": "answered",
            "citations": [],
        }

    if normalized in {
        "who are you",
        "who are you?",
        "what are you",
        "what are you?",
        "what is arassist",
        "what is arassist?",
        "who is arassist",
        "who is arassist?",
        "what is arassist the",
        "what is arassist the?",
    } or "who are you" in normalized or "what is arassist" in normalized:
        return {
            "found_answer": True,
            "answer": "I am ArASSIST, the official academic support assistant for Mbarara University of Science and Technology (MUST). I help students with academic services and connect you to AR staff when needed.",
            "reason": "answered",
        }

    retrieval_query = _rewrite_query_with_history(query, chat_history)
    if retrieval_query != query:
        print(f"[rewrite] original='{query}' rewritten='{retrieval_query}'")

    portal = detect_portal_intent(query)

    try:
        retrieval_start = perf_counter()
        scored_chunks = retrieve_relevant_context_scored(retrieval_query, top_k=8)
        retrieval_ms = (perf_counter() - retrieval_start) * 1000
        print(f"[perf] hybrid_retrieval_ms={retrieval_ms:.2f} query_len={len(retrieval_query)} results={len(scored_chunks)}")
    except Exception as e:
        print(f"Error retrieving context for query '{query}': {e}")
        return {
            "found_answer": False,
            "answer": "I'm sorry, I'm having trouble connecting right now. Please try again later.",
            "reason": "system_error",
        }

    live_docs = get_live_context(query)
    scored_chunks = _merge_live_chunks(scored_chunks, live_docs)
    scored_chunks = _rerank_chunks_for_query(query, scored_chunks)

    _log_selected_context(scored_chunks, max_chunks=7)
    context = _prepare_context(scored_chunks, max_chunks=7, max_chars=6000)
    if not context:
        return _build_final_result(
            can_answer=False,
            needs_clarification=False,
            answer="",
            citations=[],
        )

    try:
        generation_start = perf_counter()
        llm_output = generate_response(query, context, chat_history)
        generation_ms = (perf_counter() - generation_start) * 1000
        print(f"[perf] answer_generation_ms={generation_ms:.2f} query_len={len(query)}")
        if not llm_output:
            return {
                "found_answer": False,
                "answer": "I'm sorry, I'm having trouble connecting right now. Please try again later.",
                "reason": "system_error",
            }

        citations = llm_output.get("citations", [])
        if llm_output.get("needs_clarification"):
            return _build_final_result(
                can_answer=False,
                needs_clarification=True,
                answer=llm_output.get("clarifying_question") or "Could you clarify what specific information you need?",
                citations=citations,
            )

        found = bool(llm_output.get("can_answer"))
        final_answer = str(llm_output.get("answer") or "").strip()
        if not final_answer:
            found = False

        if portal and found:
            final_answer += build_redirect_note(portal)

        return _build_final_result(
            can_answer=found,
            needs_clarification=False,
            answer=final_answer,
            citations=citations,
        )
    except Exception as e:
        print(f"Error generating LLM response: {e}")
        return {
            "found_answer": False,
            "answer": "I'm sorry, I'm having trouble connecting right now. Please try again later.",
            "reason": "system_error",
        }
