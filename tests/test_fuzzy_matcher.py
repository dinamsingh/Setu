"""Unit Tests for RapidFuzz Lexical Matcher."""

import pytest
from engine.fuzzy_matcher import FuzzyMatcher


@pytest.fixture
def matcher():
    return FuzzyMatcher()


def test_identical_string_match(matcher):
    query = "Fabrication & Erection of 12 Trunkline Spool"
    target = "Fabrication & Erection of 12 Trunkline Spool"
    score = matcher.score(query, target)
    assert score >= 0.99, f"Expected near 1.0, got {score}"


def test_reordered_and_partial_tokens(matcher):
    query = "Spool Erection Trunkline"
    target = "Fabrication & Erection of 12-inch Trunkline Spool"
    score = matcher.score(query, target)
    assert score >= 0.70, f"Expected high score for overlapping tokens, got {score}"


def test_completely_dissimilar_strings(matcher):
    query = "Heavy torrential rainfall stopped site work"
    target = "High Tension HT Cable Pulling and Routing Feeder C"
    score = matcher.score(query, target)
    assert score <= 0.35, f"Expected low score for unrelated strings, got {score}"


def test_empty_string_handling(matcher):
    assert matcher.score("", "Some Target") == 0.0
    assert matcher.score("Some Query", "") == 0.0
    assert matcher.score("", "") == 0.0


def test_candidate_ranking(matcher):
    candidates = [
        {"activity_id": "ACT-1", "activity_name": "Trench Excavation in Soil"},
        {"activity_id": "ACT-2", "activity_name": "Piping Spool Erection and Field Fit-up"},
        {"activity_id": "ACT-3", "activity_name": "Cable Tray Laying and Routing"},
    ]
    ranked = matcher.rank_candidates("Spool erection work", candidates, top_k=2)
    assert len(ranked) == 2
    assert ranked[0]["activity_id"] == "ACT-2"
    assert ranked[0]["fuzzy_score"] > ranked[1]["fuzzy_score"]
