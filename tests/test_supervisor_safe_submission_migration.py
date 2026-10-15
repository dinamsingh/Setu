"""Static security contract tests for Migration 014: Supervisor Safe Submission Boundary.

These tests statically verify PostgreSQL SQL definitions, RPC signatures, RLS constraints,
receipts table idempotency, and bypass prevention triggers without running live database migrations.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "database" / "migrations" / "014_supervisor_safe_submission.sql"

import re

SQL = MIGRATION.read_text(encoding="utf-8").lower()
COMPACT_SQL = re.sub(r"\s+", " ", SQL)


def test_migration_014_authoritative_rpc_defined():
    assert "create or replace function public.submit_supervisor_field_update" in SQL
    assert "security definer" in SQL
    assert "set search_path = ''" in SQL


def test_migration_014_role_authorization_and_authentication():
    assert "v_actor uuid := auth.uid()" in SQL
    assert "auth.role() is distinct from 'authenticated'" in SQL
    assert "public.current_user_role()" in SQL
    assert "('site', 'engineer')" in SQL


def test_migration_014_receipts_table_and_idempotency():
    assert "create table if not exists public.supervisor_submission_receipts" in SQL
    assert "alter table public.supervisor_submission_receipts enable row level security;" in SQL
    assert "revoke all on public.supervisor_submission_receipts from public, anon, authenticated, service_role;" in SQL
    assert "primary key (actor_user_id, idempotency_key)" in SQL
    assert "on conflict (actor_user_id, idempotency_key) do nothing" in SQL
    assert "pg_catalog.sha256" in SQL
    assert "'replayed', true" in SQL


def test_migration_014_authoritative_field_bounds_and_strict_ist_date():
    assert "length(v_field_text) < 3" in SQL
    assert "length(v_field_text) > 4000" in SQL
    assert "length(v_site_location) < 2" in SQL
    assert "length(v_site_location) > 200" in SQL
    assert "length(v_reported_by) < 2" in SQL
    assert "length(v_reported_by) > 100" in SQL
    assert "v_today_ist := (pg_catalog.timezone('asia/kolkata', pg_catalog.now()))::date" in SQL
    assert "if p_reported_date > v_today_ist then" in SQL
    assert "reported observation date cannot be in the future" in SQL


def test_migration_014_untrusted_metadata_isolated_from_authoritative_defaults():
    # p_interpretation and p_clarification must not overwrite candidate_matches or validation_results
    assert "'pending', 'pending', 0, null, null, null, '[]'::jsonb, null, '[]'::jsonb, false, 0, 0, v_actor" in COMPACT_SQL


def test_migration_014_least_privilege_grants():
    assert "revoke execute on function public.submit_supervisor_field_update" in SQL
    assert "grant execute on function public.submit_supervisor_field_update" in SQL
    assert "to authenticated;" in SQL


def test_migration_014_authoritative_direct_insert_protection():
    assert "create or replace function public.protect_field_update_insert_boundary" in SQL
    assert "if pg_catalog.current_user in ('authenticated', 'anon', 'public') then" in SQL
    assert "direct client insert on field_updates is forbidden" in SQL
    assert "trg_protect_field_update_insert_boundary" in SQL
    assert "revoke execute on function public.protect_field_update_insert_boundary" in SQL
