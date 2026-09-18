"""Tests for Phase 1 Institutional Memory (Reviewed Knowledge Loop).

Validates:
1. Deterministic phrase extraction exclusions (stopwords, numbers, dates, activity words).
2. Proposed aliases remain strictly quarantined and do NOT affect expansion or scoring.
3. Approved aliases are hot-reloaded and improve matching for matching field reports.
4. Hot-reloading aliases in EnsembleMatcher preserves activity embedding memory identity.
5. Data-access layer refuses to re-queue reviewed rows ('approved', 'rejected', 'remapped').
6. Baseline tier distribution is preserved when no new alias is active.
"""

import pytest
from pathlib import Path
from config import settings
from database.supabase_client import (
    LocalMockDatabase,
    fetch_schedule_activities,
    fetch_verified_domain_aliases,
    fetch_domain_aliases,
    fetch_field_updates,
    propose_domain_alias,
    review_domain_alias,
    requeue_field_update_for_rematch,
)
from database.import_data import (
    import_schedule_activities,
    import_domain_aliases,
    import_raw_field_updates,
)
from engine.alias_expander import DomainAliasExpander
from engine.alias_proposer import extract_candidate_terms
from engine.ensemble_matcher import EnsembleMatcher
from engine.run_supabase_matching import run_supabase_matching


@pytest.fixture(scope="module")
def db_client():
    """Isolated local mock database for testing institutional memory."""
    test_storage = settings.DATA_DIR / "test_institutional_memory_mock.json"
    if test_storage.exists():
        test_storage.unlink()
    client = LocalMockDatabase(test_storage)
    import_schedule_activities(client)
    import_domain_aliases(client)
    import_raw_field_updates(client)
    yield client
    if test_storage.exists():
        test_storage.unlink()


def test_alias_proposer_extraction():
    """Verifies deterministic candidate extraction cleanly excludes stopwords, numbers, dates, and activity words."""
    field_text = "On 15/09/2026, 100m Box-up work completed at Manifold B with 50kg fittings."
    target_activity = "Piping Spool Erection and Field Fit-up - Manifold A"
    target_discipline = "Piping"

    candidates = extract_candidate_terms(
        field_text=field_text,
        target_activity_name=target_activity,
        target_discipline=target_discipline,
    )

    assert len(candidates) > 0
    extracted_terms = [c["field_term"] for c in candidates]

    # Stopwords and generic words must not be extracted
    assert "on" not in extracted_terms
    assert "at" not in extracted_terms
    assert "with" not in extracted_terms
    assert "work" not in extracted_terms
    assert "completed" not in extracted_terms

    # Dates, numbers, units must not be extracted
    assert "15/09/2026" not in extracted_terms
    assert "100m" not in extracted_terms
    assert "50kg" not in extracted_terms

    # Words already present in the target activity must be excluded from single-word candidates
    assert "piping" not in extracted_terms
    assert "spool" not in extracted_terms
    assert "erection" not in extracted_terms

    # Jargon "box-up" should be the top-ranked candidate
    assert candidates[0]["field_term"] == "box-up"
    assert candidates[0]["discipline"] == "Piping"


def test_proposed_aliases_do_not_affect_matching(db_client):
    """Asserts that inserting a status='proposed' alias does not participate in matching."""
    activities = fetch_schedule_activities(db_client)
    verified_aliases = fetch_verified_domain_aliases(db_client)

    matcher = EnsembleMatcher(
        activities=activities,
        alias_expander=DomainAliasExpander(aliases=verified_aliases)
    )

    report = {
        "update_id": "TEST-PROPOSED-01",
        "field_text": "Box-up work completed at Manifold B",
        "source_type": "text"
    }

    initial_match = matcher.match_single_report(report)
    initial_score = initial_match["confidence_score"]
    initial_tier = initial_match["confidence_level"]
    assert "box-up" not in initial_match["applied_aliases"]

    # Propose new alias into database
    proposed = propose_domain_alias(db_client, {
        "field_term": "box-up",
        "standard_term": "Piping Spool Erection and Field Fit-up Assembly",
        "discipline": "Piping",
        "source_update_id": "TEST-PROPOSED-01"
    })
    assert proposed["status"] == "proposed"

    # Verify that fetch_verified_domain_aliases still excludes it
    active_aliases = fetch_verified_domain_aliases(db_client)
    assert not any(a["field_term"] == "box-up" for a in active_aliases)

    # Even if raw aliases table is passed to DomainAliasExpander, it filters out non-verified
    all_aliases = fetch_domain_aliases(db_client)
    expander_with_all = DomainAliasExpander(aliases=all_aliases)
    assert not any(a["field_term"] == "box-up" for a in expander_with_all.aliases)

    # Hot-reload with verified aliases: score and tier MUST be identical
    matcher.reload_aliases(active_aliases)
    second_match = matcher.match_single_report(report)
    assert second_match["confidence_score"] == initial_score
    assert second_match["confidence_level"] == initial_tier
    assert "box-up" not in second_match["applied_aliases"]


