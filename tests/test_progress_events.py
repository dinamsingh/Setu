"""Phase 1 rules never consult matching, external APIs or the machine clock."""
from datetime import date, datetime

import pytest

from engine.progress_events import extract_progress_events


@pytest.mark.parametrize('text,kind,event_date,percent', [
    ('Welding started today', 'START', '2026-10-04', None),
    ('Welding started yesterday', 'START', '2026-10-03', None),
    ('Welding commenced today', 'START', '2026-10-04', None),
    ('Welding began yesterday', 'START', '2026-10-03', None),
    ('Welding completed today', 'FINISH', '2026-10-04', None),
    ('Welding finished yesterday', 'FINISH', '2026-10-03', None),
    ('Welding is 60% complete', 'PROGRESS', None, 60),
    ('Welding is 60% completed today', 'PROGRESS', '2026-10-04', 60),
    ('Welding 0% complete today', 'PROGRESS', '2026-10-04', 0),
    ('Welding 100% complete yesterday', 'PROGRESS', '2026-10-03', 100),
    ('Welding 60.5% done today', 'PROGRESS', '2026-10-04', 60.5),
    ('Welding finished', 'FINISH', None, None),
    ('Welding started on 2026-10-02', 'START', '2026-10-02', None),
])
def test_actual_events(text, kind, event_date, percent):
    events = extract_progress_events(text, '2026-10-04')
    assert len(events) == 1
    assert events[0]['event_type'] == kind
    assert events[0]['event_date'] == event_date
    assert events[0]['progress_percent'] == percent
    assert events[0]['evidence_text'] == text
    assert events[0]['extraction_reason'] and events[0]['extraction_version'] == 'phase1_rules_v1'


@pytest.mark.parametrize('text', [
    'not started', 'has not started', "hasn't started today", 'not completed',
    'will start tomorrow', 'planned to start', 'expected to start', 'starting tomorrow',
    'will finish', 'expected to complete', 'expected to finish', 'planned completion',
    'to be completed today', 'must be finished today', 'to be started today',
    'planned 60%', 'planned 60% complete', 'target 60% completed today', 'expected 60% complete',
    '101% complete', '101% completed today', '120% complete', '-1% completed',
    '1,000% completed today', '- 1% completed', '60% of welding completed today',
    '60% fully completed today', '100.00000000000000000001% completed',
    'inspection carried out', 'materials received', 'Has welding completed today?', '',
])
def test_unsupported_or_non_actual_is_unknown(text):
    events = extract_progress_events(text, '2026-10-04')
    assert len(events) == 1 and events[0]['event_type'] == 'UNKNOWN'
    assert events[0]['progress_percent'] is None and events[0]['event_date'] is None


def test_multiple_events_clause_dates_and_deterministic_order():
    text = 'Pipe erection started yesterday and is 60% complete today. Inspection carried out.'
    events = extract_progress_events(text, '2026-10-04')
    assert [(e['event_index'], e['event_type'], e['event_date']) for e in events] == [
        (0, 'START', '2026-10-03'), (1, 'PROGRESS', '2026-10-04')]
    assert events[0]['evidence_text'] == 'Pipe erection started yesterday'
    assert events[1]['evidence_text'] == 'is 60% complete today'
    assert extract_progress_events(text, '2026-10-04') == events


def test_finish_never_implies_100_percent_and_overlaps_do_not_duplicate():
    assert len(extract_progress_events('100% completed today', '2026-10-04')) == 1
    repeated = extract_progress_events('started started today', '2026-10-04')
    assert [e['event_type'] for e in repeated] == ['START']
    assert repeated[0]['event_date'] == '2026-10-04'
    assert extract_progress_events('finished today', '2026-10-04')[0]['progress_percent'] is None


@pytest.mark.parametrize('anchor', [None, '', 'invalid', '2026-02-30', '2026-10-04T01:00:00Z', datetime(2026, 10, 4)])
def test_missing_or_unusable_anchor_preserves_type_not_date(anchor):
    event = extract_progress_events('started yesterday', anchor)[0]
    assert event['event_type'] == 'START' and event['event_date'] is None
    assert 'reported_date is missing or unusable' in event['extraction_reason']


