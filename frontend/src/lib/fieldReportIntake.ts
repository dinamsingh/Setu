import Papa from 'papaparse';

// Intake metadata only: deliberately no Supabase/client, ID, approval or matching imports.
export const INTAKE_LIMITS = Object.freeze({ fileBytes: 2 * 1024 * 1024, rows: 1000, columns: 64, cellChars: 10000 });
// Same vocabulary as the existing supervisor capture screen; no matching taxonomy changes.
export const INTAKE_DISCIPLINES = ['Piping', 'Pipeline', 'Civil', 'Electrical', 'Mechanical', 'Instrumentation'] as const;
export type IntakeDiscipline = typeof INTAKE_DISCIPLINES[number];
export type IntakeField = 'field_text' | 'site_location' | 'reported_date' | 'reported_by' | 'discipline';
export type ColumnMapping = Partial<Record<IntakeField, string | number | null>>;
export interface IntakeOptions {
  columnMapping?: ColumnMapping;
  dateFormat?: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
  /** XLSX sheet name or 1-based index. Defaults to the first sheet, never merges sheets. */
  sheet?: string | number;
}
export interface IntakeData {
  field_text: string;
  site_location: string | null;
  reported_date: string | null;
  reported_by: string | null;
  discipline: IntakeDiscipline | null;
}
export type IntakeErrorCode = 'unsupported_format' | 'file_too_large' | 'empty_file' | 'file_read_error'
  | 'malformed_file' | 'row_limit' | 'column_limit' | 'invalid_mapping' | 'missing_column'
  | 'ambiguous_column' | 'empty_row' | 'malformed_row' | 'required_value' | 'invalid_date'
  | 'unsupported_discipline' | 'invalid_value' | 'cell_too_large' | 'duplicate_row' | 'unsafe_workbook';
export interface IntakeIssue {
  code: IntakeErrorCode;
  message: string;
  /** 1-based worksheet/CSV record, including header. null means a file/header error. */
  rowNumber: number | null;
  field?: IntakeField;
}
export interface IntakePreviewRow {
  rowNumber: number;
  raw: unknown[];
  data: IntakeData;
  errors: IntakeIssue[];
  duplicateOf?: number;
}
export interface IntakeResult {
  format: 'csv' | 'xlsx' | null;
  headers: string[];
  columnMapping: Partial<Record<IntakeField, number>>;
  rows: IntakePreviewRow[];
  errors: IntakeIssue[];
  valid: boolean;
  summary: { totalRows: number; validRows: number; invalidRows: number };
}

const fields: IntakeField[] = ['field_text', 'site_location', 'reported_date', 'reported_by', 'discipline'];
const aliases: Record<IntakeField, string[]> = {
  field_text: ['fieldtext', 'narrative', 'fieldreport', 'fieldupdate', 'description', 'workdescription', 'remarks'],
  site_location: ['sitelocation', 'location', 'site', 'area'],
  reported_date: ['reporteddate', 'reportdate', 'date'],
  reported_by: ['reportedby', 'reporter', 'supervisor', 'fieldengineer'],
  discipline: ['discipline', 'engineeringdiscipline', 'trade'],
};
const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, '');
const issue = (code: IntakeErrorCode, message: string, rowNumber: number | null = null, field?: IntakeField): IntakeIssue =>
  ({ code, message, rowNumber, ...(field ? { field } : {}) });
const empty = (cell: unknown) => cell == null || (typeof cell === 'string' && !cell.trim());
function hasUnsafeControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 && ![9, 10, 13].includes(code)) return true;
  }
  return false;
}

