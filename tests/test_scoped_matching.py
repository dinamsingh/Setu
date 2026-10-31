"""Baseline-scoped matching: a report matches only its own baseline.

The worker runs with the service-role key, which bypasses RLS, so this
filter must be applied in code before any matcher is built. These tests
prove the rule at the two levels that matter:

1. ``resolve_scoped_activities`` -- the candidate set itself.
2. ``run_supabase_matching`` -- end to end, with a fake matcher that
   would pick the other planner's activity if it were ever offered it.
"""

from unittest.mock import Mock

import pytest

from database.supabase_client import LocalMockDatabase
from engine.baseline_scoping import resolve_scoped_activities
from engine.run_supabase_matching import run_supabase_matching


BASELINE_A = "baseline-a"
BASELINE_B = "baseline-b"
SAMPLE = "baseline-sample"


def _client(tmp_path):
    client = LocalMockDatabase(tmp_path / "scoped.json")
    client.tables["schedule_baselines"] = [
        {"id": BASELINE_A, "is_sample": False},
        {"id": BASELINE_B, "is_sample": False},
        {"id": SAMPLE, "is_sample": True},
    ]
    client.tables["schedule_activities"] = [
        {"activity_id": "ACT-A", "activity_name": "Road work", "baseline_id": BASELINE_A},
        {"activity_id": "ACT-B", "activity_name": "Pipeline work", "baseline_id": BASELINE_B},
        {"activity_id": "ACT-S", "activity_name": "Sample road work", "baseline_id": SAMPLE},
    ]
    client.tables["planner_supervisor_assignments"] = [
        {"supervisor_id": "sup-a", "baseline_id": BASELINE_A, "planner_id": "planner-a"},
    ]
    client.tables["evaluator_accounts"] = [
        {"user_id": "eval-1", "workspace_id": "ws-1", "role": "site"},
    ]
    client.tables["field_updates"] = []
    client.save()
    return client


def _report(submitter, text="Pipeline work", update_id="UPD-1"):
    return {
        "id": "rep-1", "update_id": update_id, "status": "pending",
        "submitted_by_user_id": submitter, "field_text": text,
        "reported_date": "2026-10-03", "site_location": "",
        "source_type": "manual_text", "confidence_level": None,
    }


def test_supervisor_matches_only_assigned_baseline(tmp_path):
    client = _client(tmp_path)
    scoped, reason = resolve_scoped_activities(
        client, _report("sup-a"), client.tables["schedule_activities"]
    )
    assert reason == "assigned-baselines"
    assert [a["activity_id"] for a in scoped] == ["ACT-A"]


def test_supervisor_never_matches_other_planner_baseline_even_if_it_scores_higher(tmp_path, monkeypatch):
    """The fake matcher scores an exact-name match highest. If the
    other planner's activity were in the candidate set, it would win.
    Scoping must keep it out of the set entirely -- not post-filter it."""
    client = _client(tmp_path)
    client.tables["field_updates"] = [_report("sup-a", text="Pipeline work")]
    client.save()

    class FakeMatcher:
        def __init__(self, activities, alias_expander=None):
            self.activities = activities

        def match_single_report(self, report, top_k=3):
            # Exact name match wins, so ACT-B would win globally.
            ranked = sorted(
                self.activities,
                key=lambda a: a["activity_name"] == report["field_text"],
                reverse=True,
            )
            top = ranked[0]
            return {
                "expanded_text": report["field_text"],
                "matched_activity_id": top["activity_id"],
                "confidence_score": 0.95,
                "confidence_level": "High",
                "matched_layer": "semantic",
                "candidate_matches": [{"activity_id": a["activity_id"]} for a in ranked[:top_k]],
            }

    monkeypatch.setattr(
        "engine.run_supabase_matching.EnsembleMatcher", FakeMatcher
    )
    stats = run_supabase_matching(client=client)
    assert stats["held"] == 0
    matched = client.tables["field_updates"][0]
    assert matched["matched_activity_id"] == "ACT-A"
    assert all(
        c["activity_id"] != "ACT-B" for c in matched["candidate_matches"]
    )


def test_evaluator_matches_sample_baseline_only(tmp_path):
    client = _client(tmp_path)
    scoped, reason = resolve_scoped_activities(
        client, _report("eval-1"), client.tables["schedule_activities"]
    )
    assert reason == "evaluator-sample"
    assert [a["activity_id"] for a in scoped] == ["ACT-S"]


def test_unassigned_supervisor_is_held_with_no_global_fallback(tmp_path, monkeypatch):
    client = _client(tmp_path)
    client.tables["field_updates"] = [_report("sup-unassigned")]
    client.save()
    monkeypatch.setattr(
        "engine.run_supabase_matching.EnsembleMatcher",
        Mock(side_effect=AssertionError("matcher must not be built for a held report")),
    )
    stats = run_supabase_matching(client=client)
    assert stats["held"] == 1
    assert stats["total_processed"] == 0
    held = client.tables["field_updates"][0]
    # No write-back at all: still pending, no match, no score.
    assert held["status"] == "pending"
    assert held.get("matched_activity_id") is None
    assert held.get("confidence_level") is None


def test_report_without_submitter_is_held(tmp_path):
    client = _client(tmp_path)
    scoped, reason = resolve_scoped_activities(
        client, _report(None), client.tables["schedule_activities"]
    )
    assert scoped is None
    assert reason.startswith("held:")


def test_pre_017_data_keeps_legacy_global_behaviour(tmp_path):
    """Fixtures / deployments with no baselines, assignments or
    baseline_id values must not suddenly hold every report pending."""
    client = LocalMockDatabase(tmp_path / "legacy.json")
    activities = [
        {"activity_id": "ACT-A", "activity_name": "Road work"},
        {"activity_id": "ACT-B", "activity_name": "Pipeline work"},
    ]
    scoped, reason = resolve_scoped_activities(
        client, _report("sup-a"), activities
    )
    assert reason == "legacy-unscoped"
    assert scoped == activities
