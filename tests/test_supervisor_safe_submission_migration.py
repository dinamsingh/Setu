"""Static security contract tests for Migration 014: Supervisor Safe Submission Boundary
and Stage C Lockdown Migration.

These tests statically verify PostgreSQL SQL definitions, RPC signatures, RLS constraints,
receipts table idempotency, least-privilege grants, and the staged rollout manual release barrier.
"""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MIGRATION_014 = ROOT / "database" / "migrations" / "014_supervisor_safe_submission.sql"
STAGE_C_MIGRATION = ROOT / "database" / "staged_rollout" / "015_lockdown_direct_field_update_inserts.sql"
STAGE_C_README = ROOT / "database" / "staged_rollout" / "README.md"

SQL_014 = MIGRATION_014.read_text(encoding="utf-8").lower()
COMPACT_SQL_014 = re.sub(r"\s+", " ", SQL_014)

SQL_STAGE_C = STAGE_C_MIGRATION.read_text(encoding="utf-8").lower()
COMPACT_SQL_STAGE_C = re.sub(r"\s+", " ", SQL_STAGE_C)


def test_migration_014_authoritative_rpc_defined():
    assert "create or replace function public.submit_supervisor_field_update" in SQL_014
    assert "security definer" in SQL_014
    assert "set search_path = ''" in SQL_014


def test_migration_014_role_authorization_and_authentication():
    assert "v_actor uuid := auth.uid()" in SQL_014
    assert "auth.role() is distinct from 'authenticated'" in SQL_014
    assert "public.current_user_role()" in SQL_014
    assert "('site', 'engineer')" in SQL_014


def test_migration_014_receipts_table_and_idempotency():
    assert "create table if not exists public.supervisor_submission_receipts" in SQL_014
    assert "alter table public.supervisor_submission_receipts enable row level security;" in SQL_014
    assert "revoke all on public.supervisor_submission_receipts from public, anon, authenticated;" in SQL_014
    assert "grant all on public.supervisor_submission_receipts to service_role;" in SQL_014
    assert "primary key (actor_user_id, idempotency_key)" in SQL_014
    assert "on conflict (actor_user_id, idempotency_key) do nothing" in SQL_014
    assert "pg_catalog.sha256" in SQL_014
    assert "'replayed', true" in SQL_014


def test_migration_014_authoritative_field_bounds_and_strict_ist_date():
    assert "length(v_field_text) < 3" in SQL_014
    assert "length(v_field_text) > 4000" in SQL_014
    assert "length(v_site_location) < 2" in SQL_014
    assert "length(v_site_location) > 200" in SQL_014
    assert "length(v_reported_by) < 2" in SQL_014
    assert "length(v_reported_by) > 100" in SQL_014
    assert "v_today_ist := (pg_catalog.timezone('asia/kolkata', pg_catalog.now()))::date" in SQL_014
    assert "if p_reported_date > v_today_ist then" in SQL_014
    assert "reported observation date cannot be in the future" in SQL_014


def test_migration_014_untrusted_metadata_isolated_from_authoritative_defaults():
    # p_interpretation and p_clarification must not overwrite candidate_matches or validation_results
    assert "'pending', 'pending', 0, null, null, null, '[]'::jsonb, null, '[]'::jsonb, false, 0, 0, v_actor" in COMPACT_SQL_014


def test_migration_014_least_privilege_grants():
    assert "revoke execute on function public.submit_supervisor_field_update" in SQL_014
    assert "grant execute on function public.submit_supervisor_field_update" in SQL_014
    assert "to authenticated;" in SQL_014
    assert "to service_role;" in SQL_014


def test_migration_014_stage_a_expansion_and_trigger_cleanup():
    # Stage A cleans up flawed trigger from earlier test runs and preserves legacy writes during expansion
    assert "drop trigger if exists trg_protect_field_update_insert_boundary on public.field_updates;" in SQL_014
    assert "drop function if exists public.protect_field_update_insert_boundary();" in SQL_014
    assert "revoke insert on table public.field_updates" not in SQL_014


def test_stage_c_lockdown_migration_structure_and_barrier():
    # Stage C must be located in database/staged_rollout/ behind manual release barrier, NOT in database/migrations/
    assert STAGE_C_MIGRATION.exists()
    assert "manual release barrier - do not deploy automatically" in SQL_STAGE_C
    assert "revoke insert on table public.field_updates from authenticated, anon, public;" in SQL_STAGE_C
    assert 'drop policy if exists "field_site_engineer_insert_own" on public.field_updates;' in SQL_STAGE_C
    assert STAGE_C_README.exists()
