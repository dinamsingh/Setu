"""State/transaction model tests; SQL grants and concurrency need PostgreSQL QA."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier

import pytest

from database.supabase_client import LocalMockDatabase


@pytest.fixture
def db(tmp_path):
    client = LocalMockDatabase(tmp_path / "workflow.json")
    client.tables["user_roles"] = [{"user_id": role, "role": role} for role in ("planner", "admin", "site", "engineer")]
    client.tables["user_roles"].append({"user_id": "other-site", "role": "site"})
    client.tables["schedule_activities"] = [{"activity_id": "ACT-A"}, {"activity_id": "ACT-B"}]
    client.tables["field_updates"] = [{
        "id": "report", "update_id": "UPD-TEST", "status": "pending", "submitted_by_user_id": "site",
        "field_text": "Original evidence", "reported_date": "2026-10-03", "site_location": "Area A",
        "reported_by": "Display label", "source_type": "manual_text", "matched_activity_id": "ACT-A",
        "confidence_level": "High", "validation_status": "pass", "validation_results": [{"outcome": "pass"}],
    }]
    client.save()
    return client


def call(db, name, actor="planner", **params):
    return db.rpc(name, params, actor_user_id=actor).execute().data[0]


def report(db):
    return deepcopy(db.table("field_updates").select().execute().data[0])


def request(db, **params):
    return call(db, "request_field_update_clarification", p_field_update_id="report", p_question="Confirm area?", **params)


def direct(db, impact="confirm_only", **params):
    return call(db, "resolve_field_update_clarification_now", p_field_update_id="report",
                p_question="Confirm area?", p_communication_method="phone", p_response="Area confirmed",
                p_supplied_by="Original supervisor", p_impact=impact, **params)


@pytest.mark.parametrize("actor", ["planner", "admin"])
def test_planner_requests_round_and_audit_with_authoritative_recipient(db, actor):
    child = request(db, actor=actor)
    assert child["mode"] == "request_response" and child["status"] == "open"
    assert child["recipient_user_id"] == "site" and child["requested_by_user_id"] == actor
    assert report(db)["workflow_revision"] == 1
    log = db.table("planner_audit_logs").select().execute().data[0]
    assert log["actor_user_id"] == actor and log["metadata"]["clarification_id"] == child["id"]


@pytest.mark.parametrize("actor", [None, "site", "engineer", "unknown"])
def test_request_authorization(db, actor):
    with pytest.raises(PermissionError):
        request(db, actor=actor)
    assert report(db)["workflow_revision"] == 0


def test_blank_question_rejected_without_workflow_change(db):
    with pytest.raises(ValueError, match="non-empty clarification question"):
        call(db, "request_field_update_clarification", p_field_update_id="report", p_question="  ")
    assert report(db)["workflow_revision"] == 0


@pytest.mark.parametrize("key", ["p_question", "p_communication_method", "p_response", "p_supplied_by"])
def test_resolve_now_requires_direct_contact_details(db, key):
    params = {"p_field_update_id": "report", "p_question": "Question", "p_communication_method": "phone",
              "p_response": "Answer", "p_supplied_by": "Supervisor", "p_impact": "confirm_only"}
    params[key] = "  "
    with pytest.raises(ValueError, match="non-empty"):
        call(db, "resolve_field_update_clarification_now", **params)
    assert report(db)["workflow_revision"] == 0


def test_null_submitter_does_not_route_by_display_label(db):
    db.table("field_updates").update({"submitted_by_user_id": None}).eq("id", "report").execute()
    with pytest.raises(ValueError, match="Original submitter"):
        request(db)
    assert direct(db)["status"] == "resolved"


def test_wrong_user_cannot_respond_original_recipient_can_once(db):
    child = request(db)
    with pytest.raises(PermissionError):
        call(db, "respond_to_field_update_clarification", actor="other-site", p_clarification_id=child["id"], p_response="Correction")
    result = call(db, "respond_to_field_update_clarification", actor="site", p_clarification_id=child["id"], p_response="Area A")
    assert result["status"] == "responded" and result["responded_by_user_id"] == "site"
    assert report(db)["workflow_revision"] == 2
    with pytest.raises(ValueError, match="not open"):
        call(db, "respond_to_field_update_clarification", actor="site", p_clarification_id=child["id"], p_response="Second response")
    with pytest.raises(ValueError, match="active clarification"):
        request(db)
    assert len(db.table("planner_audit_logs").select().execute().data) == 2


def test_engineer_original_recipient_can_respond(db):
    db.table("field_updates").update({"submitted_by_user_id": "engineer"}).eq("id", "report").execute()
    child = request(db)
    result = call(db, "respond_to_field_update_clarification", actor="engineer", p_clarification_id=child["id"], p_response="Confirmed")
    assert result["responded_by_user_id"] == "engineer"


def test_blank_response_rolls_back(db):
    child = request(db)
    with pytest.raises(ValueError, match="non-empty"):
        call(db, "respond_to_field_update_clarification", actor="site", p_clarification_id=child["id"], p_response="  ")
    assert report(db)["workflow_revision"] == 1
    assert db.table("field_update_clarifications").select().execute().data[0]["status"] == "open"


@pytest.mark.parametrize("impact,expected", [("confirm_only", 0), ("validation_inputs_changed", 1), ("mapping_inputs_changed", 1)])
def test_resolve_now_keeps_original_evidence_history_and_explicit_impact(db, impact, expected):
    before = report(db)
    child = direct(db, impact)
    after = report(db)
    assert child["status"] == "resolved" and child["resolved_by_user_id"] == "planner"
    assert child["communication_method"] == "phone" and child["supplied_by"] == "Original supervisor"
    assert child["resolved_evidence_revision"] == after["evidence_revision"] == expected
    assert after["workflow_revision"] == 1 and after["confidence_level"] == "High"
    for key in ("field_text", "reported_date", "site_location", "reported_by", "source_type", "submitted_by_user_id"):
        assert after[key] == before[key]
    if expected:
        assert after["validation_status"] is None and after["validation_results"] == []
        assert after["validation_evidence_revision"] == 0
        with pytest.raises(ValueError, match="validation refresh"):
            call(db, "review_field_update", p_field_update_id="report", p_action="accept")
        with pytest.raises(ValueError, match="validation refresh"):
            call(db, "requeue_field_update", p_field_update_id="report")
    else:
        assert call(db, "review_field_update", p_field_update_id="report", p_action="accept")["status"] == "approved"


def test_multiple_resolved_rounds_preserved_and_unknown_impact_rejected(db):
    first = direct(db)
    second = direct(db)
    assert first["id"] != second["id"]
    with pytest.raises(ValueError, match="explicit supported"):
        direct(db, "guess_from_text")
    assert report(db)["workflow_revision"] == 2
    assert len(db.table("field_update_clarifications").select().execute().data) == 2


@pytest.mark.parametrize("impact", ["confirm_only", "validation_inputs_changed", "mapping_inputs_changed"])
def test_planner_triage_resolves_response_once(db, impact):
    child = request(db)
    with pytest.raises(ValueError, match="responded clarification"):
        call(db, "triage_field_update_clarification", p_clarification_id=child["id"], p_impact=impact)
    call(db, "respond_to_field_update_clarification", actor="site", p_clarification_id=child["id"], p_response="Correction")
    result = call(db, "triage_field_update_clarification", p_clarification_id=child["id"], p_impact=impact, p_note="Reviewed with supervisor")
    assert result["status"] == "resolved" and result["response"] == "Correction"
    assert result["triage_note"] == "Reviewed with supervisor"
    assert report(db)["workflow_revision"] == 3
    assert report(db)["evidence_revision"] == (0 if impact == "confirm_only" else 1)
    with pytest.raises(ValueError, match="responded clarification"):
        call(db, "triage_field_update_clarification", p_clarification_id=child["id"], p_impact=impact)


@pytest.mark.parametrize("responded", [False, True])
@pytest.mark.parametrize("name,params", [
    ("review_field_update", {"p_action": "accept"}),
    ("review_field_update", {"p_action": "remap", "p_target_activity_id": "ACT-B"}),
    ("review_field_update", {"p_action": "reject"}),
    ("requeue_field_update", {}),
    ("override_field_update_validation", {"p_reason": "Planner justification"}),
])
def test_legacy_governance_locked_while_clarification_unresolved(db, responded, name, params):
    child = request(db)
    if responded:
        call(db, "respond_to_field_update_clarification", actor="site", p_clarification_id=child["id"], p_response="Confirmed")
    with pytest.raises(ValueError, match="active clarification"):
        call(db, name, p_field_update_id="report", **params)
    assert report(db)["status"] == "pending"


@pytest.mark.parametrize("status", ["pending_validation", "validated", "blocked"])
def test_active_proposal_guards_and_close_cancels_atomically(db, status):
    db.table("field_update_remap_proposals").insert({"id": "proposal", "field_update_id": "report", "status": status}).execute()
    for name, params in [("request_field_update_clarification", {"p_question": "Which area?"}),
                         ("review_field_update", {"p_action": "accept"}), ("requeue_field_update", {})]:
        with pytest.raises(ValueError, match="Active remap proposal"):
            call(db, name, p_field_update_id="report", **params)
    call(db, "close_field_update_as_invalid", p_field_update_id="report", p_reason="Wrong context")
    assert db.table("field_update_remap_proposals").select().execute().data[0]["status"] == "cancelled"
    assert db.table("planner_audit_logs").select().execute().data[0]["metadata"]["cancelled_remap_proposal_ids"] == ["proposal"]


@pytest.mark.parametrize("reason", ["", "  ", None])
def test_close_invalid_reason_mandatory(db, reason):
    request(db)
    with pytest.raises(ValueError, match="invalid-close reason"):
        call(db, "close_field_update_as_invalid", p_field_update_id="report", p_reason=reason)
    assert report(db)["status"] == "pending"
    assert db.table("field_update_clarifications").select().execute().data[0]["status"] == "open"


@pytest.mark.parametrize("responded", [False, True])
def test_close_invalid_preserves_report_and_cancels_round_with_audit(db, responded):
    child = request(db)
    if responded:
        call(db, "respond_to_field_update_clarification", actor="site", p_clarification_id=child["id"], p_response="Confirmed")
    before = report(db)
    result = call(db, "close_field_update_as_invalid", p_field_update_id="report", p_reason="  Duplicate  ")
    assert result["status"] == "rejected" and result["planner_remarks"] == "Duplicate"
    assert result["workflow_revision"] == before["workflow_revision"] + 1
    assert result["field_text"] == before["field_text"]
    history = db.table("field_update_clarifications").select().execute().data[0]
    assert history["status"] == "cancelled" and history["cancellation_reason"] == "Duplicate"
    log = db.table("planner_audit_logs").select().execute().data[-1]
    assert log["action"] == "reject" and log["new_activity_id"] is None
    assert log["metadata"]["decision"] == "close_as_invalid"
    assert log["metadata"]["cancelled_clarification_ids"] == [child["id"]]


def test_save_failure_rolls_back_close_cancellation_and_audit(db, monkeypatch):
    request(db)
    original = deepcopy(db.tables)
    def fail_save():
        raise OSError("simulated persistence failure")
    monkeypatch.setattr(db, "save", fail_save)
    with pytest.raises(OSError, match="simulated"):
        call(db, "close_field_update_as_invalid", p_field_update_id="report", p_reason="Duplicate")
    assert db.tables == original


@pytest.mark.parametrize("status", ["approved", "remapped", "rejected"])
def test_finalized_reports_cannot_enter_workflow(db, status):
    db.table("field_updates").update({"status": status}).eq("id", "report").execute()
    for action in (lambda: request(db), lambda: direct(db),
                   lambda: call(db, "close_field_update_as_invalid", p_field_update_id="report", p_reason="Duplicate"),
                   lambda: call(db, "requeue_field_update", p_field_update_id="report")):
        with pytest.raises(ValueError, match="finalized"):
            action()


def test_legacy_rpc_signatures_remain_callable_and_override_requeue_scope(db):
    db.table("field_updates").update({"validation_status": "block"}).eq("id", "report").execute()
    override = call(db, "override_field_update_validation", p_field_update_id="report", p_reason="Verified by planner")
    assert override["override_evidence_revision"] == 0 and override["override_activity_id"] == "ACT-A"
    result = call(db, "requeue_field_update", p_field_update_id="report")
    assert result["workflow_revision"] == 2 and result["validation_overridden"] is False
    assert result["validation_status"] is None and result["validation_results"] == []
    for key in ("matched_activity_id", "override_reason", "override_by", "override_at", "override_evidence_revision", "override_activity_id"):
        assert result[key] is None
    log = db.table("planner_audit_logs").select().execute().data[-1]
    assert log["previous_activity_id"] == "ACT-A" and log["new_activity_id"] is None


def test_legacy_remap_still_terminal_but_override_does_not_transfer(db):
    db.table("field_updates").update({"validation_status": "block"}).eq("id", "report").execute()
    call(db, "override_field_update_validation", p_field_update_id="report", p_reason="Verified")
    result = call(db, "review_field_update", p_field_update_id="report", p_action="remap", p_target_activity_id="ACT-B")
    assert result["status"] == "remapped" and result["matched_activity_id"] == "ACT-B"
    assert result["validation_overridden"] is False and result["override_activity_id"] is None


@pytest.mark.parametrize("action", ["accept", "remap"])
@pytest.mark.parametrize("validation_status", [None, "unsupported", ""])
def test_finalization_requires_completed_validation(db, action, validation_status):
    db.table("field_updates").update({"validation_status": validation_status}).eq("id", "report").execute()
    before = report(db)
    with pytest.raises(ValueError, match="Current validation must complete before approval or remap"):
        call(db, "review_field_update", p_field_update_id="report", p_action=action, p_target_activity_id="ACT-B")
    assert report(db) == before
    assert db.table("planner_audit_logs").select().execute().data == []


@pytest.mark.parametrize("validation_status", ["pass", "warn"])
def test_accept_with_completed_current_validation(db, validation_status):
    db.table("field_updates").update({"validation_status": validation_status}).eq("id", "report").execute()
    result = call(db, "review_field_update", p_field_update_id="report", p_action="accept")
    assert result["status"] == "approved" and result["matched_activity_id"] == "ACT-A"


@pytest.mark.parametrize("action", ["accept", "remap"])
@pytest.mark.parametrize("scope", ["no_override", "stale_evidence", "wrong_activity", "current"])
def test_block_requires_current_evidence_and_activity_override(db, action, scope):
    db.table("field_updates").update({"validation_status": "block"}).eq("id", "report").execute()
    if scope != "no_override":
        call(db, "override_field_update_validation", p_field_update_id="report", p_reason="Verified by planner")
        changes = {"stale_evidence": {"override_evidence_revision": 1},
                   "wrong_activity": {"override_activity_id": "ACT-B"}, "current": {}}[scope]
        db.table("field_updates").update(changes).eq("id", "report").execute()
    if scope == "current":
        result = call(db, "review_field_update", p_field_update_id="report", p_action=action, p_target_activity_id="ACT-B")
        assert result["status"] == ("approved" if action == "accept" else "remapped")
    else:
        with pytest.raises(ValueError, match="current scoped override"):
            call(db, "review_field_update", p_field_update_id="report", p_action=action, p_target_activity_id="ACT-B")
        assert report(db)["status"] == "pending"


@pytest.mark.parametrize("action", ["accept", "remap"])
def test_completed_but_stale_validation_still_cannot_finalize(db, action):
    db.table("field_updates").update({"evidence_revision": 1, "validation_evidence_revision": 0,
                                      "validation_status": "pass"}).eq("id", "report").execute()
    with pytest.raises(ValueError, match="validation refresh"):
        call(db, "review_field_update", p_field_update_id="report", p_action=action, p_target_activity_id="ACT-B")
    assert report(db)["status"] == "pending"


def test_requeued_report_requires_worker_validation_before_accept(db):
    call(db, "requeue_field_update", p_field_update_id="report")
    requeued = report(db)
    assert requeued["validation_status"] is None and requeued["validation_results"] == []
    assert requeued["validation_evidence_revision"] == requeued["evidence_revision"]
    with pytest.raises(ValueError, match="Current validation must complete"):
        call(db, "review_field_update", p_field_update_id="report", p_action="accept")
    # A link alone must not make a requeued report approvable.
    db.table("field_updates").update({"matched_activity_id": "ACT-A"}).eq("id", "report").execute()
    with pytest.raises(ValueError, match="Current validation must complete"):
        call(db, "review_field_update", p_field_update_id="report", p_action="accept")
    # Represent normal worker completion without changing worker code.
    db.table("field_updates").update({"validation_status": "pass", "validation_results": [{"outcome": "pass"}],
                                      "confidence_level": "High"}).eq("id", "report").execute()
    assert call(db, "review_field_update", p_field_update_id="report", p_action="accept")["status"] == "approved"


def test_material_clarification_clears_old_override_without_automatic_matching(db):
    db.table("field_updates").update({"validation_status": "block"}).eq("id", "report").execute()
    call(db, "override_field_update_validation", p_field_update_id="report", p_reason="Verified")
    direct(db, "mapping_inputs_changed")
    result = report(db)
    assert result["validation_overridden"] is False and result["override_evidence_revision"] is None
    assert result["matched_activity_id"] == "ACT-A" and result["confidence_level"] == "High"


def test_expected_revision_rejects_stale_work(db):
    direct(db, p_expected_workflow_revision=0)
    with pytest.raises(ValueError, match="Workflow changed"):
        request(db, p_expected_workflow_revision=0)
    assert report(db)["workflow_revision"] == 1


def test_concurrent_requests_only_one_round_and_one_audit(db):
    barrier = Barrier(2)
    def attempt():
        barrier.wait()
        try:
            return request(db)["status"]
        except ValueError as error:
            return str(error)
    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: attempt(), range(2)))
    assert outcomes.count("open") == 1
    assert len(db.table("field_update_clarifications").select().execute().data) == 1
    assert len(db.table("planner_audit_logs").select().execute().data) == 1


def test_concurrent_field_response_and_close_cannot_resurrect_report(db):
    child = request(db)
    barrier = Barrier(2)
    def respond():
        barrier.wait()
        try:
            return call(db, "respond_to_field_update_clarification", actor="site", p_clarification_id=child["id"], p_response="Confirmed")
        except ValueError:
            return None
    def close():
        barrier.wait()
        return call(db, "close_field_update_as_invalid", p_field_update_id="report", p_reason="Duplicate")
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(respond), pool.submit(close)]
        for future in futures:
            future.result()
    assert report(db)["status"] == "rejected"
    assert db.table("field_update_clarifications").select().execute().data[0]["status"] == "cancelled"
