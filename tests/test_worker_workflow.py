"""B2 processing/race model. Isolated PostgreSQL tests verify actual SQL too."""
from copy import deepcopy
from unittest.mock import Mock

import pytest

from tests.test_workflow_foundation import db, call, report, request
from engine.workflow_processing import effective_evidence, processing_intent, process_report, process_proposal, server_rpc, validate_target


def direct(db, impact='confirm_only', **changes):
    params = {'p_field_update_id': 'report', 'p_question': 'Confirm area?', 'p_communication_method': 'phone',
              'p_response': 'Area confirmed', 'p_supplied_by': 'Original supervisor', 'p_impact': impact, **changes}
    return call(db, 'resolve_field_update_clarification_now', **params)


def propose(db):
    return call(db, 'propose_field_update_remap', p_field_update_id='report', p_target_activity_id='ACT-B')


def result(status='pass'):
    return {'validation_status': status, 'validation_results': [{'outcome': status}],
            'confidence_level': 'High', 'confidence_score': .9, 'matched_activity_id': 'ACT-A',
            'candidate_matches': [], 'expanded_text': 'computed', 'matched_layer': 'semantic'}


def complete(db, snapshot, intent='match', payload=None):
    return server_rpc(db, 'complete_field_update_processing', {
        'p_field_update_id': snapshot['id'], 'p_workflow_revision': snapshot['workflow_revision'],
        'p_evidence_revision': snapshot['evidence_revision'], 'p_intent': intent, 'p_result': payload or result(),
    })


def proposal_result(db, proposal, status='pass', **changes):
    return server_rpc(db, 'complete_field_update_remap_validation', {
        'p_proposal_id': proposal['id'], 'p_target_activity_id': proposal['target_activity_id'],
        'p_workflow_revision': proposal['workflow_revision'], 'p_evidence_revision': proposal['evidence_revision'],
        'p_validation_generation': proposal['validation_generation'], 'p_result': result(status), **changes,
    })


def test_effective_evidence_deterministic_resolved_material_only(db):
    original = report(db)
    direct(db, impact='confirm_only')
    assert effective_evidence(report(db), db.tables['field_update_clarifications'])['field_text'] == original['field_text']
    direct(db, impact='mapping_inputs_changed', p_response='Different work detail')
    rounds = deepcopy(db.tables['field_update_clarifications'])
    effective = effective_evidence(report(db), rounds)
    assert 'Different work detail' in effective['field_text']
    assert 'Area confirmed' not in effective['field_text']
    assert effective_evidence(report(db), list(reversed(rounds))) == effective
    for status in ('open', 'responded', 'cancelled'):
        bad = deepcopy(rounds[-1]); bad.update(id=status, status=status, response='DO NOT CONSUME')
        assert 'DO NOT CONSUME' not in effective_evidence(report(db), rounds + [bad])['field_text']
    assert report(db)['field_text'] == original['field_text']
    for field in ('reported_date', 'source_type', 'site_location', 'submitted_by_user_id'):
        assert effective[field] == original[field]


@pytest.mark.parametrize('impact,intent', [('confirm_only', None), ('validation_inputs_changed', 'revalidate'), ('mapping_inputs_changed', 'rematch')])
def test_explicit_impact_eligibility_and_completion(db, impact, intent):
    direct(db, impact=impact)
    r = report(db)
    assert processing_intent(r, db.tables['field_update_clarifications']) == intent
    if intent:
        assert complete(db, r, intent)
        current = report(db)
        assert current['validation_evidence_revision'] == current['evidence_revision']
        assert processing_intent(current, db.tables['field_update_clarifications']) is None
    else:
        assert r['evidence_revision'] == 0


@pytest.mark.parametrize('mutation', ['clarification', 'finalize', 'requeue', 'evidence', 'proposal'])
def test_stale_computation_is_discarded(db, mutation):
    call(db, 'requeue_field_update', p_field_update_id='report')
    snapshot = report(db)
    if mutation == 'clarification': request(db)
    elif mutation == 'finalize': call(db, 'close_field_update_as_invalid', p_field_update_id='report', p_reason='Test')
    elif mutation == 'requeue': call(db, 'requeue_field_update', p_field_update_id='report')
    elif mutation == 'evidence': direct(db, impact='mapping_inputs_changed')
    else: propose(db)
    before = report(db)
    assert complete(db, snapshot) is False
    assert report(db) == before


