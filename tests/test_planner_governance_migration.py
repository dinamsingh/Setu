"""Static contract tests for Phase 0.75 planner-governance SQL.

These tests do not execute PostgreSQL or prove live RLS behavior. They provide
executable regression checks for the migration's required security structure.
Live migration testing still requires a disposable Supabase/PostgreSQL project.
"""

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "database" / "migrations" / "006_transactional_planner_governance.sql"
PREVIOUS_MIGRATION = ROOT / "database" / "migrations" / "005_auth_rls.sql"
FRONTEND_HOOK = ROOT / "frontend" / "src" / "hooks" / "useFieldUpdates.ts"

SQL = MIGRATION.read_text(encoding="utf-8").lower()
PREVIOUS_SQL = PREVIOUS_MIGRATION.read_text(encoding="utf-8").lower()
HOOK = FRONTEND_HOOK.read_text(encoding="utf-8")


def function_body(name: str) -> str:
    match = re.search(
        rf"create\s+or\s+replace\s+function\s+public\.{name}\s*\(.*?\)"
        rf".*?as\s+\$\$(.*?)\$\$;",
        SQL,
        flags=re.DOTALL,
    )
    assert match, f"Function {name} not found"
    return match.group(1)


DECISION = function_body("review_field_update")
OVERRIDE = function_body("override_field_update_validation")
REQUEUE = function_body("requeue_field_update")


def test_planner_accept_requires_existing_link_and_sets_approved():
    assert "if v_update.matched_activity_id is null" in DECISION
    assert "where sa.activity_id = v_update.matched_activity_id" in DECISION
    assert "set status = 'approved'" in DECISION


def test_planner_reject_sets_rejected_without_creating_link():
    reject_branch = DECISION.split("elsif v_action = 'reject'", 1)[1].split("else", 1)[0]
    assert "set status = 'rejected'" in reject_branch
    assert "v_new_activity_id := null" in reject_branch
    assert "matched_activity_id =" not in reject_branch


def test_planner_remap_requires_existing_target_and_sets_link():
    remap_branch = DECISION.split("else\n        if v_target_activity_id", 1)[1]
    assert "where sa.activity_id = v_target_activity_id" in remap_branch
    assert "set status = 'remapped'" in remap_branch
    assert "matched_activity_id = v_target_activity_id" in remap_branch


def test_approve_with_null_link_has_explicit_failure():
    assert "approval requires a linked schedule activity" in DECISION


def test_remap_to_unknown_activity_has_explicit_failure():
    assert "target schedule activity does not exist" in DECISION


def test_blocked_accept_and_remap_require_override():
    assert DECISION.count("v_update.validation_status = 'block'") == 2
    assert DECISION.count("v_update.validation_overridden is not true") == 2
    assert "override before approval" in DECISION
    assert "override before remap" in DECISION


def test_blank_override_reason_has_explicit_failure():
    assert "v_reason text := nullif(btrim(coalesce(p_reason, '')), '')" in SQL
    assert "if v_reason is null" in OVERRIDE
    assert "a non-empty override reason is required" in OVERRIDE


def test_override_then_approve_state_contract_exists():
    assert "set validation_overridden = true" in OVERRIDE
    assert "v_update.validation_overridden is not true" in DECISION
    assert "set status = 'approved'" in DECISION


def test_finalized_rows_cannot_be_reviewed_twice():
    assert "v_update.status is distinct from 'pending'" in DECISION
    assert "field update is already finalized" in DECISION


def test_decision_and_audit_share_one_atomic_function_body():
    assert "update public.field_updates" in DECISION
    assert "insert into public.planner_audit_logs" in DECISION
    assert DECISION.index("update public.field_updates") < DECISION.index(
        "insert into public.planner_audit_logs"
    )
    assert "exception when" not in DECISION


def test_audit_actor_is_bound_to_auth_uid():
    assert "v_actor_user_id uuid := auth.uid()" in DECISION
    assert "v_actor_user_id uuid := auth.uid()" in OVERRIDE
    assert "actor_user_id" in DECISION
    assert "actor_user_id" in OVERRIDE


def test_non_planner_roles_are_rejected_by_decision_and_override():
    role_guard = "v_actor_role is null or v_actor_role not in ('planner', 'admin')"
    assert role_guard in DECISION
    assert role_guard in OVERRIDE


def test_rpc_execute_permissions_exclude_anon_and_public():
    assert "revoke all on function public.review_field_update" in SQL
    assert "revoke all on function public.override_field_update_validation" in SQL
    assert "from public, anon, authenticated" in SQL
    assert "grant execute on function public.review_field_update" in SQL
    assert "grant execute on function public.override_field_update_validation" in SQL
    assert "to authenticated" in SQL


def test_raw_review_and_audit_writes_are_closed_to_browser_roles():
    assert "revoke update on table public.field_updates from authenticated" in SQL
    assert "drop policy if exists \"field_planner_admin_update_review\"" in SQL
    assert "revoke insert on table public.planner_audit_logs from authenticated" in SQL
    assert "drop policy if exists \"audit_authenticated_insert\"" in SQL


def test_audit_rows_remain_append_only():
    assert "create trigger trg_prevent_audit_log_modification" in PREVIOUS_SQL
    assert "before update or delete on public.planner_audit_logs" in PREVIOUS_SQL
    assert "drop trigger if exists trg_prevent_audit_log_modification" not in SQL


def test_baseline_is_browser_read_only_but_service_role_grant_is_preserved():
    assert (
        "revoke insert, update, delete on table public.schedule_activities "
        "from authenticated"
    ) in " ".join(SQL.split())
    assert "drop policy if exists \"schedule_planner_admin_write\"" in SQL
    assert "grant all on table public.schedule_activities to service_role" in SQL
    assert "grant all on table public.field_updates to service_role" in SQL
    assert "grant all on table public.planner_audit_logs to service_role" in SQL


def test_requeue_is_also_transactional_and_pending_only():
    assert "v_update.status is distinct from 'pending'" in REQUEUE
    assert "update public.field_updates" in REQUEUE
    assert "insert into public.planner_audit_logs" in REQUEUE


def test_requeue_clears_stale_validation_and_override_state():
    for assignment in (
        "validation_status = null",
        "validation_results = '[]'::jsonb",
        "validation_overridden = false",
        "override_reason = null",
        "override_by = null",
        "override_at = null",
    ):
        assert assignment in REQUEUE


def test_requeue_clears_derived_match_state_while_preserving_audit_history():
    for assignment in (
        "matched_activity_id = null",
        "matched_layer = null",
        "candidate_matches = '[]'::jsonb",
        "expanded_text = null",
    ):
        assert assignment in REQUEUE

    assert "v_previous_activity_id := v_update.matched_activity_id" in REQUEUE
    audit_values = REQUEUE.split("insert into public.planner_audit_logs", 1)[1]
    assert "v_previous_activity_id" in audit_values
    assert "'requeue',\n        v_previous_activity_id,\n        null" in audit_values


def test_frontend_uses_rpcs_instead_of_separate_table_mutations():
    assert "supabase.rpc('review_field_update'" in HOOK
    assert "supabase.rpc('override_field_update_validation'" in HOOK
    assert "supabase.rpc('requeue_field_update'" in HOOK
    assert ".from('planner_audit_logs')" not in HOOK
    assert ".from('field_updates')\n        .update(" not in HOOK
