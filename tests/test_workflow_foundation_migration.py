"""Static SQL/security contracts for 008; these do not execute PostgreSQL."""

import hashlib
import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "database" / "migrations"
SQL = (MIGRATIONS / "008_workflow_foundation.sql").read_text(encoding="utf-8").lower()
COMPACT = " ".join(SQL.split())
RPC_SIGNATURES = {
    "request_field_update_clarification": "uuid, text, bigint",
    "respond_to_field_update_clarification": "uuid, text, bigint",
    "resolve_field_update_clarification_now": "uuid, text, text, text, text, text, bigint",
    "triage_field_update_clarification": "uuid, text, text, bigint",
    "close_field_update_as_invalid": "uuid, text, bigint",
    "review_field_update": "uuid, text, text, text",
    "override_field_update_validation": "uuid, text",
    "requeue_field_update": "uuid, text",
}


def body(name):
    match = re.search(rf"create (?:or replace )?function public\.{name}\(.*?as \$\$(.*?)\$\$;", SQL, re.S)
    assert match, name
    return match.group(1)


@pytest.mark.parametrize("filename,digest", [
    ("006_transactional_planner_governance.sql", "742113130d51c605929400f3a98d385d152b31d31c99aa4e64cfa90eacf8df01"),
    ("007_security_hardening.sql", "93225ceabeec8dd5528bfd0ae38f585aefaa5b042b59c22bd21398f156f91090"),
])
def test_previous_migrations_unchanged(filename, digest):
    normalized = (MIGRATIONS / filename).read_text(encoding="utf-8").encode()
    assert hashlib.sha256(normalized).hexdigest() == digest


def test_atomic_additive_migration_and_revision_defaults():
    assert re.search(r"^begin;", SQL, re.M)
    assert SQL.rstrip().endswith("commit;")
    assert "add column evidence_revision bigint not null default 0" in SQL
    assert "add column workflow_revision bigint not null default 0" in SQL
    assert "add column validation_evidence_revision bigint not null default 0" in SQL
    assert "add column metadata jsonb not null default '{}'::jsonb" in SQL
    assert "drop table" not in SQL
    assert "alter table public.schedule_activities" not in SQL
    assert "grant update on" not in SQL
    assert "drop trigger" not in SQL


def test_clarification_constraints_and_active_index_cover_awaiting_triage():
    assert "check (mode in ('resolve_now', 'request_response'))" in SQL
    assert "check (status in ('open', 'responded', 'resolved', 'cancelled'))" in SQL
    assert "clarification_request_recipient" in SQL
    assert "clarification_resolution_shape" in SQL
    assert "resolved_evidence_revision = evidence_revision" in SQL
    assert "where mode = 'request_response' and status in ('open', 'responded')" in SQL
    assert "create unique index idx_clarifications_one_active_request" in SQL


def test_proposals_have_target_fk_constraints_and_independent_override_scope():
    assert "target_activity_id text not null references public.schedule_activities(activity_id)" in SQL
    assert "('pending_validation', 'validated', 'blocked', 'finalized', 'cancelled')" in SQL
    assert "create unique index idx_remap_proposals_one_active" in SQL
    assert "where status in ('pending_validation', 'validated', 'blocked')" in SQL
    for constraint in ("proposal_override_scope", "proposal_validation_binding", "proposal_status_validation"):
        assert constraint in SQL
    assert "override_validation_generation = validation_generation" in SQL
    assert "validation_evidence_revision = evidence_revision" in SQL
    assert "override_evidence_revision = evidence_revision" in SQL


@pytest.mark.parametrize("name,signature", RPC_SIGNATURES.items())
def test_rpcs_safe_search_path_authenticated_grants_internal_auth(name, signature):
    header = SQL.split(f"function public.{name}(", 1)[1].split("as $$", 1)[0]
    assert "security definer" in header
    assert "set search_path = ''" in header
    assert "auth.uid()" in body(name)
    assert f"revoke all on function public.{name}({signature}) from public, anon, authenticated;" in COMPACT
    assert f"grant execute on function public.{name}({signature}) to authenticated;" in COMPACT
    assert "public._append_workflow_audit" in body(name)
    assert "exception when" not in body(name)


def test_lock_helper_is_internal_and_checks_role_revision_and_both_workflows():
    guard = body("_lock_pending_workflow_report")
    for requirement in ("auth.uid()", "('planner', 'admin')", "for update", "is distinct from 'pending'",
                        "p_expected_workflow_revision <> v_update.workflow_revision",
                        "c.status in ('open', 'responded')", "('pending_validation', 'validated', 'blocked')"):
        assert requirement in guard
    assert "revoke all on function public._lock_pending_workflow_report(uuid, bigint, boolean) from public, anon, authenticated, service_role" in COMPACT


def test_response_routes_by_original_identity_and_locks_parent_before_child():
    response = body("respond_to_field_update_clarification")
    assert "v_round.recipient_user_id is distinct from v_actor" in response
    assert "v_update.submitted_by_user_id is distinct from v_actor" in response
    assert "v_role not in ('site', 'engineer')" in response
    assert "v_round.status <> 'open'" in response
    assert response.index("from public.field_updates as fu") < response.index("where c.id = p_clarification_id for update")
    assert "set response = v_response, status = 'responded'" in response
    assert "workflow_revision = workflow_revision + 1" in response


