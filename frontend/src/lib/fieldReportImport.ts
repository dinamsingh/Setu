import { INTAKE_DISCIPLINES, INTAKE_LIMITS, normalizeIntakeDate, type IntakeData, type IntakeResult } from './fieldReportIntake';
import { isFieldReportImportEnabled } from './fieldReportImportDeployment';
import { supabase } from './supabase';

export interface ImportRow extends Omit<IntakeData, 'reported_date'> { row_number: number; reported_date: string }
export interface ImportRequest { requestId: string; sourceFormat: 'csv' | 'xlsx'; rows: ImportRow[] }
export interface ImportRowOutcome { row_number: number; outcome: 'imported' | 'duplicate'; field_update_id: string; update_id: string }
export interface ImportRowError { row_number: number; input_index: number; field: string | null; code: string; message: string }
export interface ImportSummary {
  status: 'completed' | 'rejected'; request_id: string; total_rows: number; imported_count: number;
  duplicate_count: number; error_count: number; replayed: boolean; rows: ImportRowOutcome[]; errors: ImportRowError[];
}
export type ImportResult = { kind: 'completed' | 'rejected'; summary: ImportSummary }
  | { kind: 'disabled' | 'error' | 'uncertain'; message: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;

/** Whitelist corrected, normalized data. Never silently drop invalid/duplicate rows. */
export function prepareFieldReportImport(preview: IntakeResult): ImportRequest {
  if (!preview.valid || preview.errors.length || !preview.format || !preview.rows.length
    || preview.rows.length > INTAKE_LIMITS.rows || preview.rows.some(r => r.errors.length || r.duplicateOf != null)) {
    throw new Error('Correct every invalid or duplicate row before confirming.');
  }
  const rows = preview.rows.map(({ rowNumber, data }) => {
    const { field_text, reported_date, site_location, reported_by, discipline } = data;
    if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > 1001 || !field_text?.trim()
      || !reported_date || normalizeIntakeDate(reported_date) !== reported_date
      || (discipline != null && !INTAKE_DISCIPLINES.includes(discipline))
      || [field_text, site_location, reported_by, discipline].some(v => v != null && (typeof v !== 'string' || v.length > INTAKE_LIMITS.cellChars))) {
      throw new Error('The preview contains invalid report values. Return to review.');
    }
    return { row_number: rowNumber, field_text, reported_date, site_location, reported_by, discipline };
  });
  if (new Set(rows.map(r => r.row_number)).size !== rows.length) throw new Error('Source row numbers must be unique.');
  // No timestamp/random-number fallback: fail closed without secure UUID support.
  const request = { requestId: crypto.randomUUID(), sourceFormat: preview.format, rows };
  rows.forEach(Object.freeze); Object.freeze(rows); Object.freeze(request);
  return request;
}

/** Validate response correlation/counts/row identities before declaring success. */
function decodeSummary(data: unknown, request: ImportRequest): ImportSummary | null {
  if (!record(data) || !['completed', 'rejected'].includes(String(data.status)) || data.request_id !== request.requestId
    || data.total_rows !== request.rows.length || !count(data.imported_count) || !count(data.duplicate_count)
    || !count(data.error_count) || typeof data.replayed !== 'boolean' || !Array.isArray(data.rows) || !Array.isArray(data.errors)) return null;
  const numbers = new Set(request.rows.map(r => r.row_number));
  if (data.status === 'completed') {
    if (data.error_count !== 0 || data.errors.length || data.imported_count + data.duplicate_count !== request.rows.length
      || data.rows.length !== request.rows.length || (data.replayed && data.imported_count !== 0)) return null;
    for (const row of data.rows) {
      if (!record(row) || !numbers.delete(Number(row.row_number)) || typeof row.row_number !== 'number'
        || !['imported', 'duplicate'].includes(String(row.outcome)) || typeof row.field_update_id !== 'string'
        || !uuid.test(row.field_update_id) || typeof row.update_id !== 'string' || !row.update_id) return null;
    }
    if (data.rows.filter(r => r.outcome === 'imported').length !== data.imported_count) return null;
  } else {
    if (data.imported_count !== 0 || data.duplicate_count !== 0 || data.rows.length || data.replayed
      || data.error_count < 1 || data.error_count > request.rows.length || !data.errors.length) return null;
    const invalidIndices = new Set<number>();
    for (const error of data.errors) {
      if (!record(error) || !count(error.input_index) || error.input_index < 1 || error.input_index > request.rows.length
        || error.row_number !== request.rows[error.input_index - 1].row_number
        || (error.field !== null && typeof error.field !== 'string') || typeof error.code !== 'string'
        || typeof error.message !== 'string') return null;
      invalidIndices.add(error.input_index);
    }
    if (invalidIndices.size !== data.error_count) return null;
  }
  return data as unknown as ImportSummary;
}

/** Exactly one POST. Manual retries reuse the frozen request; no automatic retry. */
export async function submitFieldReportImport(request: ImportRequest): Promise<ImportResult> {
  if (!isFieldReportImportEnabled()) return { kind: 'disabled', message: 'Submission is locked until migrations 012 and 013 are verified and explicitly enabled.' };
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const { data, error, status } = await Promise.race([
      supabase.rpc('import_field_reports', {
        p_request_id: request.requestId, p_source_format: request.sourceFormat, p_rows: request.rows,
      }),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Import response timeout')), 30000); }),
    ]);
    if (error) {
      // Structured SQLSTATE/PGRST failures mean the transaction failed. Gateway,
      // fetch/abort failures and ambiguous replies cannot establish commit state.
      const known = status >= 400 && status !== 408 && status !== 504
        && /^(?:[0-9][0-9A-Z]{4}|P0[0-9A-Z]{3}|XX[0-9A-Z]{3}|PGRST\d{3})$/.test(error.code ?? '')
        && !/^08/.test(error.code ?? '');
      return known ? { kind: 'error', message: error.message || 'The server rejected the request. No reports were imported.' }
        : { kind: 'uncertain', message: 'SETU could not confirm the outcome. Some reports may already be saved. Retry the same request.' };
    }
    const summary = status >= 200 && status < 300 ? decodeSummary(data, request) : null;
    return summary ? { kind: summary.status, summary }
      : { kind: 'uncertain', message: 'The server response could not be verified. Retry the same request; do not start another import.' };
  } catch {
    return { kind: 'uncertain', message: 'The connection failed before SETU could confirm the outcome. Retry the same request.' };
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }
}
