"""Baseline scoping for the matching engine.

A supervisor's report must match only against schedule activities in a
baseline that supervisor is assigned to -- never against another planner's
baseline, and never by falling back to the global activity list.

This is deliberately separate from the browser/UI read boundary (Migration
017 RLS). The worker runs with the service-role key, which bypasses RLS,
so RLS alone cannot bound matching. The worker must apply this filter
itself, before any matcher is constructed, so a disallowed activity can
never be ranked -- not even as a post-filtered top-3 candidate.

Scoping data already exists; no new table or column is needed:
- ``field_updates.submitted_by_user_id`` (Migration 005, stored by the
  Migration 014 supervisor submission RPC and the Migration 013 import RPC)
  identifies who submitted the report.
- ``planner_supervisor_assignments`` (Migration 017) maps
  ``supervisor_id`` -> ``baseline_id``.
- ``schedule_activities.baseline_id`` (Migration 017) puts every activity
  in exactly one baseline; the old 220 activities are backfilled to the
  Sample Baseline.
- ``evaluator_accounts`` (Migration 016) identifies evaluator submitters,
  whose candidate set is the Sample Baseline only.

Legacy guard: scoping only activates when scoping data is present --
a ``schedule_baselines`` row exists, an activity carries a ``baseline_id``,
or an assignment row exists. Deployments / fixtures from before
Migration 017 have none of these, and keep the previous global behaviour
instead of holding every legacy report pending. Once scoping data is
present, there is no global fallback: a report with no submitter, or a
non-evaluator report with no assignment, is held pending and logged for
planner assignment.
"""

from typing import Any, Dict, List, Optional, Tuple


def _fetch_table(client: Any, table: str) -> List[Dict]:
    """Best-effort table read; a missing (pre-017) table reads as empty."""
    try:
        res = client.table(table).select("*").execute()
        return res.data or []
    except Exception:
        return []


def _ids(rows: List[Dict], key: str) -> set:
    return {str(r.get(key)) for r in rows if r.get(key) is not None}


def resolve_scoped_activities(
    client: Any,
    report: Dict,
    all_activities: List[Dict],
) -> Tuple[Optional[List[Dict]], str]:
    """Return ``(candidate activities, reason)`` for one report.

    ``activities`` is ``None`` exactly when the report must be held
    pending: scoping is active and no allowed candidate set exists for
    this submitter. Callers must then skip matching and writing for that
    report, and log the reason -- they must not fall back to
    ``all_activities``.
    """
    baselines = _fetch_table(client, "schedule_baselines")
    assignments = _fetch_table(client, "planner_supervisor_assignments")
    evaluator_rows = _fetch_table(client, "evaluator_accounts")

    scoping_active = bool(baselines) or bool(assignments) or any(
        a.get("baseline_id") for a in all_activities
    )
    if not scoping_active:
        return all_activities, "legacy-unscoped"

    submitter = report.get("submitted_by_user_id")
    if submitter is None or str(submitter).strip() == "":
        return None, "held: report has no submitted_by_user_id"

    submitter = str(submitter)

    # Evaluator exception: Sample Baseline only, never a live planner baseline.
    if submitter in _ids(evaluator_rows, "user_id"):
        sample_ids = {str(b["id"]) for b in baselines if b.get("is_sample")}
        if not sample_ids:
            return None, "held: evaluator has no Sample Baseline defined"
        scoped = [a for a in all_activities if str(a.get("baseline_id")) in sample_ids]
        return scoped, "evaluator-sample"

    assigned = {
        str(a["baseline_id"])
        for a in assignments
        if str(a.get("supervisor_id")) == submitter and a.get("baseline_id") is not None
    }
    if not assigned:
        return None, "held: supervisor has no baseline assignment"

    scoped = [a for a in all_activities if str(a.get("baseline_id")) in assigned]
    return scoped, "assigned-baselines"
