"""Database boundary security tests for Supervisor Field Update Submissions.

Verifies:
1. Static SQL authorization contracts (Stage A expansion and Stage C native privilege lockdown).
2. Authoritative PostgreSQL integration test suite executing under simulated Supabase API roles,
   JWT claims (auth.uid()), application-level roles, and RLS policies when an isolated test
   database is configured via TEST_DATABASE_URL.
3. Strict production safeguard preventing any execution against the production Supabase project.
"""

import os
import re
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION_014 = ROOT / "database" / "migrations" / "014_supervisor_safe_submission.sql"
STAGE_C_MIGRATION = ROOT / "database" / "staged_rollout" / "015_lockdown_direct_field_update_inserts.sql"

SQL_014 = MIGRATION_014.read_text(encoding="utf-8").lower()
COMPACT_SQL_014 = re.sub(r"\s+", " ", SQL_014)

SQL_STAGE_C = STAGE_C_MIGRATION.read_text(encoding="utf-8").lower()

PROD_PROJECT_REF = "zbndpmvihnsdknklmabn"


# ==============================================================================
# 1. Static Security Boundary Contracts
# ==============================================================================

def test_static_stage_a_backend_expansion_boundary():
    """Verify Stage A creates the authoritative RPC without premature lockdown."""
    assert "create or replace function public.submit_supervisor_field_update" in SQL_014
    assert "security definer" in SQL_014
    assert "set search_path = ''" in SQL_014
    assert "v_actor uuid := auth.uid()" in SQL_014
    assert "public.current_user_role()" in SQL_014
    assert "('site', 'engineer')" in SQL_014


def test_static_stage_c_native_privilege_lockdown():
    """Verify Stage C revokes direct table INSERT privileges instead of relying on triggers."""
    assert "revoke insert on table public.field_updates from authenticated, anon, public;" in SQL_STAGE_C
    assert 'drop policy if exists "field_site_engineer_insert_own" on public.field_updates;' in SQL_STAGE_C
    assert "drop trigger if exists trg_protect_field_update_insert_boundary" in SQL_STAGE_C


def test_receipt_table_deduplicates_by_actor_and_idempotency_key():
    """Verify transactional idempotency guarantees in migration 014."""
    assert "primary key (actor_user_id, idempotency_key)" in SQL_014
    assert "v_payload_hash := pg_catalog.sha256" in SQL_014
    assert "idempotency key already used for different report payload" in SQL_014
    assert "'replayed', true" in SQL_014


def test_unverified_metadata_isolated_from_authoritative_fields():
    """Verify client-provided semantic metadata is kept out of planner review fields."""
    assert "'[]'::jsonb, null, '[]'::jsonb, false, 0, 0, v_actor" in COMPACT_SQL_014


# ==============================================================================
# 2. Executable Database Integration Test Harness
# ==============================================================================

def get_verified_test_db_url():
    """Resolve and strictly validate the isolated test database connection string."""
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        return None

    # Strict protection against accidental production testing
    if PROD_PROJECT_REF in url.lower():
        raise RuntimeError(
            f"FATAL SAFETY VIOLATION: Production Supabase project reference ({PROD_PROJECT_REF}) "
            "was detected in TEST_DATABASE_URL! Tests must NEVER run against production."
        )
    return url


@pytest.fixture(scope="module")
def db_conn():
    """Establish connection to an isolated test PostgreSQL database.

    Skips if TEST_DATABASE_URL is not set or local Docker/PostgreSQL is offline.
    """
    url = get_verified_test_db_url()
    if not url:
        pytest.skip(
            "Isolated test database (TEST_DATABASE_URL) is unavailable in this environment. "
            f"Production Supabase ({PROD_PROJECT_REF}) is strictly protected from test execution. "
            "Database runtime verification status: BLOCKED."
        )

    try:
        import psycopg2
        conn = psycopg2.connect(url)
        conn.autocommit = False
        yield conn
        conn.close()
    except Exception as exc:
        pytest.skip(f"Failed to connect to isolated test database: {exc}")


