import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIELD_REPORT_IMPORT_DEPLOYMENT as gate, isFieldReportImportEnabled } from './fieldReportImportDeployment';
import { prepareFieldReportImport, submitFieldReportImport } from './fieldReportImport';
import { parseFieldReportFile } from './fieldReportIntake';
import { intakeFile } from '../test/intakeFixtures';
import { completedImport } from '../test/importFixtures';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ supabase: { rpc } }));
const request = async () => prepareFieldReportImport(await parseFieldReportFile(intakeFile('field_text,reported_date\nWork A,2026-10-11')));
beforeEach(() => {
  rpc.mockReset(); Object.assign(gate, { migration012Verified: true, migration013Verified: true, submissionEnabled: true });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Real network forbidden')));
});
afterEach(() => {
  Object.assign(gate, { migration012Verified: false, migration013Verified: false, submissionEnabled: false });
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
describe('typed secure import adapter (Supabase mocked)', () => {
  it.each(Array.from({ length: 8 }, (_, n) => [!!(n & 4), !!(n & 2), !!(n & 1)]))('gate requires all three explicit attestations: %s/%s/%s', (a, b, c) => {
    Object.assign(gate, { migration012Verified: a, migration013Verified: b, submissionEnabled: c });
    expect(isFieldReportImportEnabled()).toBe(a && b && c);
  });
  it('fails closed in the adapter itself, not just via disabled UI', async () => {
    gate.submissionEnabled = false;
    expect((await submitFieldReportImport(await request())).kind).toBe('disabled'); expect(rpc).not.toHaveBeenCalled();
  });
  it('whitelists normalized original fields and freezes the request payload', async () => {
    const preview = await parseFieldReportFile(intakeFile('field_text,reported_date\nWork A,2026-10-11'));
    Object.assign(preview.rows[0].data, { status: 'approved', matched_activity_id: 'evil' });
    const next = prepareFieldReportImport(preview);
    expect(Object.keys(next.rows[0]).sort()).toEqual(['discipline','field_text','reported_by','reported_date','row_number','site_location']);
    expect(Object.isFrozen(next.rows[0]) && Object.isFrozen(next.rows) && Object.isFrozen(next)).toBe(true);
  });
  it.each(['field_text,reported_date\n,2026-10-11', 'field_text,reported_date\nA,2026-02-29', 'field_text,reported_date\nA,2026-10-11\nA,2026-10-11'])('rejects invalid or duplicate local rows without RPC: %s', async csv => {
    const preview = await parseFieldReportFile(intakeFile(csv));
    expect(() => prepareFieldReportImport(preview)).toThrow(/Correct every/); expect(rpc).not.toHaveBeenCalled();
  });
  it('makes one named RPC call and verifies the correlated successful summary', async () => {
    const next = await request(); const summary = completedImport(next);
    rpc.mockResolvedValue({ data: summary, error: null, status: 200 });
    expect(await submitFieldReportImport(next)).toEqual({ kind: 'completed', summary });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('import_field_reports', { p_request_id: next.requestId, p_source_format: 'csv', p_rows: next.rows });
  });
  it('treats a server row rejection as zero-write rejection, not success', async () => {
    const next = await request(); const summary = { ...completedImport(next), status: 'rejected', imported_count: 0,
      error_count: 1, rows: [], errors: [{ row_number: 2, input_index: 1, field: 'discipline', code: 'unsupported_discipline', message: 'Invalid discipline' }] };
    rpc.mockResolvedValue({ data: summary, error: null, status: 200 });
    expect(await submitFieldReportImport(next)).toEqual({ kind: 'rejected', summary });
  });
  it.each([0, 408, 502, 504])('marks ambiguous transport status %s as uncertain', async status => {
    rpc.mockResolvedValue({ data: null, error: { code: '', message: 'Transport error' }, status });
    expect((await submitFieldReportImport(await request())).kind).toBe('uncertain'); expect(rpc).toHaveBeenCalledOnce();
  });
  it('marks thrown network failures as uncertain with no automatic retry', async () => {
    rpc.mockRejectedValue(new TypeError('Network failure'));
    expect((await submitFieldReportImport(await request())).kind).toBe('uncertain'); expect(rpc).toHaveBeenCalledOnce();
  });
  it.each(['FETCH', '08006'])('keeps connection/proxy code %s uncertain, not definitively rejected', async code => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'Connection interrupted' }, status: 503 });
    expect((await submitFieldReportImport(await request())).kind).toBe('uncertain');
  });
  it.each([['42501',403], ['PGRST202',404], ['40001',500], ['P0001',400]])('surfaces definitive server error %s/%s', async (code, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'Server refused request' }, status });
    expect(await submitFieldReportImport(await request())).toEqual({ kind: 'error', message: 'Server refused request' });
  });
  it.each(['null', 'wrongRequest', 'counts', 'missingRows', 'duplicateRowNumbers', 'missingId', 'replayedWithImport', 'unknownStatus', 'rejectedWithImport'])('never claims success for an invalid response: %s', async failure => {
    const next = prepareFieldReportImport(await parseFieldReportFile(intakeFile('field_text,reported_date\nA,2026-10-11\nB,2026-10-11')));
    const data = completedImport(next);
    if (failure === 'wrongRequest') data.request_id = crypto.randomUUID();
    if (failure === 'counts') data.imported_count = 99;
    if (failure === 'missingRows') data.rows = [];
    if (failure === 'duplicateRowNumbers') data.rows[1].row_number = 2;
    if (failure === 'missingId') data.rows[0].field_update_id = '';
    if (failure === 'replayedWithImport') data.replayed = true;
    if (failure === 'unknownStatus') Object.assign(data, { status: 'success' });
    if (failure === 'rejectedWithImport') data.status = 'rejected';
    rpc.mockResolvedValue({ data: failure === 'null' ? null : data, error: null, status: 200 });
    expect((await submitFieldReportImport(next)).kind).toBe('uncertain');
  });
  it('retries the same frozen request and accepts replay as zero new imports', async () => {
    const next = await request(); rpc.mockRejectedValueOnce(new Error('Lost response'))
      .mockResolvedValueOnce({ data: completedImport(next,1,true), error: null, status: 200 });
    expect((await submitFieldReportImport(next)).kind).toBe('uncertain');
    const result = await submitFieldReportImport(next);
    expect(result.kind).toBe('completed'); expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    if ('summary' in result) expect(result.summary.imported_count).toBe(0);
  });
});
