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
vi.mock('../../hooks/useFieldUpdates', () => ({ useFieldUpdates: () => ({ updates: [], loading: false, error: null, refetch: vi.fn(), submitFieldUpdate: state.submit, submitSupervisorFieldUpdate: state.submit }) }));
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
  expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({ fieldText: 'Unsent original field narrative', siteLocation: 'Rack C', reportedDate: '2026-10-08', reportedBy: 'A. Das (Field Engineer)' }));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Mock-only submission failure'); expectDraft();
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

it('displays simple default supervisor screen with compact date/location, Change details toggle, and Update bhejo action', async () => {
  await click('New field update');
  const textarea = container.querySelector('#field-report');
  expect(textarea).not.toBeNull();
  expect(container.querySelector('[aria-label="Start voice input"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Add attachment"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="compact-date"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="compact-location"]')).not.toBeNull();
  expect(container.querySelector('[role="region"][aria-label="Date and time suggestions from narrative"]')).toBeNull();
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'));
  expect(sendButton).toBeDefined();
  const changeDetailsBtn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Change details'))!;
  expect(changeDetailsBtn).toBeDefined();
  expect(changeDetailsBtn.getAttribute('aria-expanded')).toBe('false');
  await act(async () => { changeDetailsBtn.click(); });
  expect(changeDetailsBtn.getAttribute('aria-expanded')).toBe('true');
  expect(changeDetailsBtn.textContent).toContain('Hide details');
  expect(container.querySelector('#report-details-panel')?.className).toContain('block');
});

it('submits a simple valid completed update with Update bhejo and shows sent confirmation', async () => {
  state.submit.mockResolvedValueOnce({ success: true, updateId: 'UPD-2026-001' });
  await click('New field update');
  await edit('#field-report', 'Piping spool erection finished at Manifold A today');
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'))!;
  await act(async () => { sendButton.click(); });
  expect(state.submit).toHaveBeenCalledTimes(1);
  expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({
    fieldText: 'Piping spool erection finished at Manifold A today',
    siteLocation: 'Duliajan Manifold Area A',
    sourceType: 'manual_text',
  }));
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Update sent');
  expect(container.textContent).toContain('UPD-2026-001');
});

it('cleanly submits compound narrative without extra interruption ("Aaj inspection complete hua, kal welding shuru hogi") ', async () => {
  state.submit.mockResolvedValueOnce({ success: true, updateId: 'UPD-2026-002' });
  await click('New field update');
  await edit('#field-report', 'Aaj inspection complete hua, kal welding shuru hogi');
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'))!;
  await act(async () => { sendButton.click(); });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(state.submit).toHaveBeenCalledTimes(1);
  expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({
    fieldText: 'Aaj inspection complete hua, kal welding shuru hogi',
    interpretation: expect.objectContaining({
      hasCompletedWork: true,
      hasFuturePlans: true,
      originalNarrative: 'Aaj inspection complete hua, kal welding shuru hogi',
    }),
  }));
});

it('never classifies negated Hindi narrative as completed ("Inspection complete nahi hua") ', async () => {
  state.submit.mockResolvedValueOnce({ success: true, updateId: 'UPD-2026-003' });
  await click('New field update');
  await edit('#field-report', 'Inspection complete nahi hua');
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'))!;
  await act(async () => { sendButton.click(); });
  expect(state.submit).toHaveBeenCalledTimes(1);
  expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({
    fieldText: 'Inspection complete nahi hua',
    interpretation: expect.objectContaining({
      hasCompletedWork: false,
      hasUncertainty: true,
    }),
  }));
});

it('interrupts with one plain-language question when material ambiguity exists ("Kal welding") and resolves cleanly', async () => {
  state.submit.mockResolvedValueOnce({ success: true, updateId: 'UPD-2026-004' });
  await click('New field update');
  await edit('#field-report', 'Kal welding at Manifold Area');
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'))!;
  await act(async () => { sendButton.click(); });
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain('Kripya spashth karein');
  expect(dialog?.textContent).toContain('Ye kaam kal hua tha ya aage plan hai?');
  expect(state.submit).not.toHaveBeenCalled();
  const pastBtn = [...dialog!.querySelectorAll('button')].find(b => b.textContent?.includes('Kal hua tha'))!;
  expect(pastBtn).toBeDefined();
  await act(async () => { pastBtn.click(); });
  expect(state.submit).toHaveBeenCalledTimes(1);
  expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({
    fieldText: 'Kal welding at Manifold Area',
    clarification: expect.objectContaining({
      question: 'Ye kaam kal hua tha ya aage plan hai?',
      answer: expect.stringContaining('Kal hua tha'),
    }),
  }));
});

it('prompts targeted clarification for conflicting activity status ("Welding complete hui hai ya kal shuru hogi?") and allows editing', async () => {
  await click('New field update');
  await edit('#field-report', 'Feeder line welding complete ho gayi lekin kal shuru hogi testing');
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'))!;
  await act(async () => { sendButton.click(); });
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain('Welding complete hui hai ya kal shuru hogi?');
  const editBtn = [...dialog!.querySelectorAll('button')].find(b => b.textContent?.includes('Update badlein'))!;
  await act(async () => { editBtn.click(); });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect((container.querySelector('#field-report') as HTMLTextAreaElement)?.value).toContain('Feeder line welding complete');
  expect(state.submit).not.toHaveBeenCalled();
});

