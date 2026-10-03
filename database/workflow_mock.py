"""Deterministic local model of migration 008 RPC transactions.

This tests state, authorization and rollback semantics. It does not execute SQL,
enforce PostgreSQL grants/RLS, or emulate independent database connections.
There is deliberately no manual-target validation or effective-evidence worker.
"""

from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4


IMPACTS = {"confirm_only", "validation_inputs_changed", "mapping_inputs_changed"}
ACTIVE_PROPOSALS = {"pending_validation", "validated", "blocked"}
RPC_NAMES = {
    "request_field_update_clarification", "respond_to_field_update_clarification",
    "resolve_field_update_clarification_now", "triage_field_update_clarification",
    "close_field_update_as_invalid", "review_field_update",
    "override_field_update_validation", "requeue_field_update",
}


class LocalWorkflowRPC:
    def __init__(self, db, name, params, actor):
        self.db, self.name, self.params, self.actor = db, name, dict(params), actor

    def execute(self):
        from database.supabase_client import LocalMockResponse
        if self.name not in RPC_NAMES:
            raise ValueError("Unsupported local workflow RPC")
        with self.db._workflow_lock:
            self.db.load()
            original = deepcopy(self.db.tables)
            tables = deepcopy(original)
            result = self._apply(tables)
            self.db.tables = tables
            try:
                self.db.save()
            except Exception:
                self.db.tables = original
                raise
            return LocalMockResponse([deepcopy(result)])

    def _apply(self, tables):
        if not self.actor:
            raise PermissionError("Authentication is required")
        role = next((r["role"] for r in tables.get("user_roles", []) if r["user_id"] == self.actor), None)
        field_response = self.name == "respond_to_field_update_clarification"
        if role not in ({"site", "engineer"} if field_response else {"planner", "admin"}):
            raise PermissionError("Site or engineer role is required" if field_response else "Planner or administrator role is required")
        rounds = tables.setdefault("field_update_clarifications", [])
        proposals = tables.setdefault("field_update_remap_proposals", [])
        logs = tables.setdefault("planner_audit_logs", [])
        p = self.params
        child = None
        if "p_clarification_id" in p:
            child = next((c for c in rounds if c["id"] == p["p_clarification_id"]), None)
            if child is None or (field_response and child.get("recipient_user_id") != self.actor):
                raise PermissionError("Clarification is unavailable to this submitter")
        report_id = child["field_update_id"] if child else p.get("p_field_update_id")
        report = next((r for r in tables.get("field_updates", []) if r["id"] == report_id), None)
        if report is None:
            raise ValueError("Field update is unavailable")
        if report.get("status") != "pending":
            raise ValueError("Field update is already finalized")
        expected = p.get("p_expected_workflow_revision")
        if expected is not None and expected != report["workflow_revision"]:
            raise ValueError("Workflow changed; refresh before acting")
        active_rounds = [c for c in rounds if c["field_update_id"] == report_id and c["status"] in {"open", "responded"}]
        active_proposals = [r for r in proposals if r["field_update_id"] == report_id and r["status"] in ACTIVE_PROPOSALS]
        closing = self.name == "close_field_update_as_invalid"
        triaging = self.name == "triage_field_update_clarification"
        if active_rounds and not (closing or triaging or field_response):
            raise ValueError("Resolve active clarification before this action")
        if active_proposals and not (closing or field_response):
            raise ValueError("Active remap proposal conflicts with this action")
        now = datetime.now(timezone.utc).isoformat()
        previous_activity = report.get("matched_activity_id")

        def bump():
            report["workflow_revision"] += 1
            report["updated_at"] = now

        def audit(action, remarks, metadata=None, new_activity=previous_activity):
            logs.append({
                "id": str(uuid4()), "field_update_id": report_id, "action": action,
                "previous_activity_id": previous_activity, "new_activity_id": new_activity,
                "actor_user_id": self.actor,
                "planner_name": {"planner": "Authenticated Planner", "admin": "Authenticated Administrator"}.get(role, "Authenticated Field Submitter"),
                "remarks": remarks, "created_at": now,
                "metadata": {**(metadata or {}), "evidence_revision": report["evidence_revision"], "workflow_revision": report["workflow_revision"]},
            })

        def required(key, label):
            value = (p.get(key) or "").strip()
            if not value:
                raise ValueError(f"A non-empty {label} is required")
            return value

        def apply_impact():
            impact = p.get("p_impact")
            if impact not in IMPACTS:
                raise ValueError("An explicit supported clarification impact is required")
            if impact != "confirm_only":
                report["evidence_revision"] += 1
                report["validation_status"], report["validation_results"] = None, []
                clear_override()
            bump()
            return impact

        def clear_override():
            report["validation_overridden"] = False
            for key in ("override_reason", "override_by", "override_at", "override_evidence_revision", "override_activity_id"):
                report[key] = None

        def fresh_validation():
            if report["validation_evidence_revision"] != report["evidence_revision"]:
                raise ValueError("Clarified evidence requires validation refresh")

        def valid_scope():
            return (report.get("validation_overridden") is True
                    and report.get("override_evidence_revision") == report["evidence_revision"]
                    and report.get("override_activity_id") == report.get("matched_activity_id"))

        if self.name == "request_field_update_clarification":
            question = required("p_question", "clarification question")
            if not report.get("submitted_by_user_id"):
                raise ValueError("Original submitter is unavailable; use direct clarification")
            bump()
            child = {
                "id": str(uuid4()), "field_update_id": report_id, "mode": "request_response",
                "recipient_user_id": report["submitted_by_user_id"], "question": question,
                "requested_by_user_id": self.actor, "status": "open",
                "evidence_revision": report["evidence_revision"], "workflow_revision": report["workflow_revision"],
                "created_at": now, "response": None,
            }
            rounds.append(child)
            audit("clarification_requested", question, {"clarification_id": child["id"], "mode": child["mode"], "recipient_user_id": child["recipient_user_id"]})
            return child
        if field_response:
            if report.get("submitted_by_user_id") != self.actor:
                raise PermissionError("Only the original addressed submitter may respond")
            if child["mode"] != "request_response" or child["status"] != "open":
                raise ValueError("Clarification is not open for a response")
            response = required("p_response", "clarification response")
            child.update(response=response, status="responded", responded_by_user_id=self.actor,
                         supplied_by="Authenticated Field Submitter", communication_method="field_response", responded_at=now)
            bump()
            audit("clarification_responded", response, {"clarification_id": child["id"]})
            return child
        if self.name == "resolve_field_update_clarification_now":
            values = {key: required("p_" + key, key) for key in ("question", "communication_method", "response", "supplied_by")}
            previous_revision = report["evidence_revision"]
            impact = apply_impact()
            child = {
                "id": str(uuid4()), "field_update_id": report_id, "mode": "resolve_now",
                "recipient_user_id": report.get("submitted_by_user_id"), **values,
                "requested_by_user_id": self.actor, "resolved_by_user_id": self.actor,
                "status": "resolved", "triage_impact": impact, "created_at": now, "resolved_at": now,
                "evidence_revision": previous_revision, "workflow_revision": report["workflow_revision"],
                "resolved_evidence_revision": report["evidence_revision"],
            }
            rounds.append(child)
            audit("clarification_resolved", child["response"], {"clarification_id": child["id"], "mode": child["mode"], "impact": impact, "previous_evidence_revision": previous_revision})
            return child
        if triaging:
            if child["mode"] != "request_response" or child["status"] != "responded":
                raise ValueError("Only a responded clarification may be triaged")
            previous_revision = report["evidence_revision"]
            impact = apply_impact()
            child.update(status="resolved", triage_impact=impact, triage_note=(p.get("p_note") or "").strip() or None,
                         resolved_by_user_id=self.actor, resolved_at=now, resolved_evidence_revision=report["evidence_revision"])
            audit("clarification_resolved", child["triage_note"] or child["response"], {"clarification_id": child["id"], "mode": child["mode"], "impact": impact, "previous_evidence_revision": previous_revision})
            return child
        if closing:
            reason = required("p_reason", "invalid-close reason")
            for row in active_rounds + active_proposals:
                row.update(status="cancelled", cancelled_at=now, cancelled_by_user_id=self.actor, cancellation_reason=reason)
            report.update(status="rejected", planner_remarks=reason)
            bump()
            audit("reject", reason, {"decision": "close_as_invalid", "cancelled_clarification_ids": [c["id"] for c in active_rounds], "cancelled_remap_proposal_ids": [r["id"] for r in active_proposals]}, new_activity=None)
            return report
        if self.name == "review_field_update":
            action = (p.get("p_action") or "").strip().lower()
            if action not in {"accept", "reject", "remap"}:
                raise ValueError("Unsupported planner decision")
            if action in {"accept", "remap"}:
                fresh_validation()
                if report.get("validation_status") not in {"pass", "warn", "block"}:
                    raise ValueError("Current validation must complete before approval or remap")
                if report.get("validation_status") == "block" and not valid_scope():
                    raise ValueError("Blocked validation requires a current scoped override")
            target = None
            if action in {"accept", "remap"}:
                target = previous_activity if action == "accept" else required("p_target_activity_id", "target schedule activity")
                if target is None:
                    raise ValueError("Approval requires a linked schedule activity")
                if not any(a["activity_id"] == target for a in tables.get("schedule_activities", [])):
                    raise ValueError("Target schedule activity does not exist")
            report["status"] = {"accept": "approved", "reject": "rejected", "remap": "remapped"}[action]
            if action == "remap":
                report["matched_activity_id"] = target
                if target != previous_activity:
                    clear_override()
            report["planner_remarks"] = (p.get("p_remarks") or "").strip() or None
            bump()
            audit(action, report["planner_remarks"], {"legacy_terminal_remap": action == "remap"}, new_activity=target)
            return report
        if self.name == "override_field_update_validation":
            reason = required("p_reason", "override reason")
            fresh_validation()
            if report.get("validation_status") != "block":
                raise ValueError("Only blocked validation may be overridden")
            if report.get("validation_overridden"):
                raise ValueError("Validation block is already overridden")
            report.update(validation_overridden=True, override_reason=reason,
                          override_by="Authenticated Administrator" if role == "admin" else "Authenticated Planner", override_at=now,
                          override_evidence_revision=report["evidence_revision"], override_activity_id=previous_activity)
            bump()
            audit("override", "Validation Override: " + reason, {"override_evidence_revision": report["evidence_revision"], "override_activity_id": previous_activity})
            return report
        fresh_validation()
        report.update(confidence_level="Pending", confidence_score=0, matched_activity_id=None,
                      matched_layer=None, candidate_matches=[], expanded_text=None,
                      validation_status=None, validation_results=[])
        clear_override()
        bump()
        audit("requeue", (p.get("p_remarks") or "").strip() or "Re-queued for re-matching with updated domain dictionary.", new_activity=None)
        return report
