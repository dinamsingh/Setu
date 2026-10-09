"""Independent evidence-revision extraction; matching and planner state are untouched."""

import re
import sys

from database.supabase_client import LocalMockDatabase
from engine.progress_events import extract_progress_events
from engine.workflow_processing import material_rounds, server_rpc


PROGRESS_EXTRACTION_BATCH_SIZE = 25


def fetch_progress_extraction_batch(client, limit=PROGRESS_EXTRACTION_BATCH_SIZE):
    params = {"p_limit": max(0, min(limit, PROGRESS_EXTRACTION_BATCH_SIZE))}
    query = (client.rpc("list_field_updates_for_progress_extraction", params, server_role=True)
             if isinstance(client, LocalMockDatabase)
             else client.rpc("list_field_updates_for_progress_extraction", params))
    return query.execute().data


def extraction_error_summary(error):
    # Exception messages may contain credentials, request bodies or evidence.
    # Persist/log only the exception class and a safe database error code.
    code = str(getattr(error, "code", ""))
    return type(error).__name__ + (f" ({code})" if re.fullmatch(r"[A-Z0-9_]{1,20}", code) else "")


def progress_extraction_available(client):
    try:
        if not server_rpc(client, "progress_extraction_ready", {}):
            raise RuntimeError("Phase 1 capability unavailable")
        fetch_progress_extraction_batch(client, 0)
        return True
    except Exception as error:
        print("[PROGRESS] Extraction disabled: Phase 1 DB capability unavailable "
              f"({extraction_error_summary(error)}). Apply reviewed migration 010 and restart worker; "
              "matching/validation continues.", file=sys.stderr)
        return False


def process_progress_extraction_batch(client):
    try:
        reports = fetch_progress_extraction_batch(client)
        if not reports:
            return True
        # Read evidence after the bounded parent batch, never from the matching
        # pass's older snapshot. Later revisions are excluded by material_rounds
        # and a concurrent evidence change is still rejected by completion CAS.
        rounds = (client.table("field_update_clarifications").select("*")
                  .in_("field_update_id", [report["id"] for report in reports]).execute().data)
    except Exception as error:
        print(f"[PROGRESS] Extraction disabled: batch query failed ({extraction_error_summary(error)}). "
              "Check Phase 1 DB capability and restart worker; matching/validation continues.", file=sys.stderr)
        return False
    for report in reports:
        try:
            applied = process_progress_extraction(client, report, rounds)
            print(f"[PROGRESS] {report['id']} | {'extracted' if applied else 'stale/discarded'}")
        except Exception as error:
            summary = extraction_error_summary(error)
            try:
                server_rpc(client, "fail_field_update_progress_extraction", {
                    "p_field_update_id": report["id"],
                    "p_evidence_revision": report.get("evidence_revision", 0), "p_error": summary,
                })
            except Exception as retry_error:
                # Without durable writeback, another cycle could hot-loop failures.
                print(f"[PROGRESS] Extraction disabled: retry state could not be saved "
                      f"({extraction_error_summary(retry_error)}). Check DB and restart worker; "
                      "matching/validation continues.", file=sys.stderr)
                return False
            print(f"[PROGRESS] {report['id']} | retry scheduled: {summary}", file=sys.stderr)
    return True


def needs_progress_extraction(report):
    revision = report.get("evidence_revision", 0)
    return report.get("progress_extraction_revision") != revision


def progress_events_for_report(report, rounds):
    # Reuse B2's ordered resolved-material evidence selection. Questions and
    # provenance headers are not field assertions and must not produce events.
    sources = [("Original report", report.get("field_text"))]
    sources.extend((f"Resolved clarification {c['id']} (evidence revision {c['resolved_evidence_revision']})",
                    c.get("response")) for c in material_rounds(report, rounds))
    events, unknowns = [], []
    for provenance, text in sources:
        extracted = extract_progress_events(text, report.get("reported_date"))
        for event in extracted:
            event["extraction_reason"] = f"{provenance}. {event['extraction_reason']}"
            (unknowns if event["event_type"] == "UNKNOWN" else events).append(event)
    if not events:
        events = [{**unknowns[0], "evidence_text": "\n\n".join(str(text or "") for _, text in sources).strip()
                   or "[No usable evidence text]",
                   "extraction_reason": "Original report and resolved material responses preserved; "
                   "Phase 1 rules cannot safely infer an actual progress event."}]
    return [{**event, "event_index": index} for index, event in enumerate(events)]


def process_progress_extraction(client, report, rounds):
    if not needs_progress_extraction(report):
        return None
    events = progress_events_for_report(report, rounds)
    return server_rpc(client, "complete_field_update_progress_extraction", {
        "p_field_update_id": report["id"], "p_evidence_revision": report.get("evidence_revision", 0),
        "p_events": events,
    })
