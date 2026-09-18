"""Background Matching Worker for SETU.

Polls for unmatched field updates (confidence_level 'Pending' or NULL, status 'pending')
and scores them using the existing EnsembleMatcher.
Constructs EnsembleMatcher ONCE at startup to avoid expensive reloading.
Works seamlessly with live Supabase and LocalMockDatabase.
"""

import argparse
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from database.supabase_client import (
    get_supabase_client,
    get_database_mode,
    fetch_schedule_activities,
    fetch_field_updates,
    fetch_verified_domain_aliases,
    update_field_update_match,
)
from engine.alias_expander import DomainAliasExpander
from engine.ensemble_matcher import EnsembleMatcher


def is_unmatched_row(row: Dict) -> bool:
    """
    Determines if a field update row is unmatched and awaiting AI processing:
    status must be 'pending' AND confidence_level must be 'Pending' or None/NULL.
    """
    status = (row.get("status") or "").lower()
    if status != "pending":
        return False
    conf_level = row.get("confidence_level")
    return conf_level is None or str(conf_level).strip().lower() in ("pending", "null", "")


def match_single_update(matcher: EnsembleMatcher, db_client: Any, rep: Dict) -> Dict:
    """Matches a single report and writes back results without altering review status."""
    match_res = matcher.match_single_report(rep, top_k=3)
    tier = match_res["confidence_level"]
    matched_act_id = match_res["matched_activity_id"] if tier in ("High", "Medium") else None

    update_payload = {
        "expanded_text": match_res["expanded_text"],
        "matched_activity_id": matched_act_id,
        "confidence_score": match_res["confidence_score"],
        "confidence_level": tier,
        "matched_layer": match_res["matched_layer"],
        "candidate_matches": match_res["candidate_matches"],
    }
    update_field_update_match(db_client, rep["update_id"], update_payload)
    return {
        "update_id": rep["update_id"],
        "tier": tier,
        "matched_activity_id": matched_act_id,
        "confidence_score": match_res["confidence_score"],
    }


def run_worker(
    interval: float = 5.0,
    once: bool = False,
    verbose: bool = False,
    client: Optional[Any] = None
):
    """
    Runs the polling matching worker loop.
    Precomputes and caches EnsembleMatcher ONCE at startup.
    """
    print("=" * 70)
    print("SETU - Live Field Updates Matching Worker")
    print("=" * 70)

    db_client = client or get_supabase_client()
    print(f"Database Mode: {get_database_mode()}")

    # Preload schedule activities and verified domain aliases, construct EnsembleMatcher ONCE at startup
    print("Loading schedule activities and initializing EnsembleMatcher (one-time setup)...")
    activities = fetch_schedule_activities(db_client)
    if not activities:
        raise ValueError(
            "No schedule activities found in database! Please run database/import_data.py first."
        )
    print(f"Loaded {len(activities)} schedule activities.")

    active_aliases = fetch_verified_domain_aliases(db_client)
    print(f"Loaded {len(active_aliases)} verified domain aliases.")
    active_fingerprint = (
        len(active_aliases),
        tuple(sorted((str(a.get("id")), str(a.get("field_term")), str(a.get("standard_term"))) for a in active_aliases))
    )
    matcher = EnsembleMatcher(
        activities=activities,
        alias_expander=DomainAliasExpander(aliases=active_aliases)
    )
    print("EnsembleMatcher successfully initialized and ready.\n")

    if once:
        print("[WORKER] Running single matching pass (--once)...")
    else:
        print(f"[WORKER] Polling for unmatched reports every {interval:.1f}s. Press Ctrl+C to stop.\n")

    try:
        while True:
            # Hot-reload check: cheaply verify if verified aliases set has changed
            current_aliases = fetch_verified_domain_aliases(db_client)
            current_fingerprint = (
                len(current_aliases),
                tuple(sorted((str(a.get("id")), str(a.get("field_term")), str(a.get("standard_term"))) for a in current_aliases))
            )
            if current_fingerprint != active_fingerprint:
                matcher.reload_aliases(current_aliases)
                print(f"[WORKER] Hot-reloaded domain aliases ({len(current_aliases)} active verified aliases).")
                active_fingerprint = current_fingerprint

            # Query updates
            all_updates = fetch_field_updates(db_client)
            unmatched_rows = [r for r in all_updates if is_unmatched_row(r)]

            if unmatched_rows:
                print(f"[WORKER] Found {len(unmatched_rows)} unmatched report(s) to process.")
                for rep in unmatched_rows:
                    try:
                        res = match_single_update(matcher, db_client, rep)
                        print(
                            f"[MATCHED] Report ID: {res['update_id']:12s} | "
                            f"Tier: {res['tier']:6s} | "
                            f"Matched Act: {str(res['matched_activity_id'] or 'NULL'):15s} | "
                            f"Score: {res['confidence_score']:.4f}"
                        )
                    except Exception as exc:
                        print(
                            f"[ERROR] Failed to process report {rep.get('update_id', 'UNKNOWN')}: {exc}",
                            file=sys.stderr
                        )
            elif verbose:
                print(f"[POLL] No unmatched reports found. Waiting {interval:.1f}s...")

            if once:
                print("[WORKER] Single pass completed.")
                break

            time.sleep(interval)

    except KeyboardInterrupt:
        print("\n[SHUTDOWN] Matching worker received interrupt signal. Shutting down cleanly.")


def main():
    parser = argparse.ArgumentParser(description="SETU Live Field Updates Matching Worker")
    parser.add_argument(
        "--interval",
        type=float,
        default=5.0,
        help="Polling interval in seconds (default: 5.0)"
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run a single matching pass and exit"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose polling logs even when idle"
    )
    args = parser.parse_args()
    run_worker(interval=args.interval, once=args.once, verbose=args.verbose)


if __name__ == "__main__":
    main()
