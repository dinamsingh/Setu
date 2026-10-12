// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FieldCapture } from './FieldCapture';
import { intakeFile } from '../../test/intakeFixtures';
import { FIELD_REPORT_IMPORT_DEPLOYMENT as gate } from '../../lib/fieldReportImportDeployment';
import { completedImport } from '../../test/importFixtures';

const state = vi.hoisted(() => ({ submit: vi.fn(), act: vi.fn(), signOut: vi.fn(), rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: state.rpc } }));
vi.mock('../../hooks/useFieldUpdates', () => ({ useFieldUpdates: () => ({ updates: [], loading: false, error: null, refetch: vi.fn(), submitFieldUpdate: state.submit }) }));
vi.mock('../../hooks/useWorkflow', () => ({ useWorkflow: () => ({ rounds: [], loading: false, error: null, act: state.act }) }));
vi.mock('../../lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'site', email: 'site@example.test' }, role: 'site', signOut: state.signOut }) }));
let root: Root; let container: HTMLDivElement;
beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><FieldCapture /></MemoryRouter>));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  Object.assign(gate, { migration012Verified: false, migration013Verified: false, submissionEnabled: false });
});
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text || b.getAttribute('aria-label') === text);
  expect(button, text).toBeTruthy(); await act(async () => button!.click());
}
async function edit(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)!;
  expect(input, selector).toBeTruthy();
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function openImport() {
  await click('Add attachment'); await click('Import Excel / CSV');
}
async function chooseFile() {
  const fileInput = container.querySelector('input[type="file"]')!;
  Object.defineProperty(fileInput, 'files', { value: [intakeFile('field_text,reported_date\nImported report,2026-10-11')] });
  await act(async () => { fileInput.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function draft() {
  await click('New field update');
  await edit('#field-report', 'Unsent original field narrative');
  await edit('[aria-label="Site location"]', 'Rack C');
  await edit('[aria-label="Reported date"]', '2026-10-08');
  await edit('[aria-label="Engineering discipline"]', 'Instrumentation');
  const reporter = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Reporting as'))!;
  await act(async () => reporter.click()); await edit('#reporter-name', 'A. Das (Field Engineer)');
}
function expectDraft() {
  expect(container.querySelector<HTMLTextAreaElement>('#field-report')?.value).toBe('Unsent original field narrative');
  expect(container.querySelector<HTMLInputElement>('[aria-label="Site location"]')?.value).toBe('Rack C');
  expect(container.querySelector<HTMLInputElement>('[aria-label="Reported date"]')?.value).toBe('2026-10-08');
  expect(container.querySelector<HTMLSelectElement>('[aria-label="Engineering discipline"]')?.value).toBe('Instrumentation');
  expect(container.querySelector<HTMLInputElement>('#reporter-name')?.value).toBe('A. Das (Field Engineer)');
}
it('preserves the manual draft after a confirmed import and blocks parent navigation until resolved', async () => {
  Object.assign(gate, { migration012Verified: true, migration013Verified: true, submissionEnabled: true });
  state.rpc.mockImplementation((_name, args) => Promise.resolve({ data: completedImport({ requestId: args.p_request_id,
    sourceFormat: args.p_source_format, rows: args.p_rows }), error: null, status: 200 }));
  await draft(); await openImport(); await chooseFile(); await click('Map columns'); await click('Review reports');
  await click('Continue to confirmation');
  expect(container.querySelector<HTMLButtonElement>('[aria-label="SETU Site Log home"]')?.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Account and sign out"]')?.disabled).toBe(true);
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click('Confirm import'); expect(state.rpc).toHaveBeenCalledOnce(); expect(state.submit).not.toHaveBeenCalled();
  expect(container.textContent).toContain('1 imported · 0 duplicate · 0 errors');
  await click('Close summary'); await click('Cancel'); expectDraft();
  expect(container.querySelector<HTMLButtonElement>('[aria-label="SETU Site Log home"]')?.disabled).toBe(false);
});
it('removes home import entry and opens the existing wizard only through the composer attachment menu', async () => {
  expect(container.textContent).toContain('New field update');
  expect(container.textContent).not.toContain('Import reports');
  expect(container.querySelector('[aria-label="Add attachment"]')).toBeNull();
  await click('New field update'); await click('Add attachment');
  expect(container.querySelectorAll('[role="menuitem"]')).toHaveLength(1);
  expect(container.querySelector('[role="menuitem"]')?.textContent).toContain('Multiple field reports');
  expect(container.querySelector('[aria-label="Add attachment"]')?.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(container.querySelector('[role="menuitem"]'));
  await click('Import Excel / CSV');
  expect(container.querySelector('main')?.className).toContain('max-w-6xl');
  expect(container.querySelector('[aria-label="Field report import"]')).toBeTruthy();
  expect(container.textContent).toContain('Import multiple field reports');
  expect(container.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('.csv,.xlsx');
  expect(container.querySelector('input[type="file"]')?.getAttribute('value')).toBeNull();
  expect(container.querySelector('form')).toBeNull();
  await click('Cancel'); expect(container.querySelector('#site-log-compose')).toBeTruthy();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Add attachment');
  expect(container.querySelector('[role="menu"]')).toBeNull();
});
it('keeps My updates, Account and home navigation intact', async () => {
  await click('My updates'); expect(container.querySelector('h1')?.textContent).toBe('My updates');
  await click('Account'); expect(container.querySelector('h1')?.textContent).toBe('Account');
  await click('SETU Site Log home'); expect(container.querySelector('h1')?.textContent).toBe('Site Log');
});
it('never invokes supervisor submission or workflow writes during import review', async () => {
  await click('New field update'); await openImport(); await chooseFile();
  await click('Map columns'); await click('Review reports'); await click('Cancel');
  expect(state.submit).not.toHaveBeenCalled(); expect(state.act).not.toHaveBeenCalled(); expect(state.signOut).not.toHaveBeenCalled();
});
it.each(['file', 'mapping', 'review'])('Cancel from %s restores every unsent draft value and reporter expansion', async step => {
  await draft(); await openImport();
  if (step !== 'file') { await chooseFile(); await click('Map columns'); }
  if (step === 'review') await click('Review reports');
  await click('Cancel'); expectDraft();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Add attachment');
  expect(state.submit).not.toHaveBeenCalled(); expect(state.act).not.toHaveBeenCalled();
});
it('the wizard return link and internal Back navigation preserve the composer draft', async () => {
  await draft(); await openImport(); await chooseFile(); await click('Map columns'); await click('Back');
  await click('New field update'); expectDraft();
  expect(container.querySelector('[aria-label="Field report import"]')).toBeNull();
});
it('supports arrow-key opening, Escape dismissal and focus restoration without submitting', async () => {
  await click('New field update');
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Add attachment"]')!;
  expect(trigger.type).toBe('button'); expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
  await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
  const menuitem = container.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  expect(menuitem.type).toBe('button'); expect(document.activeElement).toBe(menuitem);
  await act(async () => { menuitem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(container.querySelector('[role="menu"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false'); expect(state.submit).not.toHaveBeenCalled();
});
it('dismisses the menu on outside pointer and focus-away while preserving draft text', async () => {
  await draft(); await click('Add attachment');
  await act(async () => { container.querySelector('#field-report')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
  expect(container.querySelector('[role="menu"]')).toBeNull(); expectDraft();
  await click('Add attachment');
  await act(async () => { container.querySelector<HTMLInputElement>('[aria-label="Reported date"]')!.focus(); });
  expect(container.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Reported date');
});
it('keeps ordinary text submission separate and unchanged after returning from import', async () => {
  await draft(); await openImport(); await click('Cancel');
  expect(state.submit).not.toHaveBeenCalled();
  state.submit.mockResolvedValueOnce({ success: false, error: 'Mock-only submission failure' });
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(state.submit).toHaveBeenCalledTimes(1);
  expect(state.submit).toHaveBeenCalledWith({ fieldText: 'Unsent original field narrative', siteLocation: 'Rack C', reportedDate: '2026-10-08', reportedBy: 'A. Das (Field Engineer)' });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Mock-only submission failure'); expectDraft();
});
it('does not allow opening attachments while the existing text submission is in flight', async () => {
  await draft();
  let finish: (value: { success: boolean; error: string }) => void = () => {};
  state.submit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Add attachment"]')?.disabled).toBe(true);
  await click('Add attachment'); expect(container.querySelector('[role="menu"]')).toBeNull();
  await act(async () => finish({ success: false, error: 'Mock-only failure' }));
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Add attachment"]')?.disabled).toBe(false);
});
