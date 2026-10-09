"""Bounded Phase 1 retries; no changes to matching decisions."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

import pytest

from database.supabase_client import LocalMockDatabase
import database.progress_mock as progress_mock
import engine.progress_processing as progress
from engine.workflow_processing import server_rpc
from tests.test_workflow_foundation import db, call, report
from tests.test_worker_workflow import direct, result


@pytest.fixture
def clock(monkeypatch):
    class Clock(datetime):
        current = datetime(2026, 10, 6, tzinfo=timezone.utc)

        @classmethod
        def now(cls, tz=None):
            return cls.current

    monkeypatch.setattr(progress_mock, 'datetime', Clock)
    return Clock


def fail(db, snapshot, message='ValueError'):
    return server_rpc(db, 'fail_field_update_progress_extraction', {
        'p_field_update_id': snapshot['id'], 'p_evidence_revision': snapshot['evidence_revision'],
        'p_error': message,
    })


def seed_many(db, count=31):
    original = report(db)
    db.tables['field_updates'] = [{**deepcopy(original), 'id': f'report-{i:02}',
                                  'created_at': '2026-10-03T00:00:00+00:00'}
                                 for i in reversed(range(count))]
    db.save()


def test_batch_is_bounded_and_deterministically_ordered(db, monkeypatch):
    seed_many(db)
    extract = Mock(return_value=True)
    monkeypatch.setattr(progress, 'process_progress_extraction', extract)
    assert progress.process_progress_extraction_batch(db)
    assert extract.call_count == progress.PROGRESS_EXTRACTION_BATCH_SIZE == 25
    assert [c.args[1]['id'] for c in extract.call_args_list] == [f'report-{i:02}' for i in range(25)]
    assert len(progress.fetch_progress_extraction_batch(db, 1000)) == 25
    assert len(progress.fetch_progress_extraction_batch(db, 3)) == 3
    assert progress.fetch_progress_extraction_batch(db, 0) == []


def test_failure_does_not_block_later_rows_or_retry_before_deadline(db, monkeypatch, clock, capsys):
    seed_many(db, 3)
    original = progress.process_progress_extraction
    calls = []

    def extract(client, row, rounds):
        calls.append(row['id'])
        if row['id'] == 'report-00':
            raise ValueError('secret-token must never appear in logs')
        return original(client, row, rounds)

    monkeypatch.setattr(progress, 'process_progress_extraction', extract)
    assert progress.process_progress_extraction_batch(db)
    assert calls == ['report-00', 'report-01', 'report-02']
    rows = db.table('field_updates').select().execute().data
    bad = next(r for r in rows if r['id'] == 'report-00')
    assert bad['progress_extraction_revision'] is None
    assert bad['progress_extraction_attempts'] == 1
    assert bad['progress_extraction_last_error'] == 'ValueError'
    assert all(r['progress_extraction_revision'] == 0 for r in rows if r['id'] != 'report-00')
    clock.current += timedelta(seconds=29)
    assert progress.process_progress_extraction_batch(db)
    assert len(calls) == 3
    # Eligibility survives worker restart, rather than depending on process memory.
    restarted = LocalMockDatabase(db.storage_file)
    assert progress.fetch_progress_extraction_batch(restarted) == []
    clock.current += timedelta(seconds=1)
    assert progress.process_progress_extraction_batch(restarted)
    assert calls[-1] == 'report-00' and len(calls) == 4
    assert 'secret-token' not in capsys.readouterr().err


def test_exponential_backoff_and_cap(db, clock):
    snapshot = report(db)
    for attempt, seconds in enumerate([30, 60, 120, 240, 480, 960, 1800, 1800], 1):
        assert fail(db, snapshot)
        current = report(db)
        assert current['progress_extraction_attempts'] == attempt
        deadline = datetime.fromisoformat(current['progress_extraction_next_attempt_at'])
        assert (deadline - clock.current).total_seconds() == seconds
        assert progress.fetch_progress_extraction_batch(db) == []
        clock.current = deadline
        assert len(progress.fetch_progress_extraction_batch(db)) == 1


def test_success_resets_retry_state_and_late_failure_cannot_restore_it(db, clock):
    snapshot = report(db)
    assert fail(db, snapshot)
    clock.current += timedelta(seconds=30)
    assert progress.process_progress_extraction(db, report(db), [])
    current = report(db)
    assert current['progress_extraction_revision'] == 0
    assert current['progress_extraction_retry_revision'] is None
    assert current['progress_extraction_attempts'] == 0
    assert current['progress_extraction_last_error'] is None
    assert current['progress_extraction_next_attempt_at'] is None
    assert not fail(db, snapshot)
    assert progress.fetch_progress_extraction_batch(db) == []


def test_new_evidence_ignores_old_retry_state_and_stale_failures(db, clock):
    old = report(db)
    assert fail(db, old)
    direct(db, impact='mapping_inputs_changed', p_response='Welding finished today')
    current = report(db)
    assert current['evidence_revision'] == 1
    assert len(progress.fetch_progress_extraction_batch(db)) == 1
    assert not fail(db, old)
    assert fail(db, current)
    assert report(db)['progress_extraction_attempts'] == 1
    clock.current += timedelta(seconds=30)
    assert progress.process_progress_extraction(db, report(db), db.tables['field_update_clarifications'])
    assert report(db)['progress_extraction_attempts'] == 0


@pytest.mark.parametrize('name,params', [
    ('fail_field_update_progress_extraction', {'p_field_update_id': 'report', 'p_evidence_revision': 0, 'p_error': 'failed'}),
    ('list_field_updates_for_progress_extraction', {'p_limit': 25}),
    ('progress_extraction_ready', {}),
])
@pytest.mark.parametrize('actor', [None, 'site', 'engineer', 'planner', 'admin'])
def test_progress_retry_and_readiness_rpcs_are_server_only(db, name, params, actor):
    with pytest.raises(PermissionError):
        call(db, name, actor=actor, **params)


def prepare_worker(db, monkeypatch):
    import engine.match_worker as worker
    call(db, 'requeue_field_update', p_field_update_id='report')
    matcher = Mock(activities=[{'activity_id': 'ACT-A', 'activity_name': 'Original task'}])
    matcher.match_single_report.return_value = result()
    monkeypatch.setattr(worker, 'fetch_schedule_activities', lambda client: matcher.activities)
    monkeypatch.setattr(worker, 'fetch_verified_domain_aliases', lambda client: [])
    monkeypatch.setattr(worker, 'EnsembleMatcher', lambda **kwargs: matcher)
    return worker, matcher


@pytest.mark.parametrize('missing', ['rpc', 'table'])
def test_missing_capability_disables_extraction_once_but_worker_keeps_matching(db, monkeypatch, capsys, missing):
    worker, matcher = prepare_worker(db, monkeypatch)
    rpc = db.rpc
    calls = []
    if missing == 'table':
        db.tables.pop('progress_events')
        db.save()

    def checked_rpc(name, params, **kwargs):
        calls.append(name)
        if missing == 'rpc' and name == 'progress_extraction_ready':
            raise RuntimeError('missing RPC with secret-token')
        return rpc(name, params, **kwargs)

    monkeypatch.setattr(db, 'rpc', checked_rpc)
    cycles = []

    def sleep(interval):
        cycles.append(interval)
        if len(cycles) == 3:
            raise KeyboardInterrupt

    monkeypatch.setattr(worker.time, 'sleep', sleep)
    worker.run_worker(client=db)
    assert len(cycles) == 3 and matcher.match_single_report.call_count == 1
    assert report(db)['confidence_level'] == 'High'
    assert report(db)['progress_extraction_revision'] is None
    assert calls.count('progress_extraction_ready') == 1
    assert 'list_field_updates_for_progress_extraction' not in calls
    error = capsys.readouterr().err
    assert error.count('Extraction disabled') == 1
    assert 'migration 010' in error and 'matching/validation continues' in error
    assert 'secret-token' not in error


def test_missing_batch_capability_is_detected_at_startup(db, monkeypatch, capsys):
    rpc = db.rpc

    def missing_batch(name, params, **kwargs):
        if name == 'list_field_updates_for_progress_extraction':
            raise RuntimeError('missing batch RPC')
        return rpc(name, params, **kwargs)

    monkeypatch.setattr(db, 'rpc', missing_batch)
    assert progress.progress_extraction_available(db) is False
    assert 'migration 010' in capsys.readouterr().err


def test_matching_has_priority_and_extraction_fetches_fresh_report(db, monkeypatch):
    worker, matcher = prepare_worker(db, monkeypatch)
    observed = []
    original = progress.process_progress_extraction

    def extract(client, row, rounds):
        observed.append(row)
        assert matcher.match_single_report.call_count == 1
        assert row['confidence_level'] == 'High'
        return original(client, row, rounds)

    monkeypatch.setattr(progress, 'process_progress_extraction', extract)
    worker.run_worker(once=True, client=db)
    assert len(observed) == 1 and report(db)['progress_extraction_revision'] == 0


@pytest.mark.parametrize('impact', ['mapping_inputs_changed', 'validation_inputs_changed'])
def test_worker_uses_fresh_clarification_after_outer_matching_snapshot(db, monkeypatch, impact):
    worker, matcher = prepare_worker(db, monkeypatch)
    match = worker.process_report
    observed_rounds = []

    def match_then_resolve(*args):
        observed_rounds.append(deepcopy(args[4]))
        matched = match(*args)
        assert matched['applied']
        direct(db, impact=impact, p_question='Has welding started and reached 90% complete?',
               p_response='Welding finished yesterday')
        return matched

    monkeypatch.setattr(worker, 'process_report', match_then_resolve)
    worker.run_worker(once=True, client=db)

    assert observed_rounds == [[]] and matcher.match_single_report.call_count == 1
    current = report(db)
    assert current['evidence_revision'] == current['progress_extraction_revision'] == 1
    events = db.table('progress_events').select('*').execute().data
    assert len(events) == 1
    assert events[0]['event_type'] == 'FINISH' and events[0]['event_date'] == '2026-10-02'
    assert events[0]['evidence_revision'] == 1
    assert events[0]['evidence_text'] == 'Welding finished yesterday'
    clarification = db.tables['field_update_clarifications'][0]
    assert clarification['id'] in events[0]['extraction_reason']
    assert current['field_text'] == 'Original evidence'


def test_failure_writeback_error_disables_only_extraction(db, monkeypatch, capsys):
    worker, matcher = prepare_worker(db, monkeypatch)
    rpc = db.rpc

    def broken_writeback(name, params, **kwargs):
        if name == 'fail_field_update_progress_extraction':
            raise OSError('secret-token')
        return rpc(name, params, **kwargs)

    monkeypatch.setattr(db, 'rpc', broken_writeback)
    extract = Mock(side_effect=ValueError('bad evidence'))
    monkeypatch.setattr(progress, 'process_progress_extraction', extract)
    cycles = []

    def sleep(interval):
        cycles.append(interval)
        if len(cycles) == 2:
            raise KeyboardInterrupt

    monkeypatch.setattr(worker.time, 'sleep', sleep)
    worker.run_worker(client=db)
    assert matcher.match_single_report.call_count == 1 and extract.call_count == 1
    assert report(db)['confidence_level'] == 'High'
    assert report(db)['progress_extraction_revision'] is None
    error = capsys.readouterr().err
    assert error.count('Extraction disabled') == 1 and 'secret-token' not in error



def test_batch_fetches_clarifications_only_for_selected_report_ids(db, monkeypatch):
    seed_many(db)
    db.tables['field_update_clarifications'] = [
        {'id': 'selected', 'field_update_id': 'report-00'},
        {'id': 'outside-batch', 'field_update_id': 'report-30'},
    ]
    db.save()
    table = db.table
    queries = []

    def observed_table(name):
        query = table(name)
        if name == 'field_update_clarifications':
            query.in_ = Mock(wraps=query.in_)
            queries.append(query)
        return query

    monkeypatch.setattr(db, 'table', observed_table)
    extract = Mock(return_value=True)
    monkeypatch.setattr(progress, 'process_progress_extraction', extract)
    assert progress.process_progress_extraction_batch(db)
    assert len(queries) == 1
    queries[0].in_.assert_called_once_with('field_update_id', [f'report-{i:02}' for i in range(25)])
    assert extract.call_count == 25
    assert all(call.args[2] == [{'id': 'selected', 'field_update_id': 'report-00'}]
               for call in extract.call_args_list)


def test_empty_extraction_batch_does_not_fetch_clarifications(db, monkeypatch):
    table = Mock(wraps=db.table)
    monkeypatch.setattr(db, 'table', table)
    monkeypatch.setattr(progress, 'fetch_progress_extraction_batch', lambda client: [])
    assert progress.process_progress_extraction_batch(db)
    table.assert_not_called()
