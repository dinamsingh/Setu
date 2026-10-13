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
class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = 'en-IN';
  onstart: (() => void) | null = null;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;

  start = vi.fn(() => {
    if (this.onstart) this.onstart();
  });
  stop = vi.fn(() => {
    if (this.onend) this.onend();
  });
  abort = vi.fn(() => {
    if (this.onend) this.onend();
  });

  static instances: MockSpeechRecognition[] = [];
  constructor() {
    MockSpeechRecognition.instances.push(this);
  }
}

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  MockSpeechRecognition.instances = [];
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = MockSpeechRecognition;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><FieldCapture /></MemoryRouter>));
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
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

it('starts voice recognition, displays interim listening status, and appends final transcript without losing typed text', async () => {
  await draft();
  const micButton = container.querySelector<HTMLButtonElement>('[aria-label="Start voice input"]')!;
  expect(micButton).toBeTruthy();
  expect(micButton.getAttribute('aria-pressed')).toBe('false');

  await act(async () => { micButton.click(); });
  expect(MockSpeechRecognition.instances.length).toBe(1);
  const recognition = MockSpeechRecognition.instances[0];
  expect(recognition.start).toHaveBeenCalled();
  expect(micButton.getAttribute('aria-label')).toBe('Stop voice input');
  expect(micButton.getAttribute('aria-pressed')).toBe('true');

  // Emit interim result
  await act(async () => {
    recognition.onresult?.({
      resultIndex: 0,
      results: [
        {
          isFinal: false,
          0: { transcript: 'spool hydrotest' },
        },
      ],
    });
  });
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Listening:spool hydrotest');

  // Emit final transcript
  await act(async () => {
    recognition.onresult?.({
      resultIndex: 0,
      results: [
        {
          isFinal: true,
          0: { transcript: 'spool hydrotest passed today' },
        },
      ],
    });
  });

  const textarea = container.querySelector<HTMLTextAreaElement>('#field-report')!;
  expect(textarea.value).toBe('Unsent original field narrative spool hydrotest passed today');

  // Stop listening
  await act(async () => { micButton.click(); });
  expect(recognition.stop).toHaveBeenCalled();
  expect(micButton.getAttribute('aria-label')).toBe('Start voice input');
});

it('switches voice recognition language between English and Hindi before listening', async () => {
  await draft();
  const langSelect = container.querySelector<HTMLSelectElement>('[aria-label="Voice input language"]')!;
  expect(langSelect).toBeTruthy();
  expect(langSelect.value).toBe('en-IN');

  await act(async () => {
    langSelect.value = 'hi-IN';
    langSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(langSelect.value).toBe('hi-IN');

  const micButton = container.querySelector<HTMLButtonElement>('[aria-label="Start voice input"]')!;
  await act(async () => { micButton.click(); });

  const recognition = MockSpeechRecognition.instances[0];
  expect(recognition.lang).toBe('hi-IN');
  expect(langSelect.disabled).toBe(true);
});

it('displays helpful status when browser does not support speech recognition and keeps typing intact', async () => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;

  await draft();
  const micButton = container.querySelector<HTMLButtonElement>('[aria-label="Start voice input"]')!;
  await act(async () => { micButton.click(); });

  const alert = container.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain('Voice input is not supported in this browser. You can continue typing manually.');
  expectDraft();

  // Dismiss status
  const dismissBtn = container.querySelector<HTMLButtonElement>('[aria-label="Dismiss voice status"]')!;
  await act(async () => { dismissBtn.click(); });
  expect(container.querySelector('[aria-label="Dismiss voice status"]')).toBeNull();
});

it('disables voice input and stops listening while report submission is in flight', async () => {
  await draft();
  const micButton = container.querySelector<HTMLButtonElement>('[aria-label="Start voice input"]')!;
  await act(async () => { micButton.click(); });

  let finish: (value: { success: boolean; error: string }) => void = () => {};
  state.submit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  const langSelect = container.querySelector<HTMLSelectElement>('[aria-label="Voice input language"]')!;
  expect(micButton.disabled).toBe(true);
  expect(langSelect.disabled).toBe(true);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Add attachment"]')?.disabled).toBe(true);

  await act(async () => finish({ success: false, error: 'Mock-only failure' }));
  expect(micButton.disabled).toBe(false);
  expect(langSelect.disabled).toBe(false);
  expect(container.querySelector<HTMLButtonElement>('[aria-label="Add attachment"]')?.disabled).toBe(false);
});

it('displays updated privacy disclosure regarding browser speech and external speech services', async () => {
  await draft();
  const paragraphs = Array.from(container.querySelectorAll('p'));
  const notice = paragraphs.find(p => p.textContent && p.textContent.includes('Voice input:'));
  expect(notice).toBeTruthy();
  expect(notice?.textContent).toContain('Speech recognition is processed by your browser and may send audio to an external speech service');
  expect(notice?.textContent).toContain('SETU does not record or store raw audio');
});

it('prevents late speech results from mutating fieldText after report submission starts', async () => {
  await draft();
  const micButton = container.querySelector<HTMLButtonElement>('[aria-label="Start voice input"]')!;
  await act(async () => { micButton.click(); });
  const recognition = MockSpeechRecognition.instances[0];

  let finish: (value: { success: boolean; error: string }) => void = () => {};
  state.submit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));

  // Trigger form submission
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  // Late speech result attempts to arrive while submission is in-flight
  await act(async () => {
    recognition.onresult?.({
      resultIndex: 0,
      results: [
        {
          isFinal: true,
          0: { transcript: 'late speech chunk during submission' },
        },
      ],
    });
  });

  const textarea = container.querySelector<HTMLTextAreaElement>('#field-report')!;
  expect(textarea.value).not.toContain('late speech chunk during submission');

  // Complete submission
  await act(async () => finish({ success: true, error: '' }));
  expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({
    fieldText: expect.not.stringContaining('late speech chunk during submission'),
  }));
});

