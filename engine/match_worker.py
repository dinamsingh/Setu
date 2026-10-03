"""Background Matching Worker for SETU.

Processes selected-target proposals first, material clarification revisions next,
then new pending reports, using revision-bound server CAS writeback.
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
)
from engine.alias_expander import DomainAliasExpander
from engine.ensemble_matcher import EnsembleMatcher
from engine.workflow_processing import process_report, process_proposal, processing_intent


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


def match_single_update(
    matcher: EnsembleMatcher,
    db_client: Any,
    rep: Dict,
    all_reports: Optional[List[Dict]] = None
) -> Dict:
    """Compatibility entry point; all deployed-worker writes now use server CAS."""
    rounds = db_client.table("field_update_clarifications").select("*").execute().data
    proposals = db_client.table("field_update_remap_proposals").select("*").execute().data
    return process_report(matcher, db_client, rep, all_reports or [], rounds, proposals)


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

    if client is not None:
        db_client = client
    else:
        # The matching worker is a server-side process and must bypass RLS via
        # the service-role credential. get_supabase_client() fails fast if it
        # is missing rather than silently using the browser anon key.
        db_client = get_supabase_client(require_remote=True)
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
            rounds = db_client.table("field_update_clarifications").select("*").execute().data
            proposals = db_client.table("field_update_remap_proposals").select("*").execute().data
            by_id = {r["id"]: r for r in all_updates}
            for proposal in proposals:
                if proposal["status"] != "pending_validation" or proposal["field_update_id"] not in by_id:
                    continue
                try:
                    applied = process_proposal(db_client, proposal, by_id[proposal["field_update_id"]], activities, all_updates, rounds)
                    print(f"[PROPOSAL] {proposal['id']} | {'validated' if applied else 'stale/discarded'}")
                except Exception as exc:
                    print(f"[ERROR] Proposal {proposal['id']}: {exc}", file=sys.stderr)
            unmatched_rows = [r for r in all_updates if processing_intent(r, rounds, proposals)]
            unmatched_rows.sort(key=lambda r: processing_intent(r, rounds, proposals) == "match")

            if unmatched_rows:
                print(f"[WORKER] Found {len(unmatched_rows)} unmatched report(s) to process.")
                for rep in unmatched_rows:
                    try:
                        res = process_report(matcher, db_client, rep, all_updates, rounds, proposals)
                        print(
                            f"[{'APPLIED' if res['applied'] else 'STALE/DISCARDED'}] Report ID: {res['update_id']:12s} | "
                            f"Tier: {res['tier']:6s} | "
                            f"Val: {res.get('validation_status', 'pass'):5s} | "
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