def test_stale_material_processing_and_wrong_intent_rejected(db):
    direct(db, impact='validation_inputs_changed')
    old = report(db)
    assert complete(db, old, 'rematch') is False
    direct(db, impact='mapping_inputs_changed')
    assert complete(db, old, 'revalidate') is False


def test_validation_only_does_not_use_matcher_or_change_target(db):
    direct(db, impact='validation_inputs_changed')
    matcher = Mock(activities=[{'activity_id': 'ACT-A', 'activity_name': 'Original task'}])
    process_report(matcher, db, report(db), [report(db)], db.tables['field_update_clarifications'], [])
    matcher.match_single_report.assert_not_called()
    assert report(db)['matched_activity_id'] == 'ACT-A'


def test_mapping_uses_effective_text_then_current_validation(db):
    direct(db, impact='mapping_inputs_changed', p_response='Corrected activity context')
    matcher = Mock(activities=[{'activity_id': 'ACT-A', 'activity_name': 'Original task'}])
    matcher.match_single_report.return_value = result()
    applied = process_report(matcher, db, report(db), [], db.tables['field_update_clarifications'], [])
    assert applied['applied']
    assert 'Corrected activity context' in matcher.match_single_report.call_args.args[0]['field_text']
    assert report(db)['field_text'] == 'Original evidence'


@pytest.mark.parametrize('status', ['pass', 'warn', 'block'])
def test_proposal_only_results_then_governed_finalize(db, status):
    p = propose(db)
    assert report(db)['matched_activity_id'] == 'ACT-A'
    assert report(db)['status'] == 'pending'
    assert proposal_result(db, p, status)
    assert report(db)['validation_status'] == 'pass'
    if status == 'block':
        with pytest.raises(ValueError, match='proposal-scoped'):
            call(db, 'finalize_field_update_remap', p_proposal_id=p['id'])
        call(db, 'override_field_update_remap_proposal', p_proposal_id=p['id'], p_reason='Site record verified')
    final = call(db, 'finalize_field_update_remap', p_proposal_id=p['id'])
    assert final['status'] == 'remapped' and final['matched_activity_id'] == 'ACT-B'
    assert final['validation_status'] == status
    assert final['validation_overridden'] == (status == 'block')
    assert final['override_activity_id'] == ('ACT-B' if status == 'block' else None)
    assert db.tables['planner_audit_logs'][-1]['metadata']['proposal_id'] == p['id']
    assert proposal_result(db, p) is False


def test_manual_target_runs_six_validators_and_excludes_self(db, monkeypatch):
    import engine.workflow_processing as worker
    p = propose(db)
    validator = Mock(return_value={'status': 'warn', 'results': [{'check': 'candidate_ambiguity', 'message': 'Ranking ambiguous', 'outcome': 'warn'}]})
    monkeypatch.setattr(worker, 'validate_report_matching', validator)
    assert process_proposal(db, p, report(db), [{'activity_id': 'ACT-A'}, {'activity_id': 'ACT-B'}],
                            [report(db), {'id': 'other', 'update_id': 'OTHER'}], [])
    args = validator.call_args
    assert args.args[1]['activity_id'] == 'ACT-B'
    assert args.kwargs['all_reports'] == [{'id': 'other', 'update_id': 'OTHER'}]
    assert 'diagnostic only' in db.tables['field_update_remap_proposals'][0]['validation_results'][0]['message']
    actual = validate_target(report(db), {'activity_id': 'ACT-B', 'activity_name': 'Civil works'}, [], [report(db)], manual=True)
    assert len(actual['results']) == 1  # patched aggregate receives the exact manual target


def test_actual_manual_validator_checks_not_replaced(db):
    validation = validate_target(report(db), {'activity_id': 'ACT-B', 'activity_name': 'Civil works'}, [], [report(db)], manual=True)
    assert len(validation['results']) == 6
    assert {c['check'] for c in validation['results']} == {'date_plausibility', 'candidate_ambiguity', 'location_consistency', 'duplicate_detection', 'reporter_discipline', 'sequence_plausibility'}


def test_old_override_never_transfers_and_cancel_allows_clarify(db):
    db.table('field_updates').update({'validation_status': 'block'}).eq('id', 'report').execute()
    call(db, 'override_field_update_validation', p_field_update_id='report', p_reason='Old target')
    p = propose(db)
    proposal_result(db, p, 'block')
    assert not db.tables['field_update_remap_proposals'][0]['validation_overridden']
    with pytest.raises(ValueError, match='proposal-scoped'):
        call(db, 'finalize_field_update_remap', p_proposal_id=p['id'])
    call(db, 'cancel_field_update_remap_proposal', p_proposal_id=p['id'], p_reason='Need context')
    assert request(db)['status'] == 'open'
    assert proposal_result(db, p) is False