it('displays date & time suggestions panel when narrative contains temporal references without auto-changing reportedDate', async () => {
  await click('New field update');
  const dateInput = container.querySelector<HTMLInputElement>('input[type="date"]')!;
  const initialDate = dateInput.value;

  await edit('#field-report', 'Hydrostatic testing completed today at Manifold A');

  const region = container.querySelector('[role="region"][aria-label="Date and time suggestions from narrative"]');
  expect(region).not.toBeNull();
  expect(region?.textContent).toContain('Asia/Kolkata (IST)');
  expect(region?.textContent).toContain('“today”');
  expect(region?.textContent).toContain('Completed field work');

  // Verify reportedDate was NOT modified automatically
  expect(dateInput.value).toBe(initialDate);
});

it('shows explicit choices for ambiguous "kal" and updates reportedDate on click without altering narrative', async () => {
  await click('New field update');
  const textarea = container.querySelector<HTMLTextAreaElement>('#field-report')!;
  const dateInput = container.querySelector<HTMLInputElement>('input[type="date"]')!;

  await edit('#field-report', 'Kal welding shuru hogi');

  const region = container.querySelector('[role="region"]');
  expect(region).not.toBeNull();
  expect(region?.textContent).toContain('Planned future work (Advisory)');
  expect(region?.textContent).toContain('“kal”');

  const buttons = Array.from(region!.querySelectorAll('button'));
  const tomBtn = buttons.find(b => b.textContent?.includes('Tomorrow (Planned work:'));
  const yestBtn = buttons.find(b => b.textContent?.includes('Yesterday (Past work:'));
  expect(tomBtn).toBeDefined();
  expect(yestBtn).toBeDefined();

  // Click tomorrow
  await act(async () => {
    tomBtn!.click();
  });

  // Verify date input updated
  expect(dateInput.value).not.toBe('');
  expect(tomBtn?.textContent).toContain('(Selected)');

  // Critical rule: original narrative text must remain completely intact
  expect(textarea.value).toBe('Kal welding shuru hogi');
});