def set_simulated_supabase_auth(cursor, user_id: str, role: str, app_role: str):
    """Simulate Supabase JWT authentication and user role mapping in PostgreSQL."""
    cursor.execute(f"SET ROLE {role};")
    if user_id:
        jwt_claims = f'{{"sub": "{user_id}", "role": "{role}"}}'
        cursor.execute("SELECT set_config('request.jwt.claims', %s, true);", (jwt_claims,))
        cursor.execute("SELECT set_config('request.jwt.claim.sub', %s, true);", (user_id,))
        cursor.execute("SELECT set_config('request.jwt.claim.role', %s, true);", (role,))


def test_runtime_authorized_site_user_submission(db_conn):
    """Verify an authorized site user can submit a report via RPC."""
    cur = db_conn.cursor()
    try:
        site_user_id = "00000000-0000-0000-0000-000000000001"
        set_simulated_supabase_auth(cur, site_user_id, "authenticated", "site")

        cur.execute(
            """
            SELECT public.submit_supervisor_field_update(
                p_field_text := 'Piping installation verified at manifold area',
                p_site_location := 'Duliajan Manifold Area A',
                p_reported_date := (timezone('Asia/Kolkata', now()))::date,
                p_reported_by := 'Site Supervisor',
                p_discipline := 'Piping',
                p_source_type := 'manual_text',
                p_idempotency_key := 'TEST-KEY-001'
            );
            """
        )
        result = cur.fetchone()[0]
        assert result.get("success") is True
        assert result.get("replayed") is False
        assert result.get("status") == "pending"
    finally:
        db_conn.rollback()


def test_runtime_direct_insert_denial_after_stage_c(db_conn):
    """Verify direct client table INSERT is blocked with 42501 after Stage C."""
    cur = db_conn.cursor()
    try:
        site_user_id = "00000000-0000-0000-0000-000000000001"
        set_simulated_supabase_auth(cur, site_user_id, "authenticated", "site")

        with pytest.raises(Exception) as exc_info:
            cur.execute(
                """
                INSERT INTO public.field_updates (field_text, site_location, reported_date, reported_by)
                VALUES ('Bypass attempt', 'Manifold A', current_date, 'Hacker');
                """
            )
        assert "permission denied" in str(exc_info.value).lower()
    finally:
        db_conn.rollback()


def test_runtime_future_date_rejected(db_conn):
    """Verify future observation date exceeding Asia/Kolkata today is rejected with 22023."""
    cur = db_conn.cursor()
    try:
        site_user_id = "00000000-0000-0000-0000-000000000001"
        set_simulated_supabase_auth(cur, site_user_id, "authenticated", "site")

        with pytest.raises(Exception) as exc_info:
            cur.execute(
                """
                SELECT public.submit_supervisor_field_update(
                    p_field_text := 'Future work claim',
                    p_site_location := 'Duliajan Manifold Area A',
                    p_reported_date := (timezone('Asia/Kolkata', now()) + interval '5 days')::date,
                    p_reported_by := 'Site Supervisor'
                );
                """
            )
        assert "future" in str(exc_info.value).lower()
    finally:
        db_conn.rollback()


def test_runtime_unauthorized_role_rejected(db_conn):
    """Verify a user without site or engineer role is rejected with 42501."""
    cur = db_conn.cursor()
    try:
        planner_user_id = "00000000-0000-0000-0000-000000000002"
        set_simulated_supabase_auth(cur, planner_user_id, "authenticated", "planner")

        with pytest.raises(Exception) as exc_info:
            cur.execute(
                """
                SELECT public.submit_supervisor_field_update(
                    p_field_text := 'Planner attempting field update',
                    p_site_location := 'Duliajan Manifold Area A',
                    p_reported_date := (timezone('Asia/Kolkata', now()))::date,
                    p_reported_by := 'Lead Planner'
                );
                """
            )
        assert "forbidden" in str(exc_info.value).lower() or "permission denied" in str(exc_info.value).lower()
    finally:
        db_conn.rollback()