def test_material_triage_invalidates_override_and_keeps_worker_dormant():
    impact = body("_apply_clarification_impact")
    assert "then 0 else 1 end" in impact
    assert "validation_overridden else false end" in impact
    assert "override_evidence_revision else null end" in impact
    assert "confidence_level =" not in impact
    for name in ("review_field_update", "override_field_update_validation", "requeue_field_update"):
        assert "validation_evidence_revision <> v_update.evidence_revision" in body(name)
    assert "override_evidence_revision = evidence_revision" in body("override_field_update_validation")


def test_accept_and_legacy_remap_require_completed_current_validation():
    decision = body("review_field_update")
    guards = decision.split("if v_action in ('accept', 'remap') then", 1)[1].split("if v_action = 'accept' then", 1)[0]
    assert "validation_status is null" in guards
    assert "validation_status not in ('pass', 'warn', 'block')" in guards
    assert "current validation must complete before approval or remap" in guards
    assert "validation_evidence_revision <> v_update.evidence_revision" in guards
    assert "override_evidence_revision is distinct from v_update.evidence_revision" in guards
    assert "override_activity_id is distinct from v_update.matched_activity_id" in guards


def test_existing_rpc_parameter_names_types_and_defaults_are_unchanged():
    previous = (MIGRATIONS / "006_transactional_planner_governance.sql").read_text(encoding="utf-8").lower()
    for name in ("review_field_update", "override_field_update_validation", "requeue_field_update"):
        pattern = rf"function public\.{name}\((.*?)\)\s*returns"
        original = re.search(pattern, previous, re.S).group(1)
        current = re.search(pattern, SQL, re.S).group(1)
        assert " ".join(current.split()) == " ".join(original.split())


def test_invalid_close_mandatory_reason_cancellation_and_compatible_audit_action():
    close = body("close_field_update_as_invalid")
    assert "v_reason text := nullif(btrim(coalesce(p_reason, '')), '')" in close
    assert "if v_reason is null" in close
    assert "for update" in close
    assert "set status = 'rejected', planner_remarks = v_reason" in close
    assert close.count("set status = 'cancelled'") == 2
    assert "cancelled_clarification_ids" in close and "cancelled_remap_proposal_ids" in close
    assert "'reject', v_previous_activity_id, null" in close
    assert "'decision', 'close_as_invalid'" in close


@pytest.mark.parametrize("table", ["field_update_clarifications", "field_update_remap_proposals"])
def test_new_table_browser_read_only_rls(table):
    assert f"alter table public.{table} enable row level security" in SQL
    assert f"revoke all on table public.{table} from public, anon, authenticated" in SQL
    assert "grant select on table public.field_update_clarifications, public.field_update_remap_proposals to authenticated" in SQL
    assert "grant all on table public.field_update_clarifications, public.field_update_remap_proposals to service_role" in SQL
    policies = re.findall(rf"create policy [^;]*? on public\.{table}\s+([^;]*);", SQL, re.S)
    assert policies and all("for select to authenticated" in " ".join(p.split()) for p in policies)
    assert not any("for update" in p or "for insert" in p or "for delete" in p for p in policies)


def test_clarification_rls_ownership_and_proposals_field_default_deny():
    assert "recipient_user_id = (select auth.uid())" in SQL
    field_policy = SQL.split("create policy clarifications_field_read_own", 1)[1].split(";", 1)[0]
    assert "('site', 'engineer')" in field_policy
    proposal_policy = SQL.split("create policy remap_proposals_planner_read", 1)[1].split(";", 1)[0]
    assert "('planner', 'admin')" in proposal_policy
    assert "site" not in proposal_policy


def test_field_insert_hardening_accepts_current_frontend_canonical_defaults():
    hook = (ROOT / "frontend/src/hooks/useFieldUpdates.ts").read_text(encoding="utf-8")
    payload = hook.split("const payload = {", 1)[1].split("};", 1)[0]
    for assignment in ("status: 'pending'", "confidence_level: 'Pending'", "confidence_score: 0",
                       "matched_activity_id: null", "expanded_text: null", "matched_layer: null", "candidate_matches: []"):
        assert assignment in payload
    policy = SQL.split("create policy field_site_engineer_insert_own", 1)[1].split(";", 1)[0]
    for assignment in ("status = 'pending'", "confidence_level = 'pending'", "confidence_score = 0",
                       "matched_activity_id is null", "validation_status is null", "validation_overridden = false",
                       "override_reason is null", "planner_remarks is null", "evidence_revision = 0", "workflow_revision = 0"):
        assert assignment in policy


def test_original_evidence_and_history_protected_and_legacy_remap_available():
    for name in RPC_SIGNATURES:
        function = body(name)
        for field in ("field_text", "reported_date", "source_type", "site_location", "reported_by", "submitted_by_user_id"):
            assert not re.search(rf"\b{field}\s*=", function), (name, field)
    assert "terminal clarification history is immutable" in body("protect_clarification_history")
    assert "submitted clarification response is immutable" in body("protect_clarification_history")
    assert "terminal remap proposal history is immutable" in body("protect_remap_proposal_history")
    assert "set status = 'remapped', matched_activity_id = v_target" in body("review_field_update")
    requeue = body("requeue_field_update")
    for assignment in ("matched_activity_id = null", "validation_status = null", "validation_results = '[]'::jsonb",
                       "validation_overridden = false", "override_reason = null", "override_by = null", "override_at = null"):
        assert assignment in requeue
