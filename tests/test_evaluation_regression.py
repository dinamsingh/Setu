"""Regression Guards against Degenerate Signals and Metric Regressions.

PS SIH26122 - Oil India Limited (SIH 2026).
Ensures matching engine accuracy, safety guarantees, and validation check
signal utility do not regress or degenerate into constant signals.
"""

import json
from pathlib import Path
import pytest
import pandas as pd

from config import settings
from engine.evaluate import run_evaluation
from engine.validators import _find_candidate_distinction


BASELINE_METRICS_PATH = settings.DATA_DIR / "baseline_metrics.json"


@pytest.fixture(scope="module")
def baseline_metrics():
    """Loads the committed baseline metrics artifact."""
    assert BASELINE_METRICS_PATH.exists(), f"Baseline metrics artifact missing: {BASELINE_METRICS_PATH}"
    with open(BASELINE_METRICS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def current_evaluation():
    """Runs fresh evaluation across baseline reports to compare against ground truth."""
    return run_evaluation()


def test_validation_status_spread(current_evaluation):
    """
    Guard 1: validation_status across baseline reports must NOT be a single constant value.
    Catches defects where a check blocks 100% of reports, destroying project controls utility.
    """
    status_dist = current_evaluation["validation_status_distribution"]
    # Verify at least two distinct statuses are present
    active_statuses = [status for status, data in status_dist.items() if data["count"] > 0]
    assert len(active_statuses) >= 2, f"validation_status collapsed into constant value: {active_statuses}"

    # Verify no single status exceeds 85% of reports
    total = current_evaluation["metadata"]["total_reports"]
    for status, data in status_dist.items():
        share = data["count"] / total
        assert share < 0.85, f"Validation status '{status}' dominates baseline ({share:.1%}), indicating degenerate signal."

    # Verify sane baseline counts
    assert status_dist["block"]["count"] > 0
    assert status_dist["pass"]["count"] > 0
    assert status_dist["warn"]["count"] > 0


def test_no_single_check_fails_excessively(current_evaluation):
    """
    Guard 2: No single validation check may fail for more than 60% of baseline reports.
    This guard directly prevents the candidate-ambiguity 40/40 (100%) bug from recurring.
    """
    total = current_evaluation["metadata"]["total_reports"]
    max_allowed_fail_share = 0.60
    check_breakdown = current_evaluation["per_check_breakdown"]

    for check_id, counts in check_breakdown.items():
        fail_count = counts.get("fail", 0)
        fail_share = fail_count / total
        assert fail_share <= max_allowed_fail_share, (
            f"Check '{check_id}' failed for {fail_count}/{total} ({fail_share:.1%}) of reports, "
            f"exceeding maximum permitted failure threshold of {max_allowed_fail_share:.0%}. "
            "A check that fails almost everything is information-free."
        )


def test_overconfident_misroutes_remains_zero(current_evaluation):
    """
    Guard 3: Core Safety Invariant.
    Reports whose intended intent was Medium or Low must NEVER be auto-assigned to High confidence.
    """
    safety = current_evaluation["safety_metrics"]
    overconfident = safety["overconfident_misroutes"]
    assert overconfident == 0, (
        f"Safety invariant violated: {overconfident} report(s) intended for Medium/Low review "
        f"were routed to High auto-link tier! Records: {safety.get('overconfident_records')}"
    )


def test_hit_rate_baseline_no_regression(current_evaluation, baseline_metrics):
    """
    Guard 4: Top-1 and Top-3 accuracy across tiers must not regress below committed baseline.
    """
    curr_hr = current_evaluation["hit_rates"]
    base_hr = baseline_metrics["hit_rates"]

    # Overall Hit Rates
    assert curr_hr["Overall"]["top1_hit_rate_pct"] >= base_hr["Overall"]["top1_hit_rate_pct"] - 1e-4
    assert curr_hr["Overall"]["top3_hit_rate_pct"] >= base_hr["Overall"]["top3_hit_rate_pct"] - 1e-4

    # High Tier Hit Rates (Primary Automation Pipeline)
    assert curr_hr["High"]["top1_hit_rate_pct"] >= base_hr["High"]["top1_hit_rate_pct"] - 1e-4
    assert curr_hr["High"]["top3_hit_rate_pct"] >= base_hr["High"]["top3_hit_rate_pct"] - 1e-4

    # Medium Tier Hit Rates (Planner Review Candidates)
    assert curr_hr["Medium"]["top1_hit_rate_pct"] >= base_hr["Medium"]["top1_hit_rate_pct"] - 1e-4
    assert curr_hr["Medium"]["top3_hit_rate_pct"] >= base_hr["Medium"]["top3_hit_rate_pct"] - 1e-4


def test_abstention_rate_matches_baseline(current_evaluation, baseline_metrics):
    """
    Guard 5: Abstention rate (share routed to Low) must match expected baseline (37.5%).
    """
    curr_abstention = current_evaluation["safety_metrics"]["abstention_rate_pct"]
    base_abstention = baseline_metrics["safety_metrics"]["abstention_rate_pct"]
    assert curr_abstention == pytest.approx(base_abstention, abs=0.1)


def test_candidate_distinction_no_duplicate_location_wording():
    """
    Guard 6: _find_candidate_distinction must never return 'Location differences: X vs X'
    when both candidates have identical location tokens.
    """
    distinction = _find_candidate_distinction(
        "Piping Spool Erection and Field Fit-up - Manifold B",
        "Piping Spool Prefabrication at Field Workshop - Manifold B"
    )
    assert "Manifold B vs Manifold B" not in distinction
    assert "Wording distinction:" in distinction

    # Distinct locations must be reported as location differences
    diff_dist = _find_candidate_distinction(
        "Piping Spool Erection - Manifold A",
        "Piping Spool Erection - Manifold D"
    )
    assert "Location differences:" in diff_dist
    assert "Manifold A" in diff_dist and "Manifold D" in diff_dist


def test_ground_truth_false_positive_guard(current_evaluation):
    """
    Guard 7: Ground-truth links must not trigger false positive validation blocks.
    Deterministic checks on verified ground-truth activities must have an FP rate <= 5%.
    Specifically:
    - date_plausibility_fp_rate <= 0.05 (0.0 with coherent dates)
    - duplicate_detection_fp_rate <= 0.05
    - sequence_plausibility_fp_rate <= 0.05
    - reporter_discipline_fp_rate <= 0.05
    - guard_passed is True
    """
    gt_val = current_evaluation.get("ground_truth_validation")
    assert gt_val is not None, "ground_truth_validation missing from evaluation output"
    assert gt_val["evaluated_reports"] == 30

    assert gt_val["date_plausibility_fp_rate"] <= settings.VALIDATION_MAX_GROUND_TRUTH_FP_RATE
    assert gt_val["date_plausibility_fp_rate"] == 0.0, f"Expected 0.0 date FP rate, got {gt_val['date_plausibility_fp_rate']}"
    assert gt_val["duplicate_detection_fp_rate"] <= settings.VALIDATION_MAX_GROUND_TRUTH_FP_RATE
    assert gt_val["sequence_plausibility_fp_rate"] <= settings.VALIDATION_MAX_GROUND_TRUTH_FP_RATE
    assert gt_val["reporter_discipline_fp_rate"] <= settings.VALIDATION_MAX_GROUND_TRUTH_FP_RATE
    assert gt_val["guard_passed"] is True
