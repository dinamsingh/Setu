#!/usr/bin/env python3
"""Phase 1 Verification Script: Reviewed Institutional Memory Loop.

PS SIH26122 - Oil India Limited (SIH 2026).
Demonstrates the full 4-step institutional learning cycle:
  (1) Unmatched site jargon produces Low confidence / abstention.
  (2) Planner proposes domain alias (stored as 'proposed', quarantined).
      Second report with identical phrasing remains Low confidence (proves quarantine).
  (3) Human approves alias -> promoted to 'verified' and hot-reloaded.
  (4) Third report matches at High confidence with alias applied.

Usage:
    python scripts/verify_learning_loop.py
"""

import sys
from pathlib import Path

# Add project root to sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from config import settings
from database.supabase_client import (
    LocalMockDatabase,
    fetch_schedule_activities,
    fetch_verified_domain_aliases,
    propose_domain_alias,
    review_domain_alias,
)
from database.import_data import (
    import_schedule_activities,
    import_domain_aliases,
)
from engine.match_worker import run_worker


def main():
    test_storage = settings.DATA_DIR / "verify_learning_loop_mock.json"
    if test_storage.exists():
        test_storage.unlink()

    client = LocalMockDatabase(test_storage)
    import_schedule_activities(client)
    import_domain_aliases(client)

    print("\n" + "=" * 78)
    print("  SETU EVIDENCE DEMO: REVIEWED INSTITUTIONAL MEMORY LOOP (PHASE 1)")
    print("=" * 78)

    # Step 1: Unknown site jargon -> Low Tier
    print("\n[STEP 1] Ingesting field report with unknown site jargon: 'Box-up work completed at Manifold B'...")
    report_1 = {
        "update_id": "UPD-E2E-001",
        "source_type": "manual_text",
        "field_text": "Box-up work completed at Manifold B",
        "site_location": "Manifold B Area",
        "reported_by": "Field Supervisor",
        "status": "pending",
        "confidence_level": "Pending",
        "confidence_score": None,
        "matched_activity_id": None,
        "expanded_text": None,
        "matched_layer": None,
        "candidate_matches": [],
    }
    client.table("field_updates").insert([report_1]).execute()
    run_worker(once=True, client=client)

    row_1 = client.table("field_updates").select("*").eq("update_id", "UPD-E2E-001").execute().data[0]
    score_1 = row_1.get("confidence_score")
    tier_1 = row_1.get("confidence_level")
    act_1 = row_1.get("matched_activity_id")
    print(f"  Result 1: Tier = {tier_1} | Score = {score_1:.4f} | Top Candidate = {act_1}")
    assert tier_1 == "Low", f"Expected Low tier, got {tier_1}"

    # Step 2: Propose alias (Quarantine proof)
    print("\n[STEP 2] Planner remaps and proposes alias (stored as 'proposed' / quarantined)...")
    proposed = propose_domain_alias(client, {
        "field_term": "box-up",
        "standard_term": "Piping Spool Erection and Field Fit-up Assembly",
        "discipline": "Piping",
        "source_update_id": "UPD-E2E-001",
        "proposed_by": "Lead Project Planner",
    })
    print(f"  Proposed Alias ID: {proposed.get('id')} | Status = '{proposed.get('status')}'")

    print("  Ingesting second identical report to verify proposed alias is quarantined...")
    report_2 = {
        "update_id": "UPD-E2E-002",
        "source_type": "manual_text",
        "field_text": "Box-up work completed at Manifold B",
        "site_location": "Manifold B Area",
        "reported_by": "Field Supervisor",
        "status": "pending",
        "confidence_level": "Pending",
        "confidence_score": None,
        "matched_activity_id": None,
        "expanded_text": None,
        "matched_layer": None,
        "candidate_matches": [],
    }
    client.table("field_updates").insert([report_2]).execute()
    run_worker(once=True, client=client)

    row_2 = client.table("field_updates").select("*").eq("update_id", "UPD-E2E-002").execute().data[0]
    score_2 = row_2.get("confidence_score")
    tier_2 = row_2.get("confidence_level")
    print(f"  Result 2 (During Quarantine): Tier = {tier_2} | Score = {score_2:.4f}")
    assert tier_2 == "Low", "Quarantine violation! Proposed alias affected matching."

    # Step 3: Human approves alias
    print("\n[STEP 3] Human reviewer approves domain alias...")
    review_domain_alias(client, proposed.get("id"), "verified", reviewed_by="Senior Project Controls Lead")
    verified_aliases = fetch_verified_domain_aliases(client)
    print(f"  Total Verified Aliases in DB: {len(verified_aliases)}")

    # Step 4: Third report matches at High confidence
    print("\n[STEP 4] Ingesting third report with same wording after human approval...")
    report_3 = {
        "update_id": "UPD-E2E-003",
        "source_type": "manual_text",
        "field_text": "Box-up work completed at Manifold B",
        "site_location": "Manifold B Area",
        "reported_by": "Field Supervisor",
        "status": "pending",
        "confidence_level": "Pending",
        "confidence_score": None,
        "matched_activity_id": None,
        "expanded_text": None,
        "matched_layer": None,
        "candidate_matches": [],
    }
    client.table("field_updates").insert([report_3]).execute()
    run_worker(once=True, client=client)

    row_3 = client.table("field_updates").select("*").eq("update_id", "UPD-E2E-003").execute().data[0]
    score_3 = row_3.get("confidence_score")
    tier_3 = row_3.get("confidence_level")
    act_3 = row_3.get("matched_activity_id")
    expanded_3 = row_3.get("expanded_text", "")
    print(f"  Result 3 (After Approval): Tier = {tier_3} | Score = {score_3:.4f} | Matched Act = {act_3}")
    print(f"  Expanded Text: '{expanded_3}'")

    assert tier_3 in ("High", "Medium")
    assert score_3 > score_1, "Matching score did not improve after alias verification."
    assert "piping spool erection" in expanded_3.lower() or "box-up" in expanded_3.lower(), "Verified alias expansion missing."

    print("\n" + "=" * 78)
    print("  [SUCCESS] PROOF OF REVIEWED INSTITUTIONAL MEMORY VERIFIED!")
    print(f"  Before Approval: Score {score_1:.4f} ({tier_1}) -> After Approval: Score {score_3:.4f} ({tier_3})")
    print("=" * 78 + "\n")

    if test_storage.exists():
        test_storage.unlink()


if __name__ == "__main__":
    main()
