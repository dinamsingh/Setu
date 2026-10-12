// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportImportWizard } from './ReportImportWizard';
import { intakeFile, intakeXlsx } from '../../test/intakeFixtures';
import * as intake from '../../lib/fieldReportIntake';
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

let root: Root; let container: HTMLDivElement;
const cancel = vi.fn();
beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  cancel.mockReset();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<ReportImportWizard onCancel={cancel} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
function button(text: string) {
  const result = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
  expect(result, text).toBeTruthy(); return result!;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function choose(file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
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
async function review(csv = 'field_text,reported_date\nWelding completed,2026-10-11') {
  await choose(intakeFile(csv)); await click('Map columns'); await click('Review reports');
}
const count = (label: string) => container.querySelector(`[data-count="${label}"]`)?.textContent;

describe('local-only report import wizard', () => {
  it('starts at file selection, disables progression, and provides accessible navigation', () => {
    expect(button('Map columns').disabled).toBe(true);
    expect(container.querySelector('ol [aria-current="step"]')?.textContent).toContain('Choose file');
    expect(document.activeElement).toBe(container.querySelector('h1'));
    expect(container.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('.csv,.xlsx');
  });
  it('labels its exit as New field update and uses the same local cancellation callback', async () => {
    expect(container.textContent).toContain('Your unsent field update stays separate.');
    await click('New field update'); expect(cancel).toHaveBeenCalledOnce();
  });
  it('detects known columns, marks required vs optional, and enters review without submission', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network allowed'));
    await choose(intakeFile('Narrative,Date,Site\nWelding completed,2026-10-11,Rack B'));
    await click('Map columns');
    expect(container.querySelector<HTMLSelectElement>('#map-field_text')?.value).toBe('0');
    expect(container.querySelector<HTMLSelectElement>('#map-reported_date')?.value).toBe('1');
    expect(container.textContent).toContain('Required'); expect(container.textContent).toContain('Optional');
    await click('Review reports');
    expect(count('Total rows')).toBe('1'); expect(count('Valid locally')).toBe('1');
    expect(container.textContent).toContain('Submission locked');
    expect(container.textContent).toContain('Nothing has been uploaded, saved or sent for matching.');
    expect(container.querySelector('button[type="submit"]')).toBeNull(); expect(network).not.toHaveBeenCalled();
  });
  it('supports real XLSX files through the unchanged safety reader', async () => {
    await choose(intakeXlsx());
    // The real reader loads asynchronously; wait for completion without fixed sleeps.
    await vi.waitFor(() => expect(button('Map columns').disabled).toBe(false));
    await click('Map columns'); await click('Review reports');
    expect(count('Valid locally')).toBe('1'); expect(container.textContent).toContain('reports.xlsx');
  });
  it('does not guess ambiguous narrative mappings and requires explicit resolution', async () => {
    await choose(intakeFile('Narrative,Description,Date\nWelding completed,Other evidence,2026-10-11'));
    await click('Map columns');
    expect(container.querySelector<HTMLSelectElement>('#map-field_text')?.value).toBe('');
    expect(button('Review reports').disabled).toBe(true);
    await edit('#map-field_text', '1'); await click('Review reports');
    expect(container.querySelector<HTMLTextAreaElement>('#row-2-field_text')?.value).toBe('Other evidence');
  });
  it('maps unknown headers and prevents reuse of one source column', async () => {
    await choose(intakeFile('Notes,Day,Place\nWelding completed,2026-10-11,Rack B')); await click('Map columns');
    expect(button('Review reports').disabled).toBe(true);
    await edit('#map-field_text', '0'); await edit('#map-reported_date', '0');
    expect(button('Review reports').disabled).toBe(true);
    await edit('#map-reported_date', '1'); await edit('#map-site_location', '2'); await click('Review reports');
    expect(count('Valid locally')).toBe('1');
  });
  it('allows optional columns to be skipped and optional values to be corrected locally', async () => {
    await choose(intakeFile('field_text,reported_date,Location\nWork A,2026-10-11,Wrong place')); await click('Map columns');
    await edit('#map-site_location', ''); await click('Review reports');
    expect(container.querySelector<HTMLInputElement>('[aria-label="Row 2 Site / area"]')?.value).toBe('');
    await edit('[aria-label="Row 2 Site / area"]', 'Rack C');
    await edit('[aria-label="Row 2 Reported by"]', 'R. Das'); await edit('[aria-label="Row 2 Discipline"]', 'Piping');
    expect(count('Valid locally')).toBe('1');
    await edit('#row-2-field_text', ''); expect(count('Valid locally')).toBe('0');
    expect(container.querySelector('#row-2-field_text')?.getAttribute('aria-invalid')).toBe('true');
  });
  it('requires explicit date order, and revalidates after date-format changes', async () => {
    await choose(intakeFile('field_text,reported_date\nWelding completed,11/10/2026')); await click('Map columns');
    await edit('[aria-label="Spreadsheet date format"]', 'DD/MM/YYYY'); await click('Review reports');
    expect(count('Valid locally')).toBe('1');
    await edit('[aria-label="Row 2 Report date"]', '31/02/2026');
    expect(count('Needs correction')).toBe('1');
  });
  it('corrects required narrative, invalid date and unsupported discipline immediately', async () => {
    await review('field_text,reported_date,discipline\n,2026-02-29,Mining');
    expect(count('Needs correction')).toBe('1');
    expect(container.querySelector<HTMLInputElement>('[aria-label="Row 2 Report date"]')?.value).toBe('2026-02-29');
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Row 2 Discipline"]')?.value).toBe('Mining');
    await edit('#row-2-field_text', 'Foundation finished'); await edit('[aria-label="Row 2 Report date"]', '2024-02-29');
    await edit('[aria-label="Row 2 Discipline"]', 'Civil');
    expect(count('Valid locally')).toBe('1'); expect(count('Needs correction')).toBe('0');
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
  });
  it('counts duplicates as invalid, resolves them, and catches duplicates introduced by correction', async () => {
    await review('field_text,reported_date\nWork A,2026-10-11\nWork A,2026-10-11');
    expect(count('Duplicates')).toBe('1'); expect(count('Valid locally')).toBe('1'); expect(count('Needs correction')).toBe('1');
    expect(container.querySelector('[data-testid="intake-row-3"]')?.textContent).toContain('Duplicate of report row 2');
    await edit('#row-3-field_text', 'Work B'); expect(count('Duplicates')).toBe('0'); expect(count('Valid locally')).toBe('2');
    await edit('#row-3-field_text', 'Work A'); expect(count('Duplicates')).toBe('1'); expect(count('Needs correction')).toBe('1');
  });
  it('keeps malformed rows blocked even after values are corrected', async () => {
    await review('field_text,reported_date\nWork A');
    await edit('[aria-label="Row 2 Report date"]', '2026-10-11');
    expect(count('Valid locally')).toBe('0'); expect(container.textContent).toContain('Fix this row in the source spreadsheet');
  });
  it('preserves local corrections through Back, but clears them when a mapping changes', async () => {
    await review('field_text,reported_date,Notes\nWork A,2026-10-11,Work B');
    await edit('#row-2-field_text', 'Local correction'); await click('Back'); await click('Review reports');
    expect(container.querySelector<HTMLTextAreaElement>('#row-2-field_text')?.value).toBe('Local correction');
    await click('Back'); await edit('#map-field_text', '2'); await click('Review reports');
    expect(container.querySelector<HTMLTextAreaElement>('#row-2-field_text')?.value).toBe('Work B');
  });
  it('Change file resets mappings and corrections, including retrying the same file', async () => {
    await review(); await edit('#row-2-field_text', 'Local correction'); await click('Change file');
    expect(button('Map columns').disabled).toBe(true); expect(container.textContent).not.toContain('reports.csv');
    await review(); expect(container.querySelector<HTMLTextAreaElement>('#row-2-field_text')?.value).toBe('Welding completed');
  });
  it('provides Cancel at every step and Back reaches file selection without losing the chosen file', async () => {
    await choose(intakeFile('field_text,reported_date\nWork A,2026-10-11')); await click('Map columns'); await click('Back');
    expect(container.textContent).toContain('reports.csv'); expect(button('Map columns').disabled).toBe(false);
    await click('Cancel'); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([
    ['bad.xls', 'text', 'Only .csv and .xlsx'],
    ['empty.csv', '', 'The file is empty'],
    ['bad.xlsx', 'not a zip', 'Could not parse the file'],
    ['bad.csv', 'field_text,Field Text,Date\nA,B,2026-10-11', 'Duplicate normalized headers'],
  ])('shows actionable errors for %s and blocks progression', async (name, contents, message) => {
    await choose(intakeFile(contents, name));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(button('Map columns').disabled).toBe(true);
  });
  it('enforces row and file size limits before review', async () => {
    await choose(intakeFile('field_text,reported_date\n' + Array.from({ length: 1001 }, (_, i) => `Work ${i},2026-10-11`).join('\n')));
    expect(container.textContent).toContain('Maximum 1000 report rows'); expect(button('Map columns').disabled).toBe(true);
    await choose(intakeFile(new Uint8Array(intake.INTAKE_LIMITS.fileBytes + 1)));
    expect(container.textContent).toContain('Maximum file size is 2 MiB'); expect(button('Map columns').disabled).toBe(true);
  });
  it('renders hostile spreadsheet values as plain text, not markup', async () => {
    await review('field_text,reported_date\n<img src=x onerror=alert(1)>,2026-10-11');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('#row-2-field_text')?.value).toBe('<img src=x onerror=alert(1)>');
  });
  it('bounds desktop/mobile DOM review to 25 rows and supports filter/pagination', async () => {
    await review('field_text,reported_date\n' + Array.from({ length: 26 }, (_, i) => `Work ${i},2026-10-11`).join('\n'));
    expect(container.querySelectorAll('article')).toHaveLength(25); await click('Next');
    expect(container.querySelectorAll('article')).toHaveLength(1); expect(container.textContent).toContain('Row 27');
    await edit('[aria-label="Filter report rows"]', 'invalid'); expect(container.querySelectorAll('article')).toHaveLength(0);
    expect(container.textContent).toContain('No reports in this view');
  });
  it('ignores delayed results after Cancel/unmount', async () => {
    let resolve: (result: intake.IntakeResult) => void = () => {};
    const parsed = await intake.parseFieldReportFile(intakeFile('field_text,reported_date\nLate result,2026-10-11'));
    vi.spyOn(intake, 'parseFieldReportFile').mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await choose(intakeFile('field_text,reported_date\nLate result,2026-10-11')); await click('Cancel');
    await act(async () => root.unmount());
    await act(async () => resolve(parsed));
    expect(container.textContent).toBe('');
    // Create an empty root again for normal afterEach cleanup.
    root = createRoot(container);
  });
  it('does not let a late parse overwrite a newer selected file', async () => {
    let resolve: (result: intake.IntakeResult) => void = () => {};
    const parsed = await intake.parseFieldReportFile(intakeFile('field_text,reported_date\nStale evidence,2026-10-11'));
    const realParse = intake.parseFieldReportFile;
    vi.spyOn(intake, 'parseFieldReportFile').mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockImplementation(realParse);
    await choose(intakeFile('field_text,reported_date\nStale evidence,2026-10-11', 'old.csv'));
    await choose(intakeFile('field_text,reported_date\nCurrent evidence,2026-10-11', 'current.csv'));
    await act(async () => resolve(parsed));
    await click('Map columns'); await click('Review reports');
    expect(container.querySelector<HTMLTextAreaElement>('#row-2-field_text')?.value).toBe('Current evidence');
    expect(container.textContent).not.toContain('old.csv');
  });
  it('surfaces failed reads without leaking exception details and permits a fresh file', async () => {
    const file = new File(['text'], 'bad.csv');
    Object.defineProperty(file, 'arrayBuffer', { value: async () => { throw new Error('Private diagnostic'); } });
    await choose(file);
    expect(container.textContent).toContain('Could not read the selected file');
    expect(container.textContent).not.toContain('Private diagnostic');
    expect(button('Map columns').disabled).toBe(true);
    await choose(intakeFile('field_text,reported_date\nWork A,2026-10-11'));
    expect(button('Map columns').disabled).toBe(false);
  });
  it('shows recovery navigation if a remapping read unexpectedly fails', async () => {
    await choose(intakeFile('field_text,reported_date\nWork A,2026-10-11')); await click('Map columns');
    vi.spyOn(intake, 'parseFieldReportFile').mockRejectedValueOnce(new Error('Private diagnostic'));
    await edit('#map-reported_by', '0');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not read this file');
    expect(container.textContent).not.toContain('Private diagnostic');
    await click('Change file'); expect(button('Map columns').disabled).toBe(true);
  });
});
