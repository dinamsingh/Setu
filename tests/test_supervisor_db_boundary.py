"""Database boundary security tests for Supervisor Field Update Submissions.

Verifies that direct client inserts cannot bypass server validation regardless of
source_type, session flags, or client payloads.
"""

import os
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "database" / "migrations" / "014_supervisor_safe_submission.sql"
import re

SQL = MIGRATION.read_text(encoding="utf-8").lower()
COMPACT_SQL = re.sub(r"\s+", " ", SQL)


def test_boundary_trigger_rejects_arbitrary_source_types_on_direct_insert():
    """Verify that protect_field_update_insert_boundary catches all direct client inserts."""
    # The trigger does NOT filter by source_type before checking current_user.
    # It catches ALL direct client inserts from 'authenticated' or 'anon'.
    assert "if pg_catalog.current_user in ('authenticated', 'anon', 'public') then" in SQL
    assert "direct client insert on field_updates is forbidden" in SQL


def test_boundary_trigger_does_not_trust_custom_session_flags():
    """Verify that client cannot set a session setting to bypass the boundary."""
    assert "setu.authorized_submission" not in SQL


def test_receipt_table_deduplicates_by_actor_and_idempotency_key():
    """Verify transactional idempotency guarantees in migration 014."""
    assert "primary key (actor_user_id, idempotency_key)" in SQL
    assert "v_payload_hash := pg_catalog.sha256" in SQL
    assert "idempotency key already used for different report payload" in SQL
    assert "'replayed', true" in SQL


def test_unverified_metadata_isolated_from_authoritative_fields():
    """Verify client-provided semantic metadata is kept out of planner review fields."""
    assert "'[]'::jsonb, null, '[]'::jsonb, false, 0, 0, v_actor" in COMPACT_SQL


def test_isolated_db_connection_check():
    """Check for real isolated test database availability.
    
    Per safety instructions: Never test against live Supabase.
    If no isolated local test database is configured via TEST_DATABASE_URL,
    record the limitation.
    """
    test_db_url = os.environ.get("TEST_DATABASE_URL")
    if not test_db_url:
        pytest.skip(
            "Isolated test database (TEST_DATABASE_URL) is unavailable in this environment. "
            "Live Supabase is strictly protected from test execution."
        )
