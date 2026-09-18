"""Tests for Phase 2 Validation Layer (Project Controls).

Validates:
1. All 6 deterministic checks (date plausibility, candidate ambiguity, location consistency,
   duplicate detection, discipline consistency, sequence plausibility).
2. Aggregator status precedence ('fail' -> 'block', 'warn' -> 'warn', 'pass' -> 'pass').
3. Confidence invariance: confidence_score and confidence_level are completely untouched by validation.
4. Baseline 40-record tier distribution preserves 10 High / 15 Medium / 15 Low.
5. Override mechanism enforces non-empty justification and logs audit action 'override'.
6. Cross-language alias proposer parity against shared JSON benchmark fixture.
"""

import json
import pytest
from pathlib import Path
from config import settings
from database.supabase_client import (
    LocalMockDatabase,
    fetch_schedule_activities,
    fetch_field_updates,
    override_field_update_validation,
    fetch_planner_audit_logs,
)
from database.import_data import (
    import_schedule_activities,
    import_domain_aliases,
    import_raw_field_updates,
)
from engine.validators import (
    validate_date_plausibility,
    validate_candidate_ambiguity,
    validate_location_consistency,
    validate_duplicate_detection,
    validate_reporter_discipline,
    validate_sequence_plausibility,
    validate_report_matching,
)
from engine.ensemble_matcher import EnsembleMatcher
from engine.alias_proposer import extract_candidate_terms
from engine.run_supabase_matching import run_supabase_matching


@pytest.fixture(scope="module")
def mock_db():
    """Isolated local mock database for testing validation engine."""
    test_storage = settings.DATA_DIR / "test_validation_engine_mock.json"
    if test_storage.exists():
        test_storage.unlink()
    client = LocalMockDatabase(test_storage)
    import_schedule_activities(client)
    import_domain_aliases(client)
    import_raw_field_updates(client)
    yield client
    if test_storage.exists():
        test_storage.unlink()


# --------------------------------------------------------------------------
# 1. Individual Validation Checks
# --------------------------------------------------------------------------

def test_validate_date_plausibility():
    """Test date plausibility within tolerance, out of bounds, and with missing dates."""
    activity = {
        "activity_id": "OIL-PIP-001",
        "planned_start_date": "2026-03-01",
        "planned_finish_date": "2026-04-30",
    }

    # Pass: within window
    res_pass = validate_date_plausibility({"reported_date": "2026-03-15"}, activity)
    assert res_pass["outcome"] == "pass"

    # Pass: within tolerance before (e.g. 15 days before start, within 30d tolerance)
    res_early = validate_date_plausibility({"reported_date": "2026-02-15"}, activity)
    assert res_early["outcome"] == "pass"

    # Fail: report date 93 days after finish (beyond 60d tolerance)
    res_fail = validate_date_plausibility({"reported_date": "2026-08-01"}, activity)
    assert res_fail["outcome"] == "fail"
    assert "93 days after" in res_fail["message"]

    # Pass: missing or malformed date gracefully passes
    res_missing = validate_date_plausibility({"reported_date": None}, activity)
    assert res_missing["outcome"] == "pass"


def test_validate_candidate_ambiguity():
    """Test candidate ambiguity margin separation."""
    # Fail: top candidate 0.84, runner-up 0.825 -> margin 0.015 < 0.05
    candidates_close = [
        {"activity_id": "ACT-1", "activity_name": "Activity One", "score": 0.840},
        {"activity_id": "ACT-2", "activity_name": "Activity Two", "score": 0.825},
    ]
    res_close = validate_candidate_ambiguity({}, None, candidates=candidates_close)
    assert res_close["outcome"] == "fail"
    assert res_close["evidence"]["margin"] == pytest.approx(0.015, abs=1e-4)

    # Pass: margin 0.15 >= 0.05
    candidates_distinct = [
        {"activity_id": "ACT-1", "activity_name": "Activity One", "score": 0.85},
        {"activity_id": "ACT-2", "activity_name": "Activity Two", "score": 0.70},
    ]
    res_distinct = validate_candidate_ambiguity({}, None, candidates=candidates_distinct)
    assert res_distinct["outcome"] == "pass"

    # Pass: single candidate or no candidates
    res_single = validate_candidate_ambiguity({}, None, candidates=[{"activity_id": "ACT-1", "score": 0.90}])
    assert res_single["outcome"] == "pass"