def test_approving_alias_affects_matching(db_client):
    """Asserts that once an alias is approved ('verified'), it applies and improves matching."""
    activities = fetch_schedule_activities(db_client)

    # Find the proposed 'box-up' alias and approve it
    all_aliases = fetch_domain_aliases(db_client)
    proposed_row = next(a for a in all_aliases if a["field_term"] == "box-up")

    review_domain_alias(
        db_client,
        alias_id=proposed_row["id"],
        status="verified",
        reviewed_by="Lead Project Planner"
    )

    # Now it must appear in fetch_verified_domain_aliases
    updated_verified = fetch_verified_domain_aliases(db_client)
    assert any(a["field_term"] == "box-up" for a in updated_verified)

    # Initialize or reload matcher
    matcher = EnsembleMatcher(
        activities=activities,
        alias_expander=DomainAliasExpander(aliases=updated_verified)
    )

    report = {
        "update_id": "TEST-VERIFIED-01",
        "field_text": "Box-up work completed at Manifold B",
        "source_type": "text"
    }

    new_match = matcher.match_single_report(report)
    assert "box-up" in new_match["applied_aliases"]
    assert new_match["confidence_score"] > 0.60
    assert new_match["confidence_level"] in ("High", "Medium")


def test_reload_aliases_preserves_embeddings(db_client):
    """Asserts matcher.reload_aliases(new_aliases) updates expander while keeping exact embedding array in memory."""
    activities = fetch_schedule_activities(db_client)
    verified_aliases = fetch_verified_domain_aliases(db_client)

    matcher = EnsembleMatcher(
        activities=activities,
        alias_expander=DomainAliasExpander(aliases=verified_aliases)
    )

    old_embeddings = matcher.activity_embeddings

    # Hot reload with empty or updated aliases
    dummy_aliases = verified_aliases + [{
        "field_term": "dummy-term",
        "standard_term": "Dummy Standard",
        "discipline": "Piping",
        "status": "verified"
    }]
    matcher.reload_aliases(dummy_aliases)

    # Crucial check: memory identity must be preserved (zero recomputation)
    assert matcher.activity_embeddings is old_embeddings
    assert any(a["field_term"] == "dummy-term" for a in matcher.alias_expander.aliases)


def test_requeue_refuses_reviewed_rows(db_client):
    """Asserts calling requeue_field_update_for_rematch on reviewed rows raises ValueError."""
    # Run initial matching
    run_supabase_matching(client=db_client)
    updates = fetch_field_updates(db_client)
    first_upd = updates[0]
    upd_id = first_upd["update_id"]

    # Test 1: Can re-queue a pending row
    assert first_upd.get("status") == "pending"
    requeue_field_update_for_rematch(db_client, update_id=upd_id, remarks="Testing pending requeue")

    rechecked = db_client.table("field_updates").select("*").eq("update_id", upd_id).execute().data[0]
    assert rechecked["confidence_level"] == "Pending"
    assert rechecked["confidence_score"] is None

    # Check that a requeue audit record was logged
    audit_logs = db_client.table("planner_audit_logs").select("*").eq("action", "requeue").execute().data
    assert len(audit_logs) >= 1

    # Test 2: Cannot re-queue an approved row
    db_client.table("field_updates").update({"status": "approved"}).eq("update_id", upd_id).execute()
    with pytest.raises(ValueError, match="Row is already reviewed with status 'approved'"):
        requeue_field_update_for_rematch(db_client, update_id=upd_id)

    # Test 3: Cannot re-queue a rejected row
    db_client.table("field_updates").update({"status": "rejected"}).eq("update_id", upd_id).execute()
    with pytest.raises(ValueError, match="Row is already reviewed with status 'rejected'"):
        requeue_field_update_for_rematch(db_client, update_id=upd_id)

    # Test 4: Cannot re-queue a remapped row
    db_client.table("field_updates").update({"status": "remapped"}).eq("update_id", upd_id).execute()
    with pytest.raises(ValueError, match="Row is already reviewed with status 'remapped'"):
        requeue_field_update_for_rematch(db_client, update_id=upd_id)


def test_existing_tier_distribution_preserved():
    """Verifies that running matching on the clean baseline maintains the 40-record tier distribution."""
    fresh_storage = settings.DATA_DIR / "test_baseline_dist_mock.json"
    if fresh_storage.exists():
        fresh_storage.unlink()

    client = LocalMockDatabase(fresh_storage)
    import_schedule_activities(client)
    import_domain_aliases(client)
    import_raw_field_updates(client)

    run_supabase_matching(client=client)

    updates = fetch_field_updates(client)
    assert len(updates) == 40

    high = sum(1 for u in updates if u.get("confidence_level") == "High")
    med = sum(1 for u in updates if u.get("confidence_level") == "Medium")
    low = sum(1 for u in updates if u.get("confidence_level") == "Low")

    assert high + med + low == 40
    # Original baseline: 10 High, 15 Medium, 15 Low
    assert high == 10
    assert med == 15
    assert low == 15

    if fresh_storage.exists():
        fresh_storage.unlink()
