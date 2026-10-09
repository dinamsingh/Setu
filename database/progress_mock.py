"""Local transaction model for 010. SQL/RLS verification remains separate."""

from copy import deepcopy
import re
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from engine.progress_events import EXTRACTION_VERSION


RPC_NAMES = {
    'complete_field_update_progress_extraction', 'fail_field_update_progress_extraction',
    'list_field_updates_for_progress_extraction', 'progress_extraction_ready',
}


def validate_events(events):
    if not isinstance(events, list) or not events:
        raise ValueError('A non-empty ordered progress event array is required')
    if len(events) > 1 and any(isinstance(e, dict) and e.get('event_type') == 'UNKNOWN' for e in events):
        raise ValueError('UNKNOWN must be the sole event when no supported actual event exists')
    for index, event in enumerate(events):
        if (not isinstance(event, dict) or type(event.get('event_index')) is not int
                or event['event_index'] != index or event.get('event_type') not in {'START', 'FINISH', 'PROGRESS', 'UNKNOWN'}
                or event.get('extraction_version') != EXTRACTION_VERSION
                or any(not isinstance(event.get(key), str) or not event[key].strip()
                       for key in ('evidence_text', 'extraction_reason'))):
            raise ValueError('Invalid progress event shape or ordering')
        percent = event.get('progress_percent')
        if (event['event_type'] == 'PROGRESS' and (type(percent) not in (int, float) or not 0 <= percent <= 100)
                or event['event_type'] != 'PROGRESS' and percent is not None):
            raise ValueError('Invalid progress percentage')
        value = event.get('event_date')
        if value is not None:
            if (event['event_type'] == 'UNKNOWN' or not isinstance(value, str)
                    or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value)):
                raise ValueError('Invalid progress event date')
            date.fromisoformat(value)


class LocalProgressRPC:
    def __init__(self, db, name, params, server):
        self.db, self.name, self.params, self.server = db, name, params, server

    def execute(self):
        from database.supabase_client import LocalMockResponse
        if not self.server:
            raise PermissionError('Server-only progress extraction writeback')
        with self.db._workflow_lock:
            self.db.load()
            original = deepcopy(self.db.tables)
            tables = deepcopy(original)
            if self.name == 'progress_extraction_ready':
                return LocalMockResponse(['progress_events' in tables])
            if self.name == 'list_field_updates_for_progress_extraction':
                now = datetime.now(timezone.utc)
                eligible = [r for r in tables['field_updates']
                            if r.get('progress_extraction_revision') != r.get('evidence_revision', 0)
                            and (r.get('progress_extraction_retry_revision') != r.get('evidence_revision', 0)
                                 or not r.get('progress_extraction_next_attempt_at')
                                 or datetime.fromisoformat(r['progress_extraction_next_attempt_at']) <= now)]
                limit = self.params.get('p_limit', 25)
                limit = max(0, min(25 if limit is None else limit, 25))
                return LocalMockResponse(sorted(eligible, key=lambda r: (r.get('created_at', ''), r['id']))[:limit])
            row = next((r for r in tables['field_updates'] if r['id'] == self.params['p_field_update_id']), None)
            revision = self.params.get('p_evidence_revision')
            if row is None or row.get('evidence_revision', 0) != revision:
                return LocalMockResponse([False])
            if row.get('progress_extraction_revision') == revision:
                return LocalMockResponse([self.name == 'complete_field_update_progress_extraction'])
            if self.name == 'fail_field_update_progress_extraction':
                attempts = (min(row.get('progress_extraction_attempts', 0), 2147483646) + 1
                            if row.get('progress_extraction_retry_revision') == revision else 1)
                row.update(progress_extraction_retry_revision=revision, progress_extraction_attempts=attempts,
                           progress_extraction_last_error=(self.params.get('p_error') or 'Extraction failed').strip()[:500],
                           progress_extraction_next_attempt_at=(datetime.now(timezone.utc) + timedelta(
                               seconds=min(1800, 30 * 2 ** min(attempts - 1, 6)))).isoformat())
                self._persist(tables, original)
                return LocalMockResponse([True])
            events = self.params.get('p_events')
            validate_events(events)
            history = tables.setdefault('progress_events', [])
            if any(e['field_update_id'] == row['id'] and e['evidence_revision'] == revision for e in history):
                raise ValueError('Progress event revision already contains history')
            for event in events:
                history.append({**deepcopy(event), 'id': str(uuid4()), 'field_update_id': row['id'],
                                'evidence_revision': revision, 'created_at': datetime.now(timezone.utc).isoformat()})
            row.update(progress_extraction_revision=revision, progress_extraction_retry_revision=None,
                       progress_extraction_attempts=0, progress_extraction_last_error=None,
                       progress_extraction_next_attempt_at=None)
            self._persist(tables, original)
            return LocalMockResponse([True])

    def _persist(self, tables, original):
        self.db.tables = tables
        try:
            self.db.save()
        except Exception:
            self.db.tables = original
            raise
