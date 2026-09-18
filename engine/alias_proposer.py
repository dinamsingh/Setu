"""Deterministic Domain Alias Proposer for SETU.

Extracts candidate domain jargon phrases from field reports when a planner
remaps or corrects an activity match. Generates top candidate suggestions
without requiring external LLMs or web servers.
"""

import re
from typing import Any, Dict, List, Optional, Set

STOPWORDS: Set[str] = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
    "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
    "below", "between", "both", "but", "by", "can't", "cannot", "could", "couldn't",
    "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during",
    "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't",
    "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here",
    "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i",
    "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's",
    "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself",
    "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought",
    "our", "ours", "ourselves", "out", "over", "own", "same", "shan't", "she",
    "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such",
    "than", "that", "that's", "the", "their", "theirs", "them", "themselves",
    "then", "there", "there's", "these", "they", "they'd", "they'll", "they're",
    "they've", "this", "those", "through", "to", "too", "under", "until", "up",
    "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were",
    "weren't", "what", "what's", "when", "when's", "where", "where's", "which",
    "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would",
    "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours",
    "yourself", "yourselves"
}

GENERIC_REPORT_WORDS: Set[str] = {
    "work", "works", "completed", "complete", "done", "ongoing", "started",
    "in-progress", "progress", "report", "reported", "today", "yesterday",
    "daily", "site", "status", "activity", "activities", "location", "unit",
    "area", "section", "team", "shift", "day", "date"
}

MEASUREMENT_UNITS: Set[str] = {
    "m", "mm", "cm", "km", "in", "inch", "inches", "ft", "feet", "m3", "m2",
    "cum", "sqm", "dia", "nb", "od", "id", "kg", "ton", "tons", "mt", "psi",
    "bar", "kpa", "deg", "c", "f", "hr", "hrs", "nos", "no", "qty", "%"
}


def _clean_token(t: str) -> str:
    return re.sub(r"^[^\w\-]+|[^\w\-]+$", "", t).strip()


def _is_numeric_or_unit(token: str) -> bool:
    cleaned = token.lower().strip()
    if re.fullmatch(r"^\d+([.,]\d+)?(\w+|%)?$", cleaned):
        return True
    if re.fullmatch(r"^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$", cleaned):
        return True
    if cleaned in MEASUREMENT_UNITS:
        return True
    return False


def extract_candidate_terms(
    field_text: str,
    target_activity_name: str,
    target_discipline: Optional[str] = None,
    existing_aliases: Optional[List[Dict[str, Any]]] = None,
    top_k: int = 3
) -> List[Dict[str, Any]]:
    """
    Deterministically proposes candidate domain alias terms from field text.
    
    Excludes:
    - Stopwords
    - Generic site status words (completed, ongoing, work, etc.)
    - Pure numbers, measurements, dates
    - Words already present in the target activity name
    - Terms already present in existing domain aliases
    """
    if not field_text or not target_activity_name:
        return []

    # Build exclusion sets
    existing_terms: Set[str] = set()
    if existing_aliases:
        for al in existing_aliases:
            ft = al.get("field_term")
            if ft:
                existing_terms.add(ft.lower().strip())

    # Words in target activity name (lowercased alphanumeric tokens)
    activity_words: Set[str] = set(
        re.findall(r"[a-zA-Z0-9]+", target_activity_name.lower())
    )

    # Tokenize input text preserving hyphens
    raw_tokens = field_text.split()
    tokens = [_clean_token(t) for t in raw_tokens]
    tokens = [t for t in tokens if t]

    candidates: Dict[str, float] = {}

    n_tokens = len(tokens)
    for n in (1, 2, 3):
        for i in range(n_tokens - n + 1):
            ngram_tokens = tokens[i:i + n]
            phrase = " ".join(ngram_tokens).lower()

            # Rule: Cannot start or end with a stopword or generic word
            first = ngram_tokens[0].lower()
            last = ngram_tokens[-1].lower()
            if first in STOPWORDS or last in STOPWORDS:
                continue
            if first in GENERIC_REPORT_WORDS or last in GENERIC_REPORT_WORDS:
                continue

            # Rule: Cannot contain numbers, dates, or pure units
            if any(_is_numeric_or_unit(t) for t in ngram_tokens):
                continue

            # Rule: Length check
            if len(phrase) < 3:
                continue

            # Rule: Cannot match existing aliases
            if phrase in existing_terms:
                continue

            # Rule: Cannot consist entirely of words in the target activity name
            phrase_words = set(re.findall(r"[a-zA-Z0-9]+", phrase))
            if not phrase_words or phrase_words.issubset(activity_words):
                continue

            # Scoring heuristics
            score = 1.0
            # Hyphenated terms are strong domain jargon indicators (e.g. "box-up", "tie-in")
            if "-" in phrase:
                score += 3.0
            # Multi-word ngrams are more specific
            if n == 2:
                score += 2.0
            elif n == 3:
                score += 1.2
            # Original capitalization bonus
            orig_phrase = " ".join(raw_tokens[i:i + n])
            if any(t and t[0].isupper() for t in raw_tokens[i:i + n]):
                score += 1.0
            # Position bonus (earlier terms in sentence usually describe action/component)
            score += max(0.0, 1.0 - (i / max(1, n_tokens)))

            # Keep highest score for this candidate
            if phrase not in candidates or score > candidates[phrase]:
                candidates[phrase] = score

    # Sort candidates by score descending
    sorted_candidates = sorted(candidates.items(), key=lambda x: x[1], reverse=True)

    results: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for term, score in sorted_candidates:
        # Avoid slight substring redundancy if a high-ranking phrase already captures it
        clean_term = term.strip().lower()
        if clean_term in seen:
            continue
        seen.add(clean_term)

        results.append({
            "field_term": clean_term,
            "standard_term": target_activity_name.strip(),
            "discipline": target_discipline or "General",
            "score": round(score, 2),
        })

        if len(results) >= top_k:
            break

    return results
