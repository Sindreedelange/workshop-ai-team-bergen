from __future__ import annotations

import re
import unicodedata
from typing import Any


STOP_WORDS = {
    "and", "are", "can", "for", "from", "how", "is", "of", "the", "to", "what", "which", "with",
    "den", "det", "dette", "eller", "er", "for", "fra", "har", "hva", "hvilke", "hvordan", "i", "kan",
    "med", "om", "og", "på", "reglene", "regel", "som", "til", "ved",
}


def normalize_text(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    without_marks = "".join(character for character in decomposed if not unicodedata.combining(character))
    return " ".join(re.findall(r"[a-z0-9æø]+", without_marks))


def query_terms(value: str) -> list[str]:
    return [token for token in normalize_text(value).split() if token not in STOP_WORDS and (len(token) >= 3 or token.isdigit())]


def score_chunk(candidate: dict[str, Any], query: str | None = None, topic: str | None = None, zone_code: str | None = None) -> tuple[float, list[str]] | None:
    text = normalize_text(str(candidate.get("text", "")))
    heading = normalize_text(str(candidate.get("heading") or ""))
    topics = {normalize_text(str(value)) for value in candidate.get("topics", [])}
    zones = {normalize_text(str(value)) for value in candidate.get("zoneCodes", [])}
    score = 0.0
    matched: set[str] = set()

    if zone_code:
        zone = normalize_text(zone_code).replace(" ", "")
        compact_zones = {value.replace(" ", "") for value in zones}
        if zone not in compact_zones:
            return None
        score += 60
        matched.add(zone_code)

    if topic:
        normalized_topic = normalize_text(topic)
        topic_tokens = query_terms(topic)
        exact_topic = normalized_topic in topics
        text_topic = bool(topic_tokens) and all(token in text or token in heading for token in topic_tokens)
        if not exact_topic and not text_topic:
            return None
        score += 55 if exact_topic else 25
        matched.add(topic)

    if query:
        normalized_query = normalize_text(query)
        terms = query_terms(query)
        exact = bool(normalized_query) and (normalized_query in text or normalized_query in heading)
        term_matches = [term for term in terms if term in text or term in heading or term in topics]
        if not exact and not term_matches:
            return None
        if exact:
            score += 80
            matched.add(query)
        if terms:
            score += 18 * len(term_matches) + 20 * (len(term_matches) / len(terms))
            matched.update(term_matches)
        score += 30 * sum(1 for term in term_matches if term in heading)
        score += 12 * sum(1 for term in term_matches if term not in heading and term in topics)

    if candidate.get("chunkType") == "rule":
        score += 30
    if candidate.get("authority") == "binding":
        score += 10
    if candidate.get("pageType") == "table-of-contents":
        score -= 35
    elif candidate.get("authority") == "informative":
        score -= 8

    return score, sorted(matched, key=str.casefold)


def rank_chunks(candidates: list[dict[str, Any]], query: str | None = None, topic: str | None = None, zone_code: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    for candidate in candidates:
        scored = score_chunk(candidate, query=query, topic=topic, zone_code=zone_code)
        if scored is None:
            continue
        score, matched_terms = scored
        ranked.append({**candidate, "score": round(score, 3), "matchedTerms": matched_terms})
    ranked.sort(key=lambda item: (-item["score"], str(item.get("documentId", "")), int(item.get("page", 0)), str(item.get("chunkId", ""))))
    return ranked[:max(1, min(limit, 100))]
