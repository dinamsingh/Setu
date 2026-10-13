"""Static security contract tests for Migration 014: Supervisor Safe Submission Boundary.

These tests statically verify PostgreSQL SQL definitions, RPC signatures, RLS constraints,
and bypass prevention triggers without running live database migrations.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "database" / "migrations" / "014_supervisor_safe_submission.sql"

SQL = MIGRATION.read_text(encoding="utf-8").lower()


def test_migration_014_authoritative_rpc_defined():
    assert "create or replace function public.submit_supervisor_field_update" in SQL
    assert "security definer" in SQL
    assert "set search_path = ''" in SQL


def test_migration_014_role_authorization_and_authentication():
    assert "v_actor uuid := auth.uid()" in SQL
    assert "auth.role() is distinct from 'authenticated'" in SQL
    assert "public.current_user_role()" in SQL
    assert "('site', 'engineer')" in SQL


def test_migration_014_authoritative_field_bounds():
    assert "length(v_field_text) < 3" in SQL
    assert "length(v_field_text) > 4000" in SQL
    assert "length(v_site_location) < 2" in SQL
    assert "length(v_site_location) > 200" in SQL
    assert "length(v_reported_by) < 2" in SQL
    assert "length(v_reported_by) > 100" in SQL
    assert "reported observation date cannot be in the future" in SQL


def test_migration_014_least_privilege_grants():
    assert "revoke execute on function public.submit_supervisor_field_update" in SQL
    assert "grant execute on function public.submit_supervisor_field_update" in SQL
    assert "to authenticated;" in SQL


def test_migration_014_bypass_trigger_protection():
    assert "create or replace function public.protect_manual_field_update" in SQL
    assert "new.source_type in ('manual_text', 'voice')" in SQL
    assert "setu.authorized_submission" in SQL
    assert "trg_protect_manual_field_update" in SQL
    assert "revoke execute on function public.protect_manual_field_update" in SQL
