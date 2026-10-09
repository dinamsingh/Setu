"""Static 010 security/traceability contracts; isolated SQL runner tests behavior."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / 'database/migrations/010_progress_events.sql').read_text(encoding='utf-8').lower()
COMPACT = ' '.join(SQL.split())


def test_revision_history_and_checks():
    for token in ('field_update_id uuid not null references public.field_updates(id) on delete restrict',
                  'unique (field_update_id, evidence_revision, event_index)',
                  "('start', 'finish', 'progress', 'unknown')", 'progress_percent >= 0 and progress_percent <= 100',
                  'progress_extraction_revision <= evidence_revision', "default 'phase1_rules_v1'",
                  'trg_protect_progress_event_history before update or delete'):
        assert token in COMPACT
    assert re.search(r'^begin;', SQL, re.M) and SQL.rstrip().endswith('commit;')
    assert not re.search(r'\b(?:drop|truncate|delete from)\b', SQL)
    assert 'update public.schedule_activities' not in SQL


def test_read_only_parent_rls_and_insert_marker_guard():
    for token in ('alter table public.progress_events enable row level security',
                  'revoke all on table public.progress_events from public, anon, authenticated, service_role',
                  'grant select on table public.progress_events to authenticated',
                  'for select to authenticated using (exists ( select 1 from public.field_updates fu',
                  'as restrictive for insert to authenticated with check (progress_extraction_revision is null',
                  'and progress_extraction_retry_revision is null and progress_extraction_attempts = 0',
                  'and progress_extraction_last_error is null and progress_extraction_next_attempt_at is null)'):
        assert token in COMPACT
    assert not re.search(r'grant (?:all|insert|update|delete).*?progress_events.*?to authenticated', SQL)
    assert 'grant select, insert on table public.progress_events to service_role' in SQL


def test_worker_only_execute_and_safe_cas_transaction():
    signature = 'public.complete_field_update_progress_extraction(uuid, bigint, jsonb)'
    assert f'revoke all on function {signature} from public, anon, authenticated' in COMPACT
    assert f'grant execute on function {signature} to service_role' in COMPACT
    assert "security definer set search_path = ''" in COMPACT
    assert 'revoke all on function public.protect_progress_event_history() from public, anon, authenticated, service_role' in COMPACT
    body = SQL.split('declare', 1)[1]
    assert body.index('for update') < body.index('u.evidence_revision is distinct from p_evidence_revision') < body.index('insert into public.progress_events')
    assert body.index('insert into public.progress_events') < body.index('set progress_extraction_revision = p_evidence_revision')
    assert 'if u.progress_extraction_revision = p_evidence_revision then return true' in body
    assert 'on conflict' not in body and 'exception when' not in body
    assert not re.search(r'(field_text|reported_date|workflow_revision|matched_activity_id|validation_status|status)\s*=', body)
    assert 'with ordinality' in body
    assert "event_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'" in body


def test_retry_rpc_security_revision_cas_and_bounded_batch():
    for signature in ('public.fail_field_update_progress_extraction(uuid, bigint, text)',
                      'public.list_field_updates_for_progress_extraction(integer)',
                      'public.progress_extraction_ready()'):
        assert f'revoke all on function {signature} from public, anon, authenticated' in COMPACT
        assert f'grant execute on function {signature} to service_role' in COMPACT
    body = SQL.split('create function public.fail_field_update_progress_extraction(', 1)[1].split('$$;', 1)[0]
    assert "security definer set search_path = ''" in body
    assert body.index('for update') < body.index('u.evidence_revision is distinct from p_evidence_revision') < body.index('update public.field_updates')
    assert 'u.progress_extraction_revision = p_evidence_revision then return false' in ' '.join(body.split())
    assert 'least(1800, 30 * power(2, least(attempts - 1, 6)))' in body
    assert 'set progress_extraction_revision' not in body
    assert 'order by u.created_at, u.id limit greatest(0, least(coalesce(p_limit, 25), 25))' in COMPACT
    assert 'u.progress_extraction_next_attempt_at <= now()' in SQL
    assert 'u.progress_extraction_retry_revision is distinct from u.evidence_revision' in SQL
    assert 'progress_extraction_retry_revision = null, progress_extraction_attempts = 0' in COMPACT
    assert 'progress_extraction_last_error = null, progress_extraction_next_attempt_at = null' in COMPACT