it('parses Hindi Devanagari phrase with advisory time and preserves narrative', async () => {
  await click('New field update');
  const textarea = container.querySelector<HTMLTextAreaElement>('#field-report')!;
  const dateInput = container.querySelector<HTMLInputElement>('input[type="date"]')!;

  await edit('#field-report', 'आज सुबह ९:३० बजे पंप अलाइनमेंट पूरा हुआ');

  const region = container.querySelector('[role="region"]');
  expect(region).not.toBeNull();
  expect(region?.textContent).toContain('09:30 AM (Morning)');
  expect(region?.textContent).toContain('Completed field work');

  const applyBtn = Array.from(region!.querySelectorAll('button')).find(b => b.textContent?.includes('Today ('));
  expect(applyBtn).toBeDefined();

  await act(async () => {
    applyBtn!.click();
  });

  expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(textarea.value).toBe('आज सुबह ९:३० बजे पंप अलाइनमेंट पूरा हुआ');
});

it('separates completed work from planned future work in compound sentence', async () => {
  await click('New field update');
  await edit('#field-report', 'Aaj inspection complete hua, kal welding hogi');

  const region = container.querySelector('[role="region"]');
  expect(region).not.toBeNull();

  expect(region?.textContent).toContain('Completed field work');
  expect(region?.textContent).toContain('Planned future work (Advisory)');

  // Verify "kal" has both yesterday and tomorrow options
  expect(region?.textContent).toContain('Yesterday (Past work:');
  expect(region?.textContent).toContain('Tomorrow (Planned work:');
});

it('allows dismissing individual suggestion and dismissing all suggestions', async () => {
  await click('New field update');
  await edit('#field-report', 'Aaj inspection complete hua, kal welding hogi');

  let region = container.querySelector('[role="region"]');
  expect(region).not.toBeNull();

  // Dismiss individual suggestion
  const dismissKalBtn = region?.querySelector('button[aria-label=\'Dismiss suggestion for "kal"\']') as HTMLButtonElement | null;
  expect(dismissKalBtn).not.toBeNull();

  await act(async () => {
    dismissKalBtn!.click();
  });

  // "kal" is dismissed, but "aaj" remains
  expect(region?.textContent).not.toContain('“kal”');
  expect(region?.textContent).toContain('“aaj”');

  // Dismiss all
  const dismissAllBtn = Array.from(region!.querySelectorAll('button')).find(b => b.textContent?.includes('Dismiss all'));
  expect(dismissAllBtn).toBeDefined();

  await act(async () => {
    dismissAllBtn!.click();
  });

  region = container.querySelector('[role="region"]');
  expect(region).toBeNull();
});

it('preserves manual date selection and never overwrites without user action', async () => {
  await click('New field update');
  const dateInput = container.querySelector<HTMLInputElement>('input[type="date"]')!;

  // Manual date change
  await edit('input[type="date"]', '2026-05-15');
  expect(dateInput.value).toBe('2026-05-15');

  // Type narrative with temporal expression
  await edit('#field-report', 'Piping inspection passed yesterday');

  // dateInput must remain 2026-05-15
  expect(dateInput.value).toBe('2026-05-15');

  // Explicit click updates date
  const region = container.querySelector('[role="region"]')!;
  const useBtn = Array.from(region.querySelectorAll('button')).find(b => b.textContent?.includes('Yesterday ('));
  expect(useBtn).toBeDefined();

  await act(async () => {
    useBtn!.click();
  });

  expect(dateInput.value).not.toBe('2026-05-15');
});

it('submits field update payload with chosen suggestion date without contract changes', async () => {
  state.submit.mockResolvedValueOnce({ success: true, updateId: 'UPD-TEST-123' });
  await click('New field update');
  await edit('#field-report', 'Testing finished yesterday');

  const region = container.querySelector('[role="region"]')!;
  const useYestBtn = Array.from(region.querySelectorAll('button')).find(b => b.textContent?.includes('Yesterday ('))!;
  await act(async () => {
    useYestBtn.click();
  });

  const dateInput = container.querySelector<HTMLInputElement>('input[type="date"]')!;
  const chosenDate = dateInput.value;

  // Submit form
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  expect(state.submit).toHaveBeenCalledWith({
    fieldText: 'Testing finished yesterday',
    siteLocation: 'Duliajan Manifold Area A',
    reportedDate: chosenDate,
    reportedBy: 'Ramesh Borah (Site Supervisor)',
  });
});