/** Calendar-only normalization: no locale guessing, current-date fallback or timezone conversion. */
export function normalizeIntakeDate(value: unknown, format: IntakeOptions['dateFormat'] = 'YYYY-MM-DD'): string | null {
  let year: number, month: number, day: number;
  if (value instanceof Date) {
    if (!Number.isFinite(value.valueOf()) || value.getUTCHours() || value.getUTCMinutes() || value.getUTCSeconds() || value.getUTCMilliseconds()) return null;
    year = value.getUTCFullYear(); month = value.getUTCMonth() + 1; day = value.getUTCDate();
  } else if (typeof value === 'string') {
    const text = value.trim();
    const parts = (format === 'YYYY-MM-DD' ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{2})\/(\d{2})\/(\d{4})$/).exec(text);
    if (!parts) return null;
    [year, month, day] = format === 'YYYY-MM-DD' ? parts.slice(1).map(Number)
      : format === 'DD/MM/YYYY' ? [Number(parts[3]), Number(parts[2]), Number(parts[1])]
        : [Number(parts[3]), Number(parts[1]), Number(parts[2])];
  } else return null; // Unformatted Excel numbers are not silently interpreted as serial dates.
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function finish(result: IntakeResult): IntakeResult {
  result.errors.push(...result.rows.flatMap(row => row.errors));
  result.summary = { totalRows: result.rows.length, validRows: result.rows.filter(row => !row.errors.length).length,
    invalidRows: result.rows.filter(row => row.errors.length).length };
  result.valid = result.rows.length > 0 && result.errors.length === 0;
  return result;
}

function validateTable(table: unknown[][], result: IntakeResult, options: IntakeOptions, csvErrors: Map<number, IntakeIssue[]>): IntakeResult {
  if (!table.length || table.every(row => row.every(empty))) {
    result.errors.push(issue('empty_file', 'No field reports found.')); return finish(result);
  }
  const header = table[0];
  if (header.length > INTAKE_LIMITS.columns) {
    result.errors.push(issue('column_limit', `Maximum ${INTAKE_LIMITS.columns} columns allowed.`)); return finish(result);
  }
  if (header.some(cell => typeof cell !== 'string' || !cell.trim() || cell.length > INTAKE_LIMITS.cellChars)) {
    result.errors.push(issue('malformed_file', 'Headers must be non-empty text.')); return finish(result);
  }
  result.headers = (header as string[]).map(cell => cell.trim());
  const normalized = result.headers.map(normalizeHeader);
  if (new Set(normalized).size !== normalized.length) {
    result.errors.push(issue('ambiguous_column', 'Duplicate normalized headers; rename them before mapping.')); return finish(result);
  }
  for (const key of Object.keys(options.columnMapping ?? {})) {
    if (!fields.includes(key as IntakeField)) result.errors.push(issue('invalid_mapping', `Unknown destination field: ${key}.`));
  }
  for (const field of fields) {
    const explicit = Object.hasOwn(options.columnMapping ?? {}, field);
    const requested = options.columnMapping?.[field];
    const candidates = explicit ? requested == null ? []
      : typeof requested === 'number' ? [requested]
        : normalized.flatMap((name, index) => name === normalizeHeader(requested) ? [index] : [])
      : normalized.flatMap((name, index) => aliases[field].includes(name) ? [index] : []);
    if (candidates.length > 1) result.errors.push(issue('ambiguous_column', `More than one column maps to ${field}. Choose explicitly.`, null, field));
    else if (candidates.length === 1 && Number.isInteger(candidates[0]) && candidates[0] >= 0 && candidates[0] < header.length) {
      if (Object.values(result.columnMapping).includes(candidates[0])) result.errors.push(issue('invalid_mapping', 'One source column cannot map to two fields.', null, field));
      else result.columnMapping[field] = candidates[0];
    } else if (explicit && requested != null) result.errors.push(issue('invalid_mapping', `Mapped column for ${field} does not exist.`, null, field));
    if (['field_text', 'reported_date'].includes(field) && result.columnMapping[field] == null) {
      result.errors.push(issue('missing_column', `Required column ${field} is missing or unmapped.`, null, field));
    }
  }
  if (result.errors.length) return finish(result); // Keep headers available for a mapping preview; never invent defaults.
  const seen = new Map<string, number>();
  for (let index = 1; index < table.length; index++) {
    const raw = table[index]; const rowNumber = index + 1;
    const errors = [...(csvErrors.get(rowNumber) ?? [])];
    const data: IntakeData = { field_text: '', site_location: null, reported_date: null, reported_by: null, discipline: null };
    if (raw.every(empty)) errors.push(issue('empty_row', 'Empty report row.', rowNumber));
    if (raw.length !== header.length) errors.push(issue('malformed_row', 'Row width differs from the header.', rowNumber));
    if (raw.some(cell => typeof cell === 'string' && cell.length > INTAKE_LIMITS.cellChars)) errors.push(issue('cell_too_large', 'Cell exceeds the intake text limit.', rowNumber));
    for (const field of fields) {
      const column = result.columnMapping[field];
      const cell = column == null ? null : raw[column];
      if (field === 'reported_date') {
        data.reported_date = normalizeIntakeDate(cell, options.dateFormat);
        if (!data.reported_date) errors.push(issue(empty(cell) ? 'required_value' : 'invalid_date', 'A valid report date is required; use the selected date format.', rowNumber, field));
      } else if (field === 'discipline') {
        if (!empty(cell)) {
          const discipline = typeof cell === 'string' ? INTAKE_DISCIPLINES.find(d => d.toLowerCase() === cell.trim().toLowerCase()) : undefined;
          if (!discipline) errors.push(issue('unsupported_discipline', 'Unsupported engineering discipline.', rowNumber, field));
          else data.discipline = discipline;
        }
      } else if (!empty(cell)) {
        if (typeof cell !== 'string' || hasUnsafeControl(cell)) errors.push(issue('invalid_value', 'Expected plain text.', rowNumber, field));
        else data[field] = cell.trim();
      }
    }
    if (!data.field_text) errors.push(issue('required_value', 'Field narrative is required.', rowNumber, 'field_text'));
    const row: IntakePreviewRow = { rowNumber, raw: [...raw], data, errors };
    if (!errors.length) {
      // Normalize formatting only, not narrative case or meaning; never silently discard a duplicate.
      const key = JSON.stringify(fields.map(field => data[field]));
      const previous = seen.get(key);
      if (previous != null) { row.duplicateOf = previous; errors.push(issue('duplicate_row', `Duplicate of report row ${previous}.`, rowNumber)); }
      else seen.set(key, rowNumber);
    }
    result.rows.push(row);
  }
  if (!result.rows.length) result.errors.push(issue('empty_file', 'The file contains headers but no report rows.'));
  return finish(result);
}

