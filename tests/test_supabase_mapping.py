"""Tests for Supabase Schema Mapping, Idempotent Import, and Matching Writeback."""

import pytest
from pathlib import Path
from config import settings
from database.supabase_client import (
    get_supabase_client,
    LocalMockDatabase,
    fetch_schedule_activities,
    fetch_domain_aliases,
    fetch_field_updates,
    get_table_counts
)
from database.import_data import (
    import_schedule_activities,
    import_domain_aliases,
    import_raw_field_updates
)
from engine.run_supabase_matching import run_supabase_matching


@pytest.fixture(scope="module")
def db_client():
    """Returns an isolated test client so tests never pollute the main application database."""
    test_storage = settings.DATA_DIR / "test_supabase_mock.json"
    if test_storage.exists():
        try:
            test_storage.unlink()
        except OSError:
            pass
    client = LocalMockDatabase(test_storage)
    yield client
    if test_storage.exists():
        try:
            test_storage.unlink()
        except OSError:
            pass


def test_missing_credentials_raises_error():
    """Client must fail with clear error when require_remote=True and keys are missing."""
    orig_url = settings.SUPABASE_URL
    orig_key = settings.SUPABASE_ANON_KEY
    orig_srv_key = settings.SUPABASE_SERVICE_ROLE_KEY
    
    # 1. Missing URL
    settings.SUPABASE_URL = ""
    settings.SUPABASE_ANON_KEY = ""
    settings.SUPABASE_SERVICE_ROLE_KEY = ""
    with pytest.raises(ValueError, match="Missing or unconfigured SUPABASE_URL in .env"):
        get_supabase_client(require_remote=True)
        
    # 2. Configured URL but missing SUPABASE_SERVICE_ROLE_KEY
    settings.SUPABASE_URL = "https://live-test-project.supabase.co"
    settings.SUPABASE_SERVICE_ROLE_KEY = ""
    with pytest.raises(ValueError, match="SUPABASE_SERVICE_ROLE_KEY is required"):
        get_supabase_client(require_remote=True)
        
    settings.SUPABASE_URL = orig_url
    settings.SUPABASE_ANON_KEY = orig_key
    settings.SUPABASE_SERVICE_ROLE_KEY = orig_srv_key


def test_idempotent_schedule_import(db_client):
    """Running schedule import multiple times must not create duplicate activities."""
    c1 = import_schedule_activities(db_client)
    assert c1 == 220
    
    activities_first = fetch_schedule_activities(db_client)
    assert len(activities_first) == 220
    
    c2 = import_schedule_activities(db_client)
    assert c2 == 220
    
    activities_second = fetch_schedule_activities(db_client)
    assert len(activities_second) == 220, "Duplicate schedule activities created"


def test_schedule_activity_embedding_dimensions(db_client):
    """Verify that stored embeddings have 384 dimensions for all-MiniLM-L6-v2."""
    activities = fetch_schedule_activities(db_client)
    assert len(activities) > 0
    sample = activities[0]
    
    assert "embedding" in sample
    emb = sample["embedding"]
    assert isinstance(emb, list)
    assert len(emb) == 384, f"Expected 384-dimensional vector, got {len(emb)}"


def test_idempotent_domain_aliases_import(db_client):
    """Running alias import multiple times must not create duplicate aliases."""
    import_domain_aliases(db_client)
    aliases_first = fetch_domain_aliases(db_client)
    
    import_domain_aliases(db_client)
    aliases_second = fetch_domain_aliases(db_client)
    
    assert len(aliases_first) == len(aliases_second)
    assert len(aliases_first) >= 20


def test_idempotent_raw_field_updates_import(db_client):
    """Raw field updates import must be idempotent on update_id."""
    import_raw_field_updates(db_client)
    updates_first = fetch_field_updates(db_client)
    
    import_raw_field_updates(db_client)
    updates_second = fetch_field_updates(db_client)
    
    assert len(updates_first) == 40
    assert len(updates_second) == 40, "Duplicate field updates created"


def test_raw_import_does_not_leak_ground_truth(db_client):
    """Import must only populate raw fields, leaving confidence initially pending."""
    updates = fetch_field_updates(db_client)
    for u in updates:
        assert "field_text" in u
        assert u["field_text"].strip() != ""
        assert u.get("status") == "pending"


def test_matching_writeback_integration(db_client):
    """
    Verifies that running run_supabase_matching writes back results:
    - High + Medium + Low == 40
    - All 40 remain status='pending'
    - Low confidence records have matched_activity_id = None
    - Re-running writeback is idempotent (keeps 40 rows).
    """
    run_supabase_matching(client=db_client)
    
    updates = fetch_field_updates(db_client)
    assert len(updates) == 40, f"Expected 40 records, found {len(updates)}"
    
    high = sum(1 for u in updates if u.get("confidence_level") == "High")
    med = sum(1 for u in updates if u.get("confidence_level") == "Medium")
    low = sum(1 for u in updates if u.get("confidence_level") == "Low")
    
    assert high > 0, "Expected at least 1 High confidence match"
    assert med > 0, "Expected at least 1 Medium confidence match"
    assert low > 0, "Expected at least 1 Low confidence match"
    assert high + med + low == 40, "All 40 records must be assigned High, Medium, or Low"
    
    # Check that all records remain status='pending'
    pending_status = sum(1 for u in updates if u.get("status") == "pending")
    assert pending_status == 40, "All updates must remain pending planner review"
    
    # Check that for Low confidence records, matched_activity_id is None
    for u in updates:
        if u.get("confidence_level") == "Low":
            assert u.get("matched_activity_id") is None, "Low confidence record must have NULL matched_activity_id"
            assert u.get("confidence_score") is not None
            assert u.get("confidence_score") < 0.55
            
    # Idempotent writeback check: re-run and confirm row count does not increase
    run_supabase_matching(client=db_client)
    updates_after = fetch_field_updates(db_client)
    assert len(updates_after) == 40, "Idempotent writeback failed: row count changed"
