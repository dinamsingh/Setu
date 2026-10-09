"""Conservative, deterministic actual-progress rules. No matcher or clock access."""

import re
from datetime import date, timedelta
from decimal import Decimal

EXTRACTION_VERSION = "phase1_rules_v1"
# A comma and conjunction form one boundary, so an empty intermediate clause
# cannot discard inherited planning/negation before 'and'.
_SPLIT = re.compile(r"((?:,[ \t]*)?\b(?:and|but|while|then)\b|[;\n]|(?<!\d),|,(?!\d)|(?<!\d)[.!](?!\d))", re.I)
_NON_ACTUAL = re.compile(
    r"\b(?:not|never|no|without|will|would|should|could|may|might|planned|planning|"
    r"plan|target|targeted|expected|expect|scheduled|forecast|intended|intend|"
    r"proposed|tomorrow)\b|\b(?:hasn't|haven't|wasn't|weren't|isn't|didn't|won't)\b|"
    r"\bbe\s+(?:started|commenced|completed|finished)\b", re.I)
# These narrow manner phrases do not make an actual assertion hypothetical.
_ACTUAL_QUALIFIERS = re.compile(
    r"\b(?:without\s+(?:delay|issues)|as\s+per\s+plan|according\s+to\s+plan)\b", re.I)
_START = re.compile(r"\b(?:started|commenced|began)\b", re.I)
_FINISH = re.compile(r"\b(?:completed|finished)\b", re.I)
_PERCENT = re.compile(r"(?<![\w.\-+,])(\d+(?:\.\d+)?)\s*%\s*(?:complete(?:d)?|done)\b", re.I)
_DATE = re.compile(r"\b(today|yesterday|\d{4}-\d{2}-\d{2})\b", re.I)


def _anchor(value):
    # Only canonical dates. A datetime/timezone or malformed string is not a date anchor.
    if type(value) is date:
        return value
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    return None


def _event_date(clause, anchor):
    phrases = list(_DATE.finditer(clause))
    if len(phrases) != 1:
        return None, ("No temporal phrase is expressed; event date remains unresolved."
                      if not phrases else "Multiple temporal phrases are ambiguous; event date remains unresolved.")
    phrase = phrases[0].group().lower()
    if phrase in {"today", "yesterday"}:
        if anchor is None:
            return None, f"'{phrase}' cannot be resolved because reported_date is missing or unusable."
        try:
            resolved = anchor - timedelta(days=phrase == "yesterday")
        except OverflowError:
            return None, "Relative date exceeds the supported date range; event date remains unresolved."
        return resolved.isoformat(), f"'{phrase}' is resolved only against reported_date."
    resolved = _anchor(phrase)
    return (resolved.isoformat(), "Explicit ISO event date is preserved.") if resolved else (
        None, "Explicit date is invalid; event date remains unresolved.")


def extract_progress_events(text, reported_date=None):
    """Return ordered event dictionaries, or one UNKNOWN when rules safely infer none.

    Clause boundaries scope planning/negation and dates. A percentage completion
    phrase is PROGRESS, never a second FINISH inferred from its 'completed' word.
    Multiple undivided event statements do not share an ambiguous date.
    """
    text = text if isinstance(text, str) else ""
    events = []
    anchor = _anchor(reported_date)
    parts = _SPLIT.split(text)
    previous_non_actual = False
    for position in range(0, len(parts), 2):
        clause = parts[position].strip()
        # A shared modal/negation can govern both sides of 'and'. Do not turn
        # 'planned 60% complete and 70% completed' into an actual second event.
        inherited = (position > 0 and parts[position - 1].lstrip(',').strip().lower() == 'and'
                     and previous_non_actual)
        scope = _ACTUAL_QUALIFIERS.sub(' ', clause)
        previous_non_actual = bool(inherited or "?" in clause or _NON_ACTUAL.search(scope))
        if not clause or previous_non_actual:
            continue
        matches = []
        percentages = list(_PERCENT.finditer(clause))
        for match in percentages:
            value = Decimal(match.group(1))
            prefix = clause[:match.start()]
            signed = re.search(r"[-+]\s*$", prefix)
            # A spaced hyphen after a label is a list separator. Bare or adjacent
            # signs, plus signs and a second sign remain unsupported percentages.
            separator = re.search(r"\w[ \t]+-[ \t]+$", prefix)
            if 0 <= value <= 100 and (not signed or separator):
                matches.append((match.start(), "PROGRESS", float(value)))
        for pattern, event_type in ((_START, "START"), (_FINISH, "FINISH")):
            for match in pattern.finditer(clause):
                # A percentage clause reports extent, not an unqualified finish.
                # Unsupported/invalid percentage grammar must not fall through.
                if event_type == "FINISH" and '%' in clause:
                    continue
                matches.append((match.start(), event_type, None))
        matches.sort(key=lambda item: item[0])
        unique, seen = [], set()
        for match in matches:
            key = match[1:]
            if key not in seen:
                unique.append(match)
                seen.add(key)
        matches = unique
        event_date, date_reason = _event_date(clause, anchor)
        if len(matches) > 1 and _DATE.search(clause):
            event_date, date_reason = None, "Multiple events in one undivided clause; date scope is ambiguous."
        for _, event_type, percent in matches:
            events.append({"event_type": event_type, "event_date": event_date,
                           "progress_percent": percent, "evidence_text": clause,
                           "extraction_reason": f"Explicit actual {event_type.lower()} wording. {date_reason}",
                           "extraction_version": EXTRACTION_VERSION})
    if not events:
        events = [{"event_type": "UNKNOWN", "event_date": None, "progress_percent": None,
                   "evidence_text": text.strip() or "[No usable evidence text]",
                   "extraction_reason": "Evidence preserved; Phase 1 rules cannot safely infer an actual progress event.",
                   "extraction_version": EXTRACTION_VERSION}]
    return [{**event, "event_index": index} for index, event in enumerate(events)]