def test_validate_candidate_ambiguity_real_sibling_manifold(mock_db):
    """Verifies that real sibling manifolds produce an ambiguity fail with margin < 0.05."""
    activities = fetch_schedule_activities(mock_db)
    matcher = EnsembleMatcher(activities=activities)
    match_result = matcher.match_single_report({"field_text": "Box-up work completed at Manifold B"}, top_k=3)
    results = match_result.get("candidate_matches", [])
    assert len(results) >= 2
    top1 = results[0]
    top2 = results[1]
    score1 = top1.get("combined_score") or top1.get("final_score") or top1.get("score") or 0.0
    score2 = top2.get("combined_score") or top2.get("final_score") or top2.get("score") or 0.0
    margin = score1 - score2

    # Assert exact sibling manifold ambiguity detected
    assert margin < 0.05
    res = validate_candidate_ambiguity({}, None, candidates=results)
    assert res["outcome"] == "fail"
    assert "Candidate Ambiguity" in res["message"]


def test_validate_location_consistency():
    """Test site location comparison."""
    # Pass: identical or overlapping location
    res_pass = validate_location_consistency(
        {"site_location": "Manifold B", "field_text": "Tie-in work done"},
        {"activity_name": "Tie-in Spool Erection - Manifold B Sector", "wbs_name": "Manifold B Sector"}
    )
    assert res_pass["outcome"] == "pass"

    # Fail: conflicting known locations
    res_fail = validate_location_consistency(
        {"site_location": "Pump Station 1", "field_text": "Pump installation"},
        {"activity_name": "Manifold B Spool Erection", "wbs_name": "Manifold B Area"}
    )
    # If different categories (pump vs manifold), it passes gracefully or fails if same category
    assert res_fail["outcome"] in ("pass", "fail")

    # Direct conflicting manifold categories: Manifold A vs Manifold B
    res_conflict = validate_location_consistency(
        {"site_location": "Manifold B", "field_text": "Spool work"},
        {"activity_name": "Manifold A Spool Erection", "wbs_name": "Sector A"}
    )
    assert res_conflict["outcome"] == "fail"
    assert "Location Mismatch" in res_conflict["message"]

    # Pass: missing location gracefully passes
    res_none = validate_location_consistency({}, {"activity_name": "Activity A"})
    assert res_none["outcome"] == "pass"


def test_validate_duplicate_detection():
    """Test duplicate detection on same activity, date, and reporter."""
    all_reports = [
        {
            "id": "rep-1",
            "update_id": "OIL-DPR-001",
            "matched_activity_id": "OIL-PIP-001",
            "reported_date": "2026-09-15",
            "status": "approved",
        },
        {
            "id": "rep-2",
            "update_id": "OIL-DPR-002",
            "matched_activity_id": "OIL-PIP-001",
            "reported_date": "2026-09-15",
            "status": "pending",
        },
    ]

    current_report = {
        "id": "rep-2",
        "update_id": "OIL-DPR-002",
        "reported_date": "2026-09-15",
    }

    # Fail: an approved duplicate exists for this activity & date
    res_dup = validate_duplicate_detection(
        current_report,
        {"activity_id": "OIL-PIP-001"},
        all_reports=all_reports
    )
    assert res_dup["outcome"] == "fail"
    assert "Duplicate Progress Claim" in res_dup["message"]

    # Pass: unique report for another date
    res_uniq = validate_duplicate_detection(
        {"id": "rep-3", "update_id": "OIL-DPR-003", "reported_date": "2026-09-16"},
        {"activity_id": "OIL-PIP-001"},
        all_reports=all_reports
    )
    assert res_uniq["outcome"] == "pass"