def test_date_boundaries_and_no_borrowed_dates():
    assert extract_progress_events('started yesterday', date(2026, 1, 1))[0]['event_date'] == '2025-12-31'
    events = extract_progress_events('started yesterday and 60% complete', '2026-10-04')
    assert events[1]['event_date'] is None
    assert extract_progress_events('started today yesterday', '2026-10-04')[0]['event_date'] is None
    assert extract_progress_events('started on 2026-02-30', '2026-10-04')[0]['event_date'] is None
    assert extract_progress_events('started yesterday', '0001-01-01')[0]['event_date'] is None


def test_clause_scoping_does_not_discard_separate_actual_event():
    events = extract_progress_events('Planned to start tomorrow, but welding finished yesterday.', '2026-10-04')
    assert [e['event_type'] for e in events] == ['FINISH']


@pytest.mark.parametrize('text', [
    'planned 60% complete and 70% completed today',
    'target 60% complete and 70% complete',
    'will be completed today and started today',
])
def test_non_actual_scope_is_not_lost_across_and(text):
    assert extract_progress_events(text, '2026-10-04')[0]['event_type'] == 'UNKNOWN'



@pytest.mark.parametrize('text', [
    'planned to start and commenced today',
    'planned to start, and commenced today',
    'not started and 60% complete today',
    'not started, and 60% complete today',
    'planned to start,   AND commenced today',
    'not started,\tand 60% complete today',
])
def test_compound_non_actual_inheritance(text):
    events = extract_progress_events(text, '2026-10-04')
    assert [e['event_type'] for e in events] == ['UNKNOWN']


@pytest.mark.parametrize('text', [
    'planned to start, and commenced today. Piping started today.',
    'not started, and 60% complete today; Foundation finished yesterday.',
    'not started, and 60% complete today\nPiping started today.',
    'not started, and 60% complete today, but piping started today.',
])
def test_non_actual_scope_resets_for_independent_later_statements(text):
    events = extract_progress_events(text, '2026-10-04')
    expected = 'FINISH' if 'Foundation' in text else 'START'
    assert [e['event_type'] for e in events] == [expected]
    assert events[0]['event_date'] == ('2026-10-03' if expected == 'FINISH' else '2026-10-04')
    assert events[0]['evidence_text'].startswith(('Piping', 'Foundation', 'piping'))


@pytest.mark.parametrize('text,kind,event_date', [
    ('Welding started today without delay', 'START', '2026-10-04'),
    ('Piping commenced today without issues', 'START', '2026-10-04'),
    ('Foundation completed today as per plan', 'FINISH', '2026-10-04'),
    ('Piping finished yesterday according to plan', 'FINISH', '2026-10-03'),
])
def test_actual_manner_qualifiers_preserve_event_and_date(text, kind, event_date):
    events = extract_progress_events(text, '2026-10-04')
    assert len(events) == 1
    assert events[0]['event_type'] == kind and events[0]['event_date'] == event_date
    assert events[0]['evidence_text'] == text and events[0]['progress_percent'] is None


@pytest.mark.parametrize('text', [
    'planned to start', 'expected to finish', 'not started', 'not completed', 'will start tomorrow',
    'planned to start and commenced today without delay',
    'expected to be finished today as per plan',
    'Piping not completed today according to plan',
])
def test_manner_qualifiers_do_not_weaken_non_actual_protection(text):
    assert [e['event_type'] for e in extract_progress_events(text, '2026-10-04')] == ['UNKNOWN']


@pytest.mark.parametrize('text,percent,event_date', [
    ('Welding spool A - 50% complete today', 50, '2026-10-04'),
    ('Task 1 - 60% done', 60, None),
    ('Task 1\t-\t60% done', 60, None),
])
def test_hyphenated_label_percentage(text, percent, event_date):
    events = extract_progress_events(text, '2026-10-04')
    assert len(events) == 1
    assert events[0]['event_type'] == 'PROGRESS' and events[0]['progress_percent'] == percent
    assert events[0]['event_date'] == event_date and events[0]['evidence_text'] == text


@pytest.mark.parametrize('text', [
    '-50% complete', '-50% completed today', '-50% done', '- 50% complete',
    '+50% complete', 'Task 1 - -50% complete', 'Task 1 - - 50% done', 'Task 1 -50% complete',
    '(- 50% complete)',
])
def test_signed_percentages_remain_unsupported(text):
    assert [e['event_type'] for e in extract_progress_events(text, '2026-10-04')] == ['UNKNOWN']
