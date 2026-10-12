import type { ImportRequest, ImportSummary } from '../lib/fieldReportImport';

export function completedImport(request: ImportRequest, duplicates = 0, replayed = false): ImportSummary {
  return { status: 'completed', request_id: request.requestId, total_rows: request.rows.length,
    imported_count: request.rows.length - duplicates, duplicate_count: duplicates, error_count: 0, replayed, errors: [],
    rows: request.rows.map((r, i) => ({ row_number: r.row_number, outcome: i < duplicates ? 'duplicate' : 'imported',
      field_update_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, update_id: `UPD-IMP-${i + 1}` })) };
}