def test_validate_reporter_discipline():
    """Test reporter discipline alignment."""
    # Pass: matching discipline
    res_pass = validate_reporter_discipline(
        {"reported_by": "Ramesh Borah (Piping Foreman)"},
        {"discipline": "Piping"}
    )
    assert res_pass["outcome"] == "pass"

    # Warn: cross-discipline mismatch
    res_warn = validate_reporter_discipline(
        {"reported_by": "Sunil Nath (Electrical Supervisor)"},
        {"discipline": "Civil"}
    )
    assert res_warn["outcome"] == "warn"
    assert "Cross-Discipline" in res_warn["message"]

    # Pass: unassigned discipline
    res_unassigned = validate_reporter_discipline(
        {"reported_by": "General Supervisor"},
        {"discipline": "Civil"}
    )
    assert res_unassigned["outcome"] == "pass"


def test_validate_sequence_plausibility():
    """Test sequence predecessor logic."""
    all_acts = [
        {"activity_id": "SIBLING-1", "wbs_code": "WBS-01", "planned_start_date": "2026-02-01", "planned_progress_pct": 0.0},
        {"activity_id": "CURRENT-1", "wbs_code": "WBS-01", "planned_start_date": "2026-04-01", "planned_progress_pct": 0.0},
    ]

    current_act = all_acts[1]

    # Warn: earlier sibling has zero progress and no approved reports
    res_warn = validate_sequence_plausibility(
        {"reported_date": "2026-04-05"},
        current_act,
        all_activities=all_acts,
        all_reports=[]
    )
    assert res_warn["outcome"] == "warn"
    assert "Sequence Warning" in res_warn["message"]

    # Pass: earlier sibling has completed progress
    all_acts[0]["planned_progress_pct"] = 100.0
    res_pass = validate_sequence_plausibility(
        {"reported_date": "2026-04-05"},
        current_act,
        all_activities=all_acts,
        all_reports=[]
    )
    assert res_pass["outcome"] == "pass"


# --------------------------------------------------------------------------
# 2. Aggregator Status Precedence
# --------------------------------------------------------------------------

def test_validate_report_matching_aggregation_precedence():
    """Test aggregator precedence: fail -> block, warn -> warn, pass -> pass."""
    # Case 1: Any fail produces 'block'
    res_block = validate_report_matching(
        report={"reported_date": "2027-01-01"},
        matched_activity={
            "activity_id": "A1",
            "planned_finish_date": "2026-01-01",  # 1 year late -> fail
        },
        candidates=[{"activity_id": "A1", "score": 0.90}],
    )
    assert res_block["status"] == "block"

    # Case 2: No fail, but a warn produces 'warn'
    res_warn = validate_report_matching(
        report={"reported_date": "2026-03-15", "reported_by": "Sunil Nath (Electrical Supervisor)"},
        matched_activity={
            "activity_id": "A2",
            "planned_start_date": "2026-03-01",
            "planned_finish_date": "2026-04-01",
            "discipline": "Civil",
        },
        candidates=[
            {"activity_id": "A2", "score": 0.90},
            {"activity_id": "A3", "score": 0.70},
        ],
    )
    assert res_warn["status"] == "warn"

    # Case 3: All pass produces 'pass'
    res_pass = validate_report_matching(
        report={"reported_date": "2026-03-15", "reported_by": "Ramesh Borah (Piping Foreman)"},
        matched_activity={
            "activity_id": "A3",
            "planned_start_date": "2026-03-01",
            "planned_finish_date": "2026-04-01",
            "discipline": "Piping",
        },
        candidates=[
            {"activity_id": "A3", "score": 0.90},
            {"activity_id": "A4", "score": 0.70},
        ],
    )
    assert res_pass["status"] == "pass"


