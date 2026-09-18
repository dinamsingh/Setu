"""Database Verification Script for SETU.

Validates row counts across all tables, verifies confidence ratings, ensures
no field updates were dropped, and prints representative database records.
"""

import sys
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from database.supabase_client import (
    get_supabase_client,
    get_table_counts,
    fetch_schedule_activities,
    fetch_field_updates,
    fetch_domain_aliases
)


def verify_database_state():
    """Validates complete database integrity against SETU MVP requirements."""
    print("=" * 70)
    print("SETU - Supabase Database Verification Audit")
    print("=" * 70)

    from database.supabase_client import get_database_mode
    from config import settings

    print(f"Target Supabase URL : {settings.SUPABASE_URL}")
    print(f"Active Database Mode: {get_database_mode()}")
    print("-" * 70)

    client = get_supabase_client()
    counts = get_table_counts(client)

    print("\n[Check 1] Table Row Counts:")
    for tbl, cnt in counts.items():
        print(f"  - {tbl:22s}: {cnt:4d} rows")

    # 1. Confirm 220 schedule activities
    sched_count = counts.get("schedule_activities", 0)
    assert sched_count == 220, f"Expected 220 schedule activities, found {sched_count}"
    print("  [OK] Confirmed: 220 schedule activities in database.")

    # 2. Confirm domain aliases count
    alias_count = counts.get("domain_aliases", 0)
    assert alias_count >= 20, f"Expected >= 20 domain aliases, found {alias_count}"
    print(f"  [OK] Confirmed: {alias_count} domain aliases in database.")

    # 3. Confirm 40 field updates
    field_updates = fetch_field_updates(client)
    assert len(field_updates) == 40, f"Expected 40 field updates, found {len(field_updates)}"
    print("  [OK] Confirmed: 40 field updates in database.")

    # 4. Confirm matched results and confidence levels
    tier_counts = {"High": 0, "Medium": 0, "Low": 0, "Pending": 0}
    status_counts = {"pending": 0, "approved": 0, "rejected": 0, "remapped": 0}

    for u in field_updates:
        tier = u.get("confidence_level", "Pending")
        status = u.get("status", "pending")
        tier_counts[tier] = tier_counts.get(tier, 0) + 1
        status_counts[status] = status_counts.get(status, 0) + 1

    print("\n[Check 2] Confidence Distribution:")
    for t in ["High", "Medium", "Low", "Pending"]:
        c = tier_counts.get(t, 0)
        pct = (c / len(field_updates)) * 100
        print(f"  - Tier {t:7s}: {c:2d} ({pct:5.1f}%)")

    # Strict check: Matches must be written back
    assert tier_counts.get("Pending", 0) == 0, (
        f"Found {tier_counts.get('Pending')} updates with 'Pending' confidence level! "
        f"Matching engine writeback has not been executed yet. Run 'python engine/run_supabase_matching.py'."
    )

    matched_total = tier_counts["High"] + tier_counts["Medium"] + tier_counts["Low"]
    assert matched_total == 40, f"Expected High + Medium + Low == 40, got {matched_total}"
    assert tier_counts["High"] > 0, "High confidence count must be greater than 0"
    assert tier_counts["Medium"] > 0, "Medium confidence count must be greater than 0"
    assert tier_counts["Low"] > 0, "Low confidence count must be greater than 0"

    print(f"  [OK] Confirmed: High + Medium + Low = {matched_total} total.")
    print(f"  [OK] Confirmed: Status 'pending' = {status_counts.get('pending', 0)} / 40.")
    print("  [OK] Confirmed: 100% of field updates accounted for (Zero dropped updates).")

    # 5. Show 5 Representative Database Records
    print("\n" + "=" * 70)
    print("[Check 3] Five Representative Database Records (field_updates):")
    print("=" * 70)

    # Pick 2 High, 2 Medium, 1 Low
    selected = []
    for tier in ["High", "High", "Medium", "Medium", "Low"]:
        for u in field_updates:
            if u.get("confidence_level") == tier and u not in selected:
                selected.append(u)
                break

    for idx, row in enumerate(selected, start=1):
        print(f"\nRecord #{idx}:")
        print(f"  Update ID       : {row.get('update_id')}")
        print(f"  Source Type     : {row.get('source_type')}")
        print(f"  Field Text      : \"{row.get('field_text')}\"")
        print(f"  Matched Task ID : {row.get('matched_activity_id')}")
        print(f"  Confidence Score: {row.get('confidence_score')}")
        print(f"  Confidence Level: {row.get('confidence_level')}")
        print(f"  Matched Layer   : {row.get('matched_layer')}")
        print(f"  Status          : {row.get('status')}")
        top3 = row.get("candidate_matches", [])
        if top3:
            print(f"  Top Candidate   : [{top3[0].get('activity_id')}] {top3[0].get('activity_name')}")

    print("\n" + "=" * 70)
    print("All Database Verification Checks Passed Successfully!")
    print("=" * 70)


if __name__ == "__main__":
    verify_database_state()