it('prompts targeted clarification when narrative claims work completed yesterday but reported date is today', async () => {
  state.submit.mockResolvedValueOnce({ success: true, updateId: 'UPD-2026-005' });
  await click('New field update');
  await edit('#field-report', 'Kal kaam complete hua tha');
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'))!;
  await act(async () => { sendButton.click(); });
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain('Ye kaam aaj hua tha ya kal?');
  const yestBtn = [...dialog!.querySelectorAll('button')].find(b => b.textContent?.includes('Kal hua tha'))!;
  await act(async () => { yestBtn.click(); });
  expect(state.submit).toHaveBeenCalledTimes(1);
  const submittedCall = state.submit.mock.calls[0][0];
  expect(submittedCall.fieldText).toBe('Kal kaam complete hua tha');
  expect(submittedCall.reportedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(submittedCall.clarification.answer).toContain('Kal hua tha');
  expect(submittedCall.idempotencyKey).toBeDefined();
});

it('preserves manual reported-date override and respects user change without silent overwriting', async () => {
  state.submit.mockResolvedValueOnce({ success: true, updateId: 'UPD-2026-006' });
  await click('New field update');
  const changeDetailsBtn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Change details'))!;
  await act(async () => { changeDetailsBtn.click(); });
  await edit('input[type="date"]', '2026-05-15');
  await edit('#field-report', 'Testing finished successfully at Manifold A');
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'))!;
  await act(async () => { sendButton.click(); });
  expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({
    reportedDate: '2026-05-15',
    fieldText: 'Testing finished successfully at Manifold A',
  }));
});

it('preserves unsent draft on submission failure, shows Update nahi bheji gayi and provides Retry', async () => {
  state.submit.mockResolvedValueOnce({ success: false, error: 'Database network timeout' });
  await click('New field update');
  await edit('#field-report', 'Critical pump alignment completed at Station 3');
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'))!;
  await act(async () => { sendButton.click(); });
  const errorAlert = container.querySelector('[role="alert"]');
  expect(errorAlert).not.toBeNull();
  expect(errorAlert?.textContent).toContain('Update nahi bheji gayi');
  expect(errorAlert?.textContent).toContain('Database network timeout');
  expect((container.querySelector('#field-report') as HTMLTextAreaElement)?.value).toBe('Critical pump alignment completed at Station 3');
  const retryBtn = [...errorAlert!.querySelectorAll('button')].find(b => b.textContent?.includes('Dobara koshish karein'));
  expect(retryBtn).toBeDefined();
  state.submit.mockResolvedValueOnce({ success: true, updateId: 'UPD-RETRY-001' });
  await act(async () => { retryBtn!.click(); });
  expect(state.submit).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain('Update sent');
});

it('prevents submission when narrative is empty or too short without calling submit', async () => {
  await click('New field update');
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'))!;
  expect(sendButton.disabled).toBe(true);
  await edit('#field-report', 'ok');
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(state.submit).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Narrative is too short');
});

it('displays subtle loading feedback "SETU aapki update check kar raha hai…" while submission is in-flight', async () => {
  let finish: (res: any) => void = () => {};
  state.submit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await click('New field update');
  await edit('#field-report', 'Pressure test passed with zero drop');
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'))!;
  await act(async () => { sendButton.click(); });
  const statusEl = container.querySelector('[role="status"]');
  expect(statusEl?.textContent).toContain('SETU aapki update check kar raha hai…');
  expect(sendButton.disabled).toBe(true);
  await act(async () => { finish({ success: true, updateId: 'UPD-2026-FIN' }); });
  expect(container.textContent).toContain('Update sent');
});

it('resolves clarification with Today and passes today reported date directly to submission', async () => {
  state.submit.mockResolvedValueOnce({ success: true, updateId: 'UPD-2026-TODAY' });
  await click('New field update');
  await edit('#field-report', 'Kal kaam complete hua tha');
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'))!;
  await act(async () => { sendButton.click(); });
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  const todayBtn = [...dialog!.querySelectorAll('button')].find(b => b.textContent?.includes('Aaj hua tha'))!;
  expect(todayBtn).toBeDefined();
  await act(async () => { todayBtn.click(); });
  expect(state.submit).toHaveBeenCalledTimes(1);
  const callArgs = state.submit.mock.calls[0][0];
  expect(callArgs.fieldText).toBe('Kal kaam complete hua tha');
  expect(callArgs.reportedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(callArgs.clarification.answer).toContain('Aaj hua tha');
});

it('invalidates previous clarification when narrative text or mic input is edited', async () => {
  await click('New field update');
  await edit('#field-report', 'Kal kaam complete hua tha');
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'))!;
  await act(async () => { sendButton.click(); });
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();

  // Supervisor types new clarification into the narrative
  await edit('#field-report', 'Kal kaam complete hua tha aur aaj handover diya');
  // Clarification dialog should be dismissed/invalidated
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it('passes stable idempotency key on failure retry preventing duplicate reports', async () => {
  state.submit.mockResolvedValueOnce({ success: false, error: 'Network socket closed' });
  await click('New field update');
  await edit('#field-report', 'Pipeline testing completed with 10 bar pressure');
  const sendButton = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Update bhejo'))!;
  await act(async () => { sendButton.click(); });
  expect(state.submit).toHaveBeenCalledTimes(1);
  const firstKey = state.submit.mock.calls[0][0].idempotencyKey;
  expect(firstKey).toBeDefined();

  // Retry submission
  state.submit.mockResolvedValueOnce({ success: true, updateId: 'UPD-RETRY-STABLE' });
  const retryBtn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Dobara koshish karein'))!;
  await act(async () => { retryBtn.click(); });
  expect(state.submit).toHaveBeenCalledTimes(2);
  const secondKey = state.submit.mock.calls[1][0].idempotencyKey;
  expect(secondKey).toBe(firstKey);
});
