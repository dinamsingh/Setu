// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReportImportWizard } from './ReportImportWizard';
import { FIELD_REPORT_IMPORT_DEPLOYMENT as gate } from '../../lib/fieldReportImportDeployment';
import type { ImportRequest } from '../../lib/fieldReportImport';
import { intakeFile } from '../../test/intakeFixtures';
import { completedImport } from '../../test/importFixtures';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }));
let root: Root; let container: HTMLDivElement;
const cancel = vi.fn(); const completed = vi.fn(); const lock = vi.fn();
const submitter = { id: 'site-user', role: 'site' };
const render = (actor = submitter) => root.render(<ReportImportWizard onCancel={cancel} submitter={actor} onLockChange={lock} onCompleted={completed} />);
beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Real network forbidden')));
  Object.assign(gate, { migration012Verified: true, migration013Verified: true, submissionEnabled: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => render());
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); expect(fetch).not.toHaveBeenCalled();
  Object.assign(gate, { migration012Verified: false, migration013Verified: false, submissionEnabled: false }); vi.unstubAllGlobals(); vi.useRealTimers();
});
const button = (text: string) => {
  const b = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  expect(b, text).toBeTruthy(); return b!;
};
const click = async (text: string) => act(async () => button(text).click());
async function review(csv = 'field_text,reported_date\nWork A,2026-10-11') {
  const input = container.querySelector('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [intakeFile(csv)] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await click('Map columns'); await click('Review reports');
}
async function editNarrative(value: string) {
  const input = container.querySelector<HTMLTextAreaElement>('#row-2-field_text')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const ack = async () => act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
function response(duplicates = 0, replayed = false) {
  rpc.mockImplementation((_name, args) => Promise.resolve({ data: completedImport({ requestId: args.p_request_id,
    sourceFormat: args.p_source_format, rows: args.p_rows } as ImportRequest, duplicates, replayed), error: null, status: 200 }));
}
it('defaults to locked submission when deployment is not verified and never calls RPC', async () => {
  gate.submissionEnabled = false; await review();
  expect(button('Continue to confirmation').disabled).toBe(true); await click('Continue to confirmation');
  expect(container.textContent).toContain('Submission locked'); expect(rpc).not.toHaveBeenCalled();
});
it('requires explicit confirmation and sends corrected normalized rows, not raw spreadsheet cells', async () => {
  response(); await review(); await editNarrative('Corrected welding finished'); await click('Continue to confirmation');
  expect(rpc).not.toHaveBeenCalled(); expect(button('Confirm import').disabled).toBe(true);
  expect(document.activeElement?.textContent).toBe('Confirm these field reports');
  await ack(); await click('Confirm import');
  expect(rpc).toHaveBeenCalledOnce(); expect(rpc.mock.calls[0][1].p_rows[0].field_text).toBe('Corrected welding finished');
  expect(container.textContent).toContain('1 imported · 0 duplicate · 0 errors'); expect(completed).toHaveBeenCalledOnce();
  expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Confirm import')).toBe(false);
});
it('cancels confirmation without RPC and preserves corrections on return to review', async () => {
  await review(); await editNarrative('Draft correction'); await click('Continue to confirmation'); await click('Cancel confirmation');
  expect(container.querySelector<HTMLTextAreaElement>('#row-2-field_text')?.value).toBe('Draft correction');
  await click('Cancel'); expect(cancel).toHaveBeenCalledOnce(); expect(rpc).not.toHaveBeenCalled();
});
it.each(['field_text,reported_date\n,2026-10-11', 'field_text,reported_date\nWork A,2026-10-11\nWork A,2026-10-11'])('does not skip invalid or duplicate preview rows: %s', async csv => {
  await review(csv); expect(button('Continue to confirmation').disabled).toBe(true);
  expect(container.textContent).toContain('No rows will be silently skipped'); expect(rpc).not.toHaveBeenCalled();
});
it('shows partial duplicates and per-row outcomes from a verified successful RPC response', async () => {
  response(1); await review('field_text,reported_date\nWork A,2026-10-11\nWork B,2026-10-11');
  await click('Continue to confirmation'); await ack(); await click('Confirm import');
  expect(container.textContent).toContain('1 imported · 1 duplicate · 0 errors');
  expect(container.textContent).toContain('Row 2 · duplicate'); expect(container.textContent).toContain('Row 3 · imported');
});
it('locks edits/navigation during submission and uncertain outcomes; retries exact key and rows', async () => {
  let finish: (v: unknown) => void = () => {};
  rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await review(); await click('Continue to confirmation'); await ack();
  await click('Confirm import');
  expect(button('Submitting reports…').disabled).toBe(true); expect(button('Cancel').disabled).toBe(true);
  expect(container.querySelector('fieldset')?.disabled).toBe(true); expect(lock).toHaveBeenLastCalledWith(true);
  await act(async () => finish({ data: null, error: { code: '', message: 'Connection lost' }, status: 0 }));
  expect(container.textContent).toContain('Outcome unknown — not confirmed'); expect(completed).not.toHaveBeenCalled();
  expect(button('Return to review').disabled).toBe(true); expect(button('Back').disabled).toBe(true);
  const first = rpc.mock.calls[0]; response(1,true); await click('Retry same request');
  expect(rpc.mock.calls[1]).toEqual(first); expect(container.textContent).toContain('0 imported · 1 duplicate · 0 errors');
  expect(container.textContent).toContain('Retry confirmed'); await click('Close summary'); expect(lock).toHaveBeenLastCalledWith(false);
});
it('shows server rejection accurately and permits correction with a new request UUID', async () => {
  rpc.mockImplementation((_name, args) => Promise.resolve({ data: { ...completedImport({ requestId: args.p_request_id,
    sourceFormat: args.p_source_format, rows: args.p_rows }), status: 'rejected', imported_count: 0, error_count: 1, rows: [],
    errors: [{ row_number: 2, input_index: 1, field: 'field_text', code: 'invalid_text', message: 'Please correct narrative' }] }, error: null, status: 200 }));
  await review(); await click('Continue to confirmation'); await ack(); await click('Confirm import');
  expect(container.textContent).toContain('Batch rejected · 0 imported · 1 invalid rows'); expect(completed).not.toHaveBeenCalled();
  const firstId = rpc.mock.calls[0][1].p_request_id; await click('Return to review'); await editNarrative('Corrected B');
  response(); await click('Continue to confirmation'); await ack(); await click('Confirm import');
  expect(rpc.mock.calls[1][1].p_request_id).not.toBe(firstId);
});
it('surfaces authorization/RPC failures and preserves the request for retry', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Site role required' }, status: 403 });
  await review(); await click('Continue to confirmation'); await ack(); await click('Confirm import');
  expect(container.textContent).toContain('Site role required'); expect(completed).not.toHaveBeenCalled();
  const first = rpc.mock.calls[0]; response(); await click('Retry same request'); expect(rpc.mock.calls[1]).toEqual(first);
});
it('malformed success replies remain uncertain, never success', async () => {
  rpc.mockResolvedValue({ data: { status: 'completed' }, error: null, status: 200 });
  await review(); await click('Continue to confirmation'); await ack(); await click('Confirm import');
  expect(container.textContent).toContain('Outcome unknown'); expect(completed).not.toHaveBeenCalled();
});
it('turns a hung response into an uncertain outcome and safely ignores a late completion', async () => {
  let finish: (v: unknown) => void = () => {};
  rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await review(); await click('Continue to confirmation'); await ack(); vi.useFakeTimers(); await click('Confirm import');
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(container.textContent).toContain('Outcome unknown'); expect(completed).not.toHaveBeenCalled();
  const args = rpc.mock.calls[0][1];
  await act(async () => finish({ data: completedImport({ requestId: args.p_request_id, sourceFormat: args.p_source_format, rows: args.p_rows }), error: null, status: 200 }));
  expect(container.textContent).toContain('Outcome unknown'); expect(completed).not.toHaveBeenCalled();
  response(1,true); await click('Retry same request'); expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
});
it('suppresses rapid double-clicks synchronously before the button rerenders', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: '', message: 'Offline' }, status: 0 });
  await review(); await click('Continue to confirmation'); await ack();
  const confirm = button('Confirm import');
  await act(async () => { confirm.click(); confirm.click(); });
  expect(rpc).toHaveBeenCalledOnce(); expect(container.textContent).toContain('Outcome unknown');
});
it('blocks retries after an account switch and rejects planner clients before RPC', async () => {
  await review(); await click('Continue to confirmation'); await ack();
  await act(async () => render({ id: 'different-user', role: 'site' }));
  expect(button('Confirm import').disabled).toBe(true); await click('Confirm import'); expect(rpc).not.toHaveBeenCalled();
  await click('Cancel confirmation'); await act(async () => render({ id: 'planner', role: 'planner' }));
  expect(button('Continue to confirmation').disabled).toBe(true);
});
