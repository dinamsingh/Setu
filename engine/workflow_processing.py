"""Revision-bound processing. Original evidence is never written by this module.

Effective text = original field_text followed by material RESOLVED rounds ordered
by (resolved_evidence_revision, created_at, id). Each round contributes a labeled
question/response block. Confirm-only, open, responded and cancelled rounds do
not affect computation. Impact is explicit planner input, never inferred.
"""

from copy import deepcopy

from database.supabase_client import LocalMockDatabase
from engine.validators import validate_report_matching

ACTIVE_PROPOSALS = {"pending_validation", "validated", "blocked"}


def material_rounds(report, rounds):
    return sorted((c for c in rounds
                   if c["field_update_id"] == report["id"] and c["status"] == "resolved"
                   and c.get("triage_impact") in {"validation_inputs_changed", "mapping_inputs_changed"}
                   and c.get("resolved_evidence_revision", 0) <= report.get("evidence_revision", 0)),
                  key=lambda c: (c["resolved_evidence_revision"], c.get("created_at", ""), c["id"]))


def effective_evidence(report, rounds):
    effective = deepcopy(report)
    blocks = [report["field_text"]]
    for c in material_rounds(report, rounds):
        blocks.append(f"[Resolved clarification {c['resolved_evidence_revision']}]\n"
                      f"Question: {c['question']}\nResponse: {c['response']}")
    effective["field_text"] = "\n\n".join(blocks)
    return effective


def processing_intent(report, rounds=(), proposals=()):
    if report.get("status") != "pending":
        return None
    if any(c["field_update_id"] == report["id"] and c["status"] in {"open", "responded"} for c in rounds):
        return None
    if any(p["field_update_id"] == report["id"] and p["status"] in ACTIVE_PROPOSALS for p in proposals):
        return None
    previous = report.get("validation_evidence_revision", 0)
    if report.get("evidence_revision", 0) > previous:
        return "rematch" if any(c["triage_impact"] == "mapping_inputs_changed"
                                and c["resolved_evidence_revision"] > previous
                                for c in material_rounds(report, rounds)) else "revalidate"
    if report.get("confidence_level") in (None, "Pending"):
        return "match"
    if report.get("validation_status") is None:
        return "revalidate"
    return None


def server_rpc(client, name, params):
    # Mock flag is explicitly local-only. Remote identity comes from server JWT.
    response = (client.rpc(name, params, server_role=True) if isinstance(client, LocalMockDatabase)
                else client.rpc(name, params)).execute().data
    return response[0] if isinstance(response, list) else response


def validate_target(report, target, activities, reports, candidates=None, manual=False):
    others = [r for r in (reports or []) if r.get("id") != report.get("id")
              and r.get("update_id") != report.get("update_id")]
    validation = validate_report_matching(report, target, candidates=candidates or [],
                                         all_reports=others, all_activities=activities)
    if manual:
        for check in validation["results"]:
            if check["check"] == "candidate_ambiguity":
                check["message"] = "AI-ranking diagnostic only; not proof of the selected target. " + check["message"]
    return validation


def process_report(matcher, client, report, reports, rounds, proposals):
    intent = processing_intent(report, rounds, proposals)
    if not intent:
        return None
    effective = effective_evidence(report, rounds)
    payload = {}
    if intent == "revalidate":
        target_id = report.get("matched_activity_id")
        candidates = report.get("candidate_matches") or []
    else:
        matched = matcher.match_single_report(effective, top_k=3)
        target_id = matched["matched_activity_id"] if matched["confidence_level"] in {"High", "Medium"} else None
        candidates = matched["candidate_matches"]
        payload = {key: matched[key] for key in ("expanded_text", "matched_layer", "candidate_matches", "confidence_level", "confidence_score")}
        payload["matched_activity_id"] = target_id
    target = next((a for a in matcher.activities if a["activity_id"] == target_id), None)
    validation = validate_target(effective, target, matcher.activities, reports, candidates)
    payload.update(validation_status=validation["status"], validation_results=validation["results"])
    applied = server_rpc(client, "complete_field_update_processing", {
        "p_field_update_id": report["id"], "p_workflow_revision": report.get("workflow_revision", 0),
        "p_evidence_revision": report.get("evidence_revision", 0), "p_intent": intent, "p_result": payload,
    })
    return {"update_id": report["update_id"], "applied": applied, "intent": intent,
            "tier": payload.get("confidence_level", report.get("confidence_level")),
            "confidence_score": payload.get("confidence_score", report.get("confidence_score")) or 0,
            "matched_activity_id": target_id, "validation_status": validation["status"]}


def process_proposal(client, proposal, report, activities, reports, rounds):
    if report["status"] != "pending" or proposal["status"] != "pending_validation":
        return False
    target = next((a for a in activities if a["activity_id"] == proposal["target_activity_id"]), None)
    if target is None:
        raise ValueError("Selected target is unavailable")
    validation = validate_target(effective_evidence(report, rounds), target, activities, reports,
                                 report.get("candidate_matches"), manual=True)
    return server_rpc(client, "complete_field_update_remap_validation", {
        "p_proposal_id": proposal["id"], "p_target_activity_id": proposal["target_activity_id"],
        "p_workflow_revision": report["workflow_revision"], "p_evidence_revision": report["evidence_revision"],
        "p_validation_generation": proposal["validation_generation"],
        "p_result": {"validation_status": validation["status"], "validation_results": validation["results"]},
    })
