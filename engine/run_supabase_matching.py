"""Database Matching Integration for SETU.

Reads pending field reports from Supabase, executes the existing Phase 2
EnsembleMatcher without rewriting scoring logic, and writes back match results
to the database without modifying planner review status.
"""

import argparse
import sys
from pathlib import Path
from typing import Any, Optional

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from database.supabase_client import (
    get_supabase_client,
    fetch_schedule_activities,
    fetch_field_updates,
    fetch_verified_domain_aliases,
    update_field_update_match,
    get_table_counts
)
from engine.alias_expander import DomainAliasExpander
from engine.ensemble_matcher import EnsembleMatcher


def run_supabase_matching(
    client: Optional[Any] = None,
    status_filter: Optional[str] = None,
    force_rematch_all: bool = False
):
    """
    Executes matching on database records and writes back results.
    Never creates audit logs during matching (audit is human-only).
    Never silently drops unmatched updates.
    Never overwrites planner review decisions (approved/rejected/remapped).
    """
    print("=" * 70)
    print("SETU - Supabase Database Matching Pipeline")
    print("=" * 70)

    db_client = client or get_supabase_client()

    # 1. Fetch Schedule Activities from Supabase
    activities = fetch_schedule_activities(db_client)
    if not activities:
        raise ValueError(
            "No schedule activities found in Supabase 'schedule_activities' table! "
            "Please run 'python database/import_data.py' first."
        )
    print(f"Loaded {len(activities)} schedule activities from database.")

    # 2. Fetch Field Updates from Supabase
    if status_filter:
        all_updates = fetch_field_updates(db_client, status=status_filter)
    else:
        all_updates = fetch_field_updates(db_client)

    if not all_updates:
        print("No field updates found in database. Please run 'python database/import_data.py' first.")
        return

    # Filter processable updates
    if force_rematch_all:
        print(
            "\n[WARNING] --force-rematch-all enabled: Reprocessing all records. "
            "Planner review decisions will be preserved, but scores and candidate matches will be recomputed.\n"
        )
        pending_updates = all_updates
        skipped_count = 0
    else:
        pending_updates = []
        skipped_count = 0
        for r in all_updates:
            status = (r.get("status") or "").lower()
            conf_level = r.get("confidence_level")
            # Never include rows whose status is 'approved', 'rejected', or 'remapped'
            if status in ("approved", "rejected", "remapped"):
                skipped_count += 1
                continue
            # Processable if status is 'pending' OR confidence_level is 'Pending'/NULL
            if status == "pending" or conf_level is None or str(conf_level).strip().lower() in ("pending", "null", ""):
                pending_updates.append(r)
            else:
                skipped_count += 1

    print(
        f"Found {len(all_updates)} total records: "
        f"{len(pending_updates)} to match, {skipped_count} skipped (already reviewed)."
    )

    if not pending_updates:
        print("All records have already been reviewed. Nothing to match.")
        print("Use --force-rematch-all to recompute scores for all records while preserving review status.")
        return

    # 3. Initialize Existing EnsembleMatcher with verified database aliases
    verified_aliases = fetch_verified_domain_aliases(db_client)
    print(f"Loaded {len(verified_aliases)} verified domain aliases from database.")
    alias_expander = DomainAliasExpander(aliases=verified_aliases)
    print("Initializing EnsembleMatcher with database activities and verified aliases...")
    matcher = EnsembleMatcher(activities=activities, alias_expander=alias_expander)

    # 4. Execute Matching & Write Back to Supabase
    print("\nExecuting hybrid matching and updating database records...")
    print("-" * 70)
    high_count = 0
    med_count = 0
    low_count = 0

    for rep in pending_updates:
        # Pass each original field_text through the existing Phase 2 matching engine
        match_res = matcher.match_single_report(rep, top_k=3)
        tier = match_res["confidence_level"]

        if tier == "High":
            high_count += 1
            matched_act_id = match_res["matched_activity_id"]
        elif tier == "Medium":
            med_count += 1
            matched_act_id = match_res["matched_activity_id"]
        else:
            low_count += 1
            # For low/no-match records: matched_activity_id can be NULL
            matched_act_id = None

        # Fields to write back into the same field_updates row
        # (Preserves original field_text, does not alter review status)
        update_payload = {
            "expanded_text": match_res["expanded_text"],
            "matched_activity_id": matched_act_id,
            "confidence_score": match_res["confidence_score"],
            "confidence_level": tier,
            "matched_layer": match_res["matched_layer"],
            "candidate_matches": match_res["candidate_matches"],
        }

        update_field_update_match(db_client, rep["update_id"], update_payload)

        # Logging for processed record
        print(
            f"[PROCESSED] Report ID: {rep['update_id']:12s} | "
            f"Tier: {tier:6s} | "
            f"Matched Act: {str(matched_act_id or 'NULL'):15s} | "
            f"Score: {match_res['confidence_score']:.4f} | "
            f"Status: {rep.get('status', 'pending')}"
        )

    # 5. Summary & Verification
    total = len(pending_updates)
    print("\n" + "=" * 70)
    print("SUPABASE MATCHING WRITE-BACK SUMMARY")
    print("=" * 70)
    print(f"Total Records Processed : {total}")
    if total > 0:
        print(f"High Confidence (>=0.82): {high_count:2d}  ({(high_count/total)*100:5.1f}%) -> Fast-Track Review")
        print(f"Medium Confidence      : {med_count:2d}  ({(med_count/total)*100:5.1f}%) -> Planner Review Queue")
        print(f"Low / Unmatched (<0.55) : {low_count:2d}  ({(low_count/total)*100:5.1f}%) -> Flagged for Review (Never Dropped)")
    else:
        print("High Confidence (>=0.82):  0  (  0.0%) -> Fast-Track Review")
        print("Medium Confidence      :  0  (  0.0%) -> Planner Review Queue")
        print("Low / Unmatched (<0.55) :  0  (  0.0%) -> Flagged for Review (Never Dropped)")
    print(f"Skipped (Already Reviewed): {skipped_count:2d}")
    print("Dropped Records         : 0 (Zero records dropped)")
    print("=" * 70)

    counts = get_table_counts(db_client)
    print("\nCurrent Database State:")
    for tbl, cnt in counts.items():
        print(f"  - {tbl:22s}: {cnt:4d} rows")
    print("=" * 70)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SETU Supabase Database Matching Pipeline")
    parser.add_argument(
        "--force-rematch-all",
        action="store_true",
        help="Reprocess every row. Planner review decisions are preserved, but scores/tiers will be recomputed."
    )
    parser.add_argument(
        "--status",
        type=str,
        default=None,
        help="Filter field updates by status before matching."
    )
    args = parser.parse_args()
    run_supabase_matching(status_filter=args.status, force_rematch_all=args.force_rematch_all)