/** Parse and validate locally. This API can never submit a report or call Supabase. */
export async function parseFieldReportFile(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>, options: IntakeOptions = {}): Promise<IntakeResult> {
  const extension = /\.([^.]+)$/.exec(file.name)?.[1].toLowerCase();
  const format = extension === 'csv' || extension === 'xlsx' ? extension : null;
  const result: IntakeResult = { format, headers: [], columnMapping: {}, rows: [], errors: [], valid: false,
    summary: { totalRows: 0, validRows: 0, invalidRows: 0 } };
  if (!format) { result.errors.push(issue('unsupported_format', 'Only .csv and .xlsx files are supported.')); return finish(result); }
  if (file.size > INTAKE_LIMITS.fileBytes) { result.errors.push(issue('file_too_large', 'Maximum file size is 2 MiB.')); return finish(result); }
  if (!file.size) { result.errors.push(issue('empty_file', 'The file is empty.')); return finish(result); }
  if (options.dateFormat && !['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'].includes(options.dateFormat)) {
    result.errors.push(issue('invalid_mapping', 'Unsupported date format.')); return finish(result);
  }
  let bytes: ArrayBuffer;
  try { bytes = await file.arrayBuffer(); }
  catch { result.errors.push(issue('file_read_error', 'Could not read the selected file.')); return finish(result); }
  if (bytes.byteLength > INTAKE_LIMITS.fileBytes) { result.errors.push(issue('file_too_large', 'Maximum file size is 2 MiB.')); return finish(result); }
  let table: unknown[][] = [];
  const csvErrors = new Map<number, IntakeIssue[]>();
  try {
    if (format === 'csv') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
      if (text.includes('\0')) throw new Error('Binary CSV');
      if (!text.trim()) { result.errors.push(issue('empty_file', 'No field reports found.')); return finish(result); }
      Papa.parse<string[]>(text, {
        header: false, dynamicTyping: false, skipEmptyLines: false,
        step: (parsed, parser) => {
          table.push(parsed.data);
          // A one-column file is parseable and should expose its missing columns.
          const errors = parsed.errors.filter(error => error.code !== 'UndetectableDelimiter');
          if (errors.length) csvErrors.set(table.length, errors.map(error => issue('malformed_row', error.message, table.length)));
          if (table.length > INTAKE_LIMITS.rows + 2 || parsed.data.length > INTAKE_LIMITS.columns) parser.abort();
        },
      });
      // A single final newline is a record terminator, not an empty field report.
      if (/\r?\n$/.test(text) && table.at(-1)?.length === 1 && table.at(-1)?.[0] === '') table.pop();
    } else {
      const { readIntakeWorkbook } = await import('./intakeWorkbook');
      table = await readIntakeWorkbook(bytes, options.sheet);
    }
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith('INTAKE_LIMIT:') ? 'unsafe_workbook' : 'malformed_file';
    result.errors.push(issue(code, code === 'unsafe_workbook' ? (error as Error).message.slice(13) : 'Could not parse the file. Check its format, encoding and workbook contents.'));
    return finish(result);
  }
  if (table.length - 1 > INTAKE_LIMITS.rows) {
    result.errors.push(issue('row_limit', `Maximum ${INTAKE_LIMITS.rows} report rows allowed; no partial file accepted.`)); return finish(result);
  }
  if (csvErrors.has(1)) { result.errors.push(...csvErrors.get(1)!); return finish(result); }
  return validateTable(table, result, options, csvErrors);
}

