from copy import deepcopy
from unittest.mock import Mock

import pytest

from tests.test_workflow_foundation import db, call, report
from tests.test_worker_workflow import direct, result
from engine.progress_events import extract_progress_events
from engine.progress_processing import needs_progress_extraction, process_progress_extraction, progress_events_for_report
from engine.workflow_processing import process_report, server_rpc


def complete(db, snapshot, events=None):
    return server_rpc(db, 'complete_field_update_progress_extraction', {
        'p_field_update_id': snapshot['id'], 'p_evidence_revision': snapshot['evidence_revision'],
        'p_events': events if events is not None else extract_progress_events('started today', snapshot['reported_date']),
    })


def test_current_revision_and_retry_leave_planner_matching_source_unchanged(db):
    before = report(db)
    assert needs_progress_extraction(before)
    assert complete(db, before)
    current = report(db)
    assert current['progress_extraction_revision'] == 0
    assert {k: v for k, v in current.items() if k != 'progress_extraction_revision'} == {
        k: v for k, v in before.items() if k != 'progress_extraction_revision'}
    history = deepcopy(db.tables['progress_events'])
    assert complete(db, before) and db.tables['progress_events'] == history
    assert process_progress_extraction(db, current, []) is None
    assert not db.tables['planner_audit_logs']


def test_material_revision_rejects_stale_and_preserves_historical_events(db):
    old = report(db)
    assert complete(db, old)
    history = deepcopy(db.tables['progress_events'])
    direct(db, impact='mapping_inputs_changed', p_response='Welding finished yesterday')
    current = report(db)
    assert needs_progress_extraction(current)
    assert complete(db, old) is False
    assert report(db)['progress_extraction_revision'] == 0
    assert process_progress_extraction(db, current, db.tables['field_update_clarifications'])
    assert db.tables['progress_events'][:len(history)] == history
    assert db.tables['progress_events'][-1]['event_type'] == 'FINISH'
    assert db.tables['progress_events'][-1]['evidence_revision'] == 1
    assert report(db)['progress_extraction_revision'] == 1


def test_invalid_payload_rolls_back_marker_and_events_then_retries(db):
    events = extract_progress_events('started today and 60% complete', '2026-10-04')
    events[1]['progress_percent'] = 101
    with pytest.raises(ValueError):
        complete(db, report(db), events)
    assert report(db)['progress_extraction_revision'] is None
    assert not db.tables['progress_events']
    assert complete(db, report(db))


def test_failed_storage_retry_does_not_advance_marker(db, monkeypatch):
    snapshot = report(db)
    with monkeypatch.context() as patch:
        patch.setattr(db, 'save', Mock(side_effect=OSError('fixture persistence failure')))
        with pytest.raises(OSError):
            complete(db, snapshot)
        assert db.tables['field_updates'][0]['progress_extraction_revision'] is None
        assert not db.tables['progress_events']
    assert complete(db, snapshot)


@pytest.mark.parametrize('actor', [None, 'site', 'engineer', 'planner', 'admin'])
def test_clients_cannot_complete_extraction(db, actor):
    with pytest.raises(PermissionError):
        call(db, 'complete_field_update_progress_extraction', actor=actor,
             p_field_update_id='report', p_evidence_revision=0, p_events=[])


def test_effective_evidence_only_resolved_material_responses_not_questions(db):
    direct(db, impact='confirm_only', p_response='started today')
    direct(db, impact='validation_inputs_changed', p_question='Has welding started today?', p_response='60% complete today')
    r = report(db)
    rounds = deepcopy(db.tables['field_update_clarifications'])
    events = progress_events_for_report(r, rounds)
    assert [e['event_type'] for e in events] == ['PROGRESS']
    assert 'Resolved clarification' in events[0]['extraction_reason']
    assert events == progress_events_for_report(r, list(reversed(rounds)))
    for status in ('open', 'responded', 'cancelled'):
        extra = {**rounds[-1], 'id': status, 'status': status, 'response': 'finished today'}
        assert progress_events_for_report(r, rounds + [extra]) == events
    assert progress_events_for_report({**r, 'evidence_revision': 0}, rounds)[0]['event_type'] == 'UNKNOWN'


def test_backfill_finalized_and_requeue_without_evidence_change_does_not_duplicate(db):
    assert complete(db, report(db))
    call(db, 'requeue_field_update', p_field_update_id='report')
    assert not needs_progress_extraction(report(db))
    db.table('field_updates').update({'status': 'approved', 'progress_extraction_revision': None}).eq('id', 'report').execute()
    # A distinct finalized legacy row has no prior extraction and remains eligible.
    db.tables['progress_events'] = []; db.save()
    assert complete(db, report(db))
    assert report(db)['status'] == 'approved'


