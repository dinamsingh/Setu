"""Static 009 contracts. Actual SQL/grants run in the isolated PGlite script."""
import hashlib
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / 'database/migrations/009_worker_workflow_orchestration.sql').read_text(encoding='utf-8').lower()
COMPACT = ' '.join(SQL.split())


def body(name):
    return re.search(rf'create function public\.{name}\(.*?as \$\$(.*?)\$\$;', SQL, re.S).group(1)


@pytest.mark.parametrize('name,digest', [
    ('006_transactional_planner_governance.sql', '742113130d51c605929400f3a98d385d152b31d31c99aa4e64cfa90eacf8df01'),
    ('007_security_hardening.sql', '93225ceabeec8dd5528bfd0ae38f585aefaa5b042b59c22bd21398f156f91090'),
    ('008_workflow_foundation.sql', '91274a002b062b9b1c40562c31e5ee7634fa1d3b9612995084751069bc09fe77'),
])
def test_protected_migrations_unchanged(name, digest):
    assert hashlib.sha256((ROOT / 'database/migrations' / name).read_text(encoding='utf-8').encode()).hexdigest() == digest


def test_minimal_additive_orchestration_and_legacy_compatibility():
    assert re.search(r'^begin;', SQL, re.M) and SQL.rstrip().endswith('commit;')
    for forbidden in ('alter table', 'drop table', 'create table', 'add column', 'create or replace function public.review_field_update'):
        assert forbidden not in SQL
    assert 'deprecated but callable' in SQL
    assert 'comment on function public.review_field_update(uuid, text, text, text)' in SQL


@pytest.mark.parametrize('name,signature,role', [
    ('complete_field_update_processing', 'uuid, bigint, bigint, text, jsonb', 'service_role'),
    ('complete_field_update_remap_validation', 'uuid, text, bigint, bigint, bigint, jsonb', 'service_role'),
    ('propose_field_update_remap', 'uuid, text, bigint', 'authenticated'),
    ('override_field_update_remap_proposal', 'uuid, text, bigint', 'authenticated'),
    ('cancel_field_update_remap_proposal', 'uuid, text, bigint', 'authenticated'),
    ('finalize_field_update_remap', 'uuid, text, bigint', 'authenticated'),
    ('accept_current_field_update', 'uuid, text, bigint', 'authenticated'),
    ('override_current_field_update_validation', 'uuid, text, bigint', 'authenticated'),
    ('requeue_current_field_update', 'uuid, text, bigint', 'authenticated'),
])
def test_scoped_execute_safe_path(name, signature, role):
    header = SQL.split(f'function public.{name}(', 1)[1].split('as $$', 1)[0]
    assert "security definer set search_path = ''" in header
    revoked_roles = 'public, anon, authenticated, service_role' if '_current_field_update' in name else 'public, anon, authenticated'
    assert f'revoke all on function public.{name}({signature}) from {revoked_roles};' in COMPACT
    assert f'grant execute on function public.{name}({signature}) to {role};' in COMPACT
    if role == 'authenticated':
        assert 'public._lock_' in body(name)
        if '_current_field_update' not in name:
            assert 'public._append_workflow_audit' in body(name)


@pytest.mark.parametrize('name,delegate', [
    ('accept_current_field_update', "public.review_field_update(p_field_update_id, 'accept', null, p_remarks)"),
    ('override_current_field_update_validation', 'public.override_field_update_validation(p_field_update_id, p_reason)'),
    ('requeue_current_field_update', 'public.requeue_field_update(p_field_update_id, p_remarks)'),
])
def test_new_client_revision_guard_locks_before_single_governed_delegate(name, delegate):
    wrapper = body(name)
    assert "p_expected_workflow_revision is null" in wrapper
    lock = 'public._lock_pending_workflow_report(p_field_update_id, p_expected_workflow_revision)'
    assert wrapper.index(lock) < wrapper.index(delegate)
    assert wrapper.count(delegate) == 1
    assert 'update public.field_updates' not in wrapper
    assert '_append_workflow_audit' not in wrapper
    assert 'exception when' not in wrapper  # Never swallow stale revisions/rollback.


def test_legacy_signatures_are_not_redefined_or_repermissioned_in_009():
    for name in ('review_field_update', 'override_field_update_validation', 'requeue_field_update'):
        assert not re.search(rf'(?:create|revoke|grant).*?function public\.{name}\(', SQL)


def test_processing_cas_and_intent_guard():
    cas = body('complete_field_update_processing')
    for token in ('for update', "u.status is distinct from 'pending'", 'u.workflow_revision is distinct from p_workflow_revision',
                  'u.evidence_revision is distinct from p_evidence_revision', '_field_update_processing_intent(u) is distinct from p_intent', 'return false',
                  'validation_evidence_revision = evidence_revision', 'validation_overridden = false'):
        assert token in cas
    assert 'field_text =' not in cas and 'reported_date =' not in cas
    intent = body('_field_update_processing_intent')
    assert "c.status in ('open', 'responded')" in intent
    assert "('pending_validation', 'validated', 'blocked')" in intent
    assert "c.triage_impact = 'mapping_inputs_changed'" in intent
    assert "then 'rematch' else 'revalidate'" in intent
    assert "p_intent = 'revalidate' then matched_activity_id" in cas


def test_proposal_exact_target_generation_cas_and_no_parent_validation_write():
    cas = body('complete_field_update_remap_validation')
    assert cas.index('from public.field_updates') < cas.index('where id = p_proposal_id for update')
    for token in ('p.target_activity_id is distinct from p_target_activity_id', 'p.validation_generation is distinct from p_validation_generation',
                  "p.status is distinct from 'pending_validation'", 'u.workflow_revision is distinct from p_workflow_revision',
                  'p.evidence_revision is distinct from p_evidence_revision', 'u.evidence_revision is distinct from p_evidence_revision',
                  "c.status in ('open', 'responded')", 'validated_generation = validation_generation'):
        assert token in cas
    assert 'update public.field_updates' not in cas


def test_planner_authority_scoping_finalize_and_audit():
    guard = body('_lock_current_remap_proposal')
    assert "auth.uid() is null" in guard and "('planner', 'admin')" in guard
    assert 'p.evidence_revision <> u.evidence_revision' in guard
    create = body('propose_field_update_remap')
    assert 'p_target_activity_id is not distinct from u.matched_activity_id' in create
    assert 'auth.uid(), u.evidence_revision, u.workflow_revision' in create
    assert 'workflow_revision = workflow_revision + 1' in create
    override = body('override_field_update_remap_proposal')
    assert "nullif(btrim(p_reason), '') is null" in override
    assert 'override_validation_generation = validation_generation' in override
    final = body('finalize_field_update_remap')
    for token in ("status = 'remapped'", "status = 'finalized'", 'matched_activity_id = p.target_activity_id',
                  'p.validated_generation is distinct from p.validation_generation', 'p.override_validation_generation = p.validation_generation',
                  'validation_results = p.validation_results', 'override_activity_id = case when p.validation_overridden then p.target_activity_id',
                  "'proposal_id'", "'validation_generation'", "'validation_status'", "'validation_overridden'"):
        assert token in final