export type IntakeCorrections = Partial<Record<number, Partial<Record<IntakeField, string>>>>;

/** Recheck local edits using the same row validator. Never repairs archive/file errors. */
export function revalidateIntakePreview(source: IntakeResult, corrections: IntakeCorrections,
  dateFormat: IntakeOptions['dateFormat'] = 'YYYY-MM-DD'): IntakeResult {
  if (!source.rows.length || source.errors.some(error => error.rowNumber == null)) return source;
  const structuralErrors = new Map<number, IntakeIssue[]>();
  const table: unknown[][] = [fields];
  for (const row of source.rows) {
    const edits = corrections[row.rowNumber] ?? {};
    const retained = row.errors.filter(error => error.code === 'malformed_row');
    // Unmapped source cells still retain their original safety checks.
    if (row.raw.some((cell, index) => typeof cell === 'string' && cell.length > INTAKE_LIMITS.cellChars
      && !Object.values(source.columnMapping).includes(index))) {
      retained.push(issue('cell_too_large', 'An unused source cell exceeds the text limit. Fix the spreadsheet and choose it again.', row.rowNumber));
    }
    structuralErrors.set(row.rowNumber, retained);
    table.push(fields.map(field => Object.hasOwn(edits, field) ? edits[field]
      : source.columnMapping[field] == null ? null : row.raw[source.columnMapping[field]!]));
  }
  const result = validateTable(table, { format: source.format, headers: [], columnMapping: {}, rows: [],
    errors: [], valid: false, summary: { totalRows: 0, validRows: 0, invalidRows: 0 } },
  { dateFormat, columnMapping: Object.fromEntries(fields.map((field, index) => [field, index])) }, structuralErrors);
  // Keep spreadsheet provenance, not the synthetic validation table.
  return { ...result, headers: source.headers, columnMapping: source.columnMapping,
    rows: result.rows.map((row, index) => ({ ...row, raw: source.rows[index].raw })) };
}
