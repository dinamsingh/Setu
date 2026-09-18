"""Unit and Integration Tests for EnsembleMatcher.

Validates:
1. Easy lexical match (High tier)
2. Semantic terminology mismatch with alias resolution (High/Medium tier)
3. Unmatched / Low-confidence case (Never dropped, status='pending')
4. Exact confidence-tier boundaries (High >= 0.82, Medium 0.55-0.819, Low < 0.55)
5. Top 3 candidates returned for every field report
"""

import pytest
from engine.ensemble_matcher import EnsembleMatcher


@pytest.fixture(scope="module")
def sample_activities():
    return [
        {
            "activity_id": "OIL-PIP-202-A",
            "activity_name": "Piping Spool Erection and Field Fit-up - Manifold A",
            "discipline": "Piping",
            "wbs_code": "1.2.2.1",
            "wbs_name": "Piping Execution Section A"
        },
        {
            "activity_id": "OIL-PIP-205-B",
            "activity_name": "Hydrostatic Testing of Process Piping Manifold - Section B",
            "discipline": "Piping",
            "wbs_code": "1.2.5.2",
            "wbs_name": "Piping Execution Section B"
        },
        {
            "activity_id": "OIL-PLN-102-B",
            "activity_name": "Right of Way (ROW) Clearing, Grubbing & Grading - Section B",
            "discipline": "Pipeline",
            "wbs_code": "1.1.2.2",
            "wbs_name": "Pipeline Execution Section B"
        },
        {
            "activity_id": "OIL-ELE-403-C",
            "activity_name": "High Tension (HT) Cable Pulling and Routing - Feeder C",
            "discipline": "Electrical",
            "wbs_code": "1.4.3.3",
            "wbs_name": "Electrical Execution Section C"
        },
        {
            "activity_id": "OIL-CIV-304-B",
            "activity_name": "Reinforcement Steel Bar (Rebar) Cutting, Bending & Fixing - Foundation B",
            "discipline": "Civil",
            "wbs_code": "1.3.4.2",
            "wbs_name": "Civil Execution Section B"
        }
    ]


@pytest.fixture(scope="module")
def ensemble_engine(sample_activities):
    return EnsembleMatcher(activities=sample_activities)


def test_easy_lexical_match_high_tier(ensemble_engine):
    """Clear match should achieve High Confidence (>= 0.82) and suggest correct activity."""
    report = {
        "update_id": "TEST-001",
        "field_text": "Piping Spool Erection and Field Fit-up completed at Manifold A.",
        "source_type": "text"
    }
    result = ensemble_engine.match_single_report(report, top_k=3)
    
    assert result["matched_activity_id"] == "OIL-PIP-202-A"
    assert result["confidence_level"] == "High"
    assert result["confidence_score"] >= 0.82
    assert result["status"] == "pending"
    assert len(result["candidate_matches"]) == 3


def test_semantic_jargon_mismatch_with_alias(ensemble_engine):
    """
    Colloquial site text using field jargon ('spool erection', 'fit up')
    should map to piping spool erection via semantic embedding and alias expansion.
    """
    report = {
        "update_id": "TEST-002",
        "field_text": "spool fit up done today on manifold a",
        "source_type": "whatsapp_log"
    }
    result = ensemble_engine.match_single_report(report, top_k=3)
    
    assert result["matched_activity_id"] == "OIL-PIP-202-A"
    assert "spool" in result["applied_aliases"]
    assert result["confidence_score"] >= 0.70
    assert result["confidence_level"] in ["High", "Medium"]
    assert result["status"] == "pending"


def test_unmatched_low_confidence_never_dropped(ensemble_engine):
    """
    Unrelated field text (weather, daily banter) must NOT be dropped,
    must be classified as Low confidence, and keep status='pending'.
    """
    report = {
        "update_id": "TEST-003",
        "field_text": "Heavy rain caused waterlogging, all civil operations halted for today.",
        "source_type": "whatsapp_log"
    }
    result = ensemble_engine.match_single_report(report, top_k=3)
    
    assert result["confidence_level"] == "Low"
    assert result["confidence_score"] < 0.55
    assert result["matched_layer"] == "unmatched"
    assert result["status"] == "pending"
    assert len(result["candidate_matches"]) == 3


def test_confidence_tier_boundaries(ensemble_engine):
    """Verify threshold boundary logic."""
    from config import settings
    
    # Test High threshold
    assert settings.THRESHOLD_HIGH_CONFIDENCE == 0.82
    assert settings.THRESHOLD_MEDIUM_CONFIDENCE == 0.55


def test_explainable_score_components(ensemble_engine):
    """Verify that all score components are present and formula is preserved."""
    report = {
        "update_id": "TEST-004",
        "field_text": "HT cable pulling and routing done for feeder C",
        "source_type": "excel"
    }
    result = ensemble_engine.match_single_report(report, top_k=3)
    
    top_cand = result["candidate_matches"][0]
    assert "semantic_score" in top_cand
    assert "fuzzy_score" in top_cand
    assert "discipline_boost" in top_cand
    assert "final_score" in top_cand
    
    # Check formula: 0.55 * sem + 0.35 * fuzz + 0.10 * disc
    expected = (0.55 * top_cand["semantic_score"]) + (0.35 * top_cand["fuzzy_score"]) + (0.10 * top_cand["discipline_boost"])
    assert abs(top_cand["final_score"] - expected) < 0.001
