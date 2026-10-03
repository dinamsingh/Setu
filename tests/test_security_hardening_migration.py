"""Static security contract tests for Phase 0.8 migration 007.

These tests do not execute PostgreSQL. Live Supabase/RLS behavior requires a
disposable database and remains outside this offline test environment.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "database" / "migrations" / "007_security_hardening.sql"
GOVERNANCE_MIGRATION = ROOT / "database" / "migrations" / "006_transactional_planner_governance.sql"
AUTH_RLS_MIGRATION = ROOT / "database" / "migrations" / "005_auth_rls.sql"

SQL = MIGRATION.read_text(encoding="utf-8").lower()
GOVERNANCE_SQL = GOVERNANCE_MIGRATION.read_text(encoding="utf-8").lower()
AUTH_RLS_SQL = AUTH_RLS_MIGRATION.read_text(encoding="utf-8").lower()


def test_current_user_role_closes_anon_but_keeps_authenticated():
    assert "revoke execute on function public.current_user_role() from anon" in SQL
    assert "grant execute on function public.current_user_role() to authenticated" not in SQL
    assert "grant execute on function public.current_user_role() to authenticated" in AUTH_RLS_SQL


def test_trigger_helpers_are_not_directly_executable_by_api_roles():
    for function_name in (
        "prevent_audit_log_modification",
        "protect_field_update_original_submission",
    ):
        statement = (
            f"revoke execute on function public.{function_name}()\n"
            "    from public, anon, authenticated;"
        )
        assert statement in SQL

    assert "to_regprocedure('public.rls_auto_enable()')" in SQL
    assert "revoke execute on function public.rls_auto_enable() from public, anon, authenticated" in SQL


def test_match_function_has_explicit_safe_search_path_and_same_signature():
    assert (
        "alter function public.match_schedule_activities(vector, double precision, integer)"
        in SQL
    )
    assert "set search_path = public, extensions" in SQL
    assert "create extension" not in SQL


def test_governance_rpc_permissions_are_not_changed_by_007():
    for function_name in (
        "review_field_update",
        "override_field_update_validation",
        "requeue_field_update",
    ):
        assert function_name not in SQL

    assert "grant execute on function public.review_field_update(uuid, text, text, text)" in GOVERNANCE_SQL
    assert "grant execute on function public.override_field_update_validation(uuid, text)" in GOVERNANCE_SQL
    assert "grant execute on function public.requeue_field_update(uuid, text)" in GOVERNANCE_SQL
    assert "to authenticated" in GOVERNANCE_SQL


def test_migration_is_additive_and_does_not_change_auth_or_vector_behavior():
    assert "alter table" not in SQL
    assert "drop table" not in SQL
    assert "password" not in SQL
    assert "embedding" not in SQL
    assert "threshold" not in SQL