def test_progress_failure_never_rolls_back_successful_matching(db, monkeypatch):
    import engine.match_worker as worker
    call(db, 'requeue_field_update', p_field_update_id='report')
    matcher = Mock(activities=[{'activity_id': 'ACT-A', 'activity_name': 'Original task'}])
    matcher.match_single_report.return_value = result()
    monkeypatch.setattr(worker, 'fetch_schedule_activities', lambda client: matcher.activities)
    monkeypatch.setattr(worker, 'fetch_verified_domain_aliases', lambda client: [])
    monkeypatch.setattr(worker, 'EnsembleMatcher', lambda **kwargs: matcher)
    monkeypatch.setattr('engine.progress_processing.process_progress_extraction', Mock(side_effect=ValueError('extraction failure')))
    worker.run_worker(once=True, client=db)
    current = report(db)
    assert current['matched_activity_id'] == 'ACT-A' and current['confidence_level'] == 'High'
    assert current['validation_status'] in {'pass', 'warn', 'block'}
    assert current['progress_extraction_revision'] is None
    assert matcher.match_single_report.call_count == 1
    assert current['progress_extraction_attempts'] == 1
    assert process_progress_extraction(db, current, [])


def test_matching_payload_identical_before_and_after_progress(db):
    call(db, 'requeue_field_update', p_field_update_id='report')
    snapshot = report(db)
    matcher = Mock(activities=[{'activity_id': 'ACT-A', 'activity_name': 'Original task'}])
    matcher.match_single_report.return_value = result()
    matched = process_report(matcher, db, snapshot, [], [], [])
    current = report(db)
    assert process_progress_extraction(db, current, [])
    assert report(db)['matched_activity_id'] == matched['matched_activity_id']
    assert {k: v for k, v in report(db).items() if k != 'progress_extraction_revision'} == {
        k: v for k, v in current.items() if k != 'progress_extraction_revision'}



def test_batch_uses_fresh_material_response_after_matching_snapshot(db):
    from engine.progress_processing import process_progress_extraction_batch

    old_rounds = deepcopy(db.table('field_update_clarifications').select('*').execute().data)
    original = report(db)
    direct(db, impact='mapping_inputs_changed',
           p_question='Has welding started today and is it 90% complete?',
           p_response='Welding finished yesterday')
    current = report(db)
    fresh_rounds = deepcopy(db.tables['field_update_clarifications'])
    assert old_rounds == [] and current['evidence_revision'] == 1
    assert progress_events_for_report(current, old_rounds)[0]['event_type'] == 'UNKNOWN'
    assert process_progress_extraction_batch(db)
    events = db.table('progress_events').select('*').execute().data
    assert [e['event_type'] for e in events] == ['FINISH']
    assert events[0]['event_date'] == '2026-10-02'
    assert events[0]['evidence_revision'] == 1 and events[0]['evidence_text'] == 'Welding finished yesterday'
    assert fresh_rounds[0]['id'] in events[0]['extraction_reason']
    assert report(db)['progress_extraction_revision'] == 1
    assert report(db)['field_text'] == original['field_text']
    assert db.tables['field_update_clarifications'] == fresh_rounds


def test_batch_revision_change_before_fresh_evidence_read_rejects_stale_completion(db, monkeypatch):
    import engine.progress_processing as progress

    fetch = progress.fetch_progress_extraction_batch

    def raced_fetch(client):
        batch = fetch(client)
        assert batch[0]['evidence_revision'] == 0
        direct(db, impact='validation_inputs_changed', p_response='Welding finished today')
        return batch

    with monkeypatch.context() as patch:
        patch.setattr(progress, 'fetch_progress_extraction_batch', raced_fetch)
        assert progress.process_progress_extraction_batch(db)
    assert report(db)['evidence_revision'] == 1
    assert report(db)['progress_extraction_revision'] is None
    assert db.tables['progress_events'] == []
    assert progress.process_progress_extraction_batch(db)
    assert report(db)['progress_extraction_revision'] == 1
    assert [e['event_type'] for e in db.tables['progress_events']] == ['FINISH']


def test_failed_fresh_clarification_read_does_not_complete_extraction(db, monkeypatch, capsys):
    from engine.progress_processing import process_progress_extraction_batch

    table = db.table

    def failed_read(name):
        if name == 'field_update_clarifications':
            raise OSError('fresh read failure')
        return table(name)

    monkeypatch.setattr(db, 'table', failed_read)
    assert process_progress_extraction_batch(db) is False
    assert report(db)['progress_extraction_revision'] is None
    assert report(db)['progress_extraction_attempts'] == 0 and db.tables['progress_events'] == []
    assert 'matching/validation continues' in capsys.readouterr().err


def test_batch_revision_change_after_event_construction_rejects_stale_completion(db, monkeypatch):
    import engine.progress_processing as progress

    construct = progress.progress_events_for_report

    def construct_then_resolve(snapshot, rounds):
        events = construct(snapshot, rounds)
        direct(db, impact='mapping_inputs_changed', p_response='Welding finished today')
        return events

    with monkeypatch.context() as patch:
        patch.setattr(progress, 'progress_events_for_report', construct_then_resolve)
        assert progress.process_progress_extraction_batch(db)

    assert report(db)['evidence_revision'] == 1
    assert report(db)['progress_extraction_revision'] is None
    assert db.tables['progress_events'] == []
    assert progress.process_progress_extraction_batch(db)
    assert report(db)['progress_extraction_revision'] == 1
    assert [event['event_type'] for event in db.tables['progress_events']] == ['FINISH']
    assert db.tables['progress_events'][0]['evidence_text'] == 'Welding finished today'