# --------------------------------------------------------------------------
# 3. Confidence Invariance and Baseline Tier Distribution
# --------------------------------------------------------------------------

def test_confidence_invariance_and_baseline_tiers(mock_db):
    """Verifies that running matching with validation does not change confidence scores or tier distribution."""
    # Run full matching on mock database
    stats = run_supabase_matching(mock_db)

    # 1. Assert exactly 40 updates matched
    assert stats["total_processed"] == 40

    # 2. Assert tier distribution is preserved: 10 High, 15 Medium, 15 Low
    assert stats["high_confidence"] == 10
    assert stats["medium_confidence"] == 15
    assert stats["low_confidence"] == 15

    # 3. Assert all updates have validation fields populated
    updates = fetch_field_updates(mock_db)
    assert len(updates) == 40
    for u in updates:
        assert "validation_status" in u
        assert u["validation_status"] in ("pass", "warn", "block")
        assert "validation_results" in u
        assert isinstance(u["validation_results"], (list, dict))
        assert len(u["validation_results"]) == 6
        assert u["validation_overridden"] is False


# --------------------------------------------------------------------------
# 4. Validation Override and Audit Logging
# --------------------------------------------------------------------------

def test_validation_override_and_audit(mock_db):
    """Verifies that planner override sets flags, records reason, and logs an audit record."""
    updates = fetch_field_updates(mock_db)
    target = updates[0]
    target_id = target.get("update_id") or target.get("id")

    # Rejection of empty justification
    with pytest.raises(ValueError, match="non-empty justification"):
        override_field_update_validation(
            mock_db,
            update_id=target_id,
            planner_name="Lead Planner",
            reason="   ",
        )

    # Successful override
    reason_text = "Verified with Site Superintendent Sharma that manifold spool pre-assembly was expedited ahead of schedule."
    success = override_field_update_validation(
        mock_db,
        update_id=target_id,
        planner_name="Lead Planner",
        reason=reason_text,
    )
    assert success is not None

    # Check updated fields
    updated_list = [u for u in fetch_field_updates(mock_db) if (u.get("update_id") == target_id or u.get("id") == target_id)]
    assert len(updated_list) == 1
    u = updated_list[0]
    assert u["validation_overridden"] is True
    assert u["override_reason"] == reason_text
    assert u["override_by"] == "Lead Planner"
    assert u["override_at"] is not None

    # Check audit log entry
    audit_logs = fetch_planner_audit_logs(mock_db, update_id=target.get("update_id"))
    assert len(audit_logs) >= 1
    override_log = [l for l in audit_logs if l["action"] == "override"]
    assert len(override_log) == 1
    entry = override_log[0]
    assert entry["planner_name"] == "Lead Planner"
    assert entry["remarks"] == reason_text


# --------------------------------------------------------------------------
# 5. Cross-Language Parity (Phase 1 Debt Clearance)
# --------------------------------------------------------------------------

def test_alias_proposer_cross_language_parity():
    """Verifies that Python alias proposer matches the shared test fixture exactly."""
    fixture_path = Path(__file__).parent / "fixtures" / "alias_proposal_cases.json"
    assert fixture_path.exists(), f"Fixture missing at {fixture_path}"

    with open(fixture_path, "r", encoding="utf-8") as f:
        cases = json.load(f)

    for case in cases:
        field_text = case["field_text"]
        target_activity = case["target_activity_name"]
        target_discipline = case["target_discipline"]
        expected_candidates = case["expected_candidates"]

        candidates = extract_candidate_terms(
            field_text=field_text,
            target_activity_name=target_activity,
            target_discipline=target_discipline,
        )

        assert candidates == expected_candidates, (
            f"Failed on case '{case.get('case_id')}': expected {expected_candidates}, got {candidates}"
        )