def test_generation_binding_and_finalize_before_validation(db):
    p = propose(db)
    assert proposal_result(db, p, p_validation_generation=2) is False
    assert proposal_result(db, p, p_target_activity_id='ACT-A') is False
    with pytest.raises(ValueError, match='must complete'):
        call(db, 'finalize_field_update_remap', p_proposal_id=p['id'])
    proposal_result(db, p, 'block')
    call(db, 'override_field_update_remap_proposal', p_proposal_id=p['id'], p_reason='Verified')
    db.table('field_update_remap_proposals').update({'override_validation_generation': 2}).eq('id', p['id']).execute()
    with pytest.raises(ValueError, match='proposal-scoped'):
        call(db, 'finalize_field_update_remap', p_proposal_id=p['id'])


def test_override_from_cancelled_proposal_never_transfers(db):
    previous = propose(db)
    proposal_result(db, previous, 'block')
    call(db, 'override_field_update_remap_proposal', p_proposal_id=previous['id'], p_reason='Previous review')
    call(db, 'cancel_field_update_remap_proposal', p_proposal_id=previous['id'], p_reason='Reconsider target')
    current = propose(db)
    proposal_result(db, current, 'block')
    with pytest.raises(ValueError, match='proposal-scoped'):
        call(db, 'finalize_field_update_remap', p_proposal_id=current['id'])
    assert not db.tables['field_update_remap_proposals'][-1]['validation_overridden']


@pytest.mark.parametrize('actor', [None, 'site', 'engineer', 'unknown'])
def test_proposal_authorization_and_server_only(db, actor):
    with pytest.raises(PermissionError):
        call(db, 'propose_field_update_remap', actor=actor, p_field_update_id='report', p_target_activity_id='ACT-B')
    with pytest.raises(PermissionError):
        call(db, 'complete_field_update_processing', actor=actor, p_field_update_id='report', p_result=result())


def test_terminal_reports_ignored(db):
    call(db, 'review_field_update', p_field_update_id='report', p_action='accept')
    assert processing_intent(report(db)) is None
    assert complete(db, report(db)) is False


def test_mock_upsert_generates_stable_report_uuid_for_cas(db):
    row = {'update_id': 'NEW', 'field_text': 'New evidence', 'status': 'pending', 'confidence_level': 'Pending'}
    db.table('field_updates').upsert(row, on_conflict='update_id').execute()
    first = deepcopy(db.table('field_updates').select().eq('update_id', 'NEW').execute().data[0])
    assert first['id']
    db.table('field_updates').upsert({'update_id': 'NEW', 'field_text': 'New evidence'}, on_conflict='update_id').execute()
    assert db.table('field_updates').select().eq('update_id', 'NEW').execute().data[0]['id'] == first['id']


def test_worker_prioritizes_proposals_then_material_then_new(db, monkeypatch):
    import engine.match_worker as worker
    r = report(db)
    rows = [{**r, 'id': 'manual', 'update_id': 'MANUAL'},
            {**r, 'id': 'new', 'update_id': 'NEW', 'confidence_level': 'Pending'},
            {**r, 'id': 'material', 'update_id': 'MATERIAL', 'evidence_revision': 1, 'validation_status': None}]
    db.tables['field_updates'] = rows
    db.tables['field_update_remap_proposals'] = [{'id': 'p', 'field_update_id': 'manual', 'status': 'pending_validation'}]
    db.save()
    monkeypatch.setattr(worker, 'fetch_schedule_activities', lambda client: [{'activity_id': 'ACT-A'}])
    monkeypatch.setattr(worker, 'fetch_verified_domain_aliases', lambda client: [])
    monkeypatch.setattr(worker, 'EnsembleMatcher', lambda **kw: Mock(activities=kw['activities']))
    order = []
    monkeypatch.setattr(worker, 'process_proposal', lambda client, p, *args: order.append('proposal') or True)
    def process(matcher, client, row, *args):
        order.append(row['update_id'])
        return {'update_id': row['update_id'], 'applied': True, 'tier': 'High', 'validation_status': 'pass',
                'matched_activity_id': 'ACT-A', 'confidence_score': .9}
    monkeypatch.setattr(worker, 'process_report', process)
    worker.run_worker(once=True, client=db)
    assert order == ['proposal', 'MATERIAL', 'NEW']
