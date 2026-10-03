// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowActions } from './WorkflowActions';
import { RemapModal } from './RemapModal';
import { NeedsClarification } from '../supervisor/NeedsClarification';
import { report, round, proposal } from '../../test/workflowFixtures';
import type { Clarification, RemapProposal } from '../../types/workflow';
import type { FieldUpdate } from '../../types';
import { supabase } from '../../lib/supabase';
vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(node: ReactNode) { await act(async () => root.render(node)); }
function button(text: string) {
  const found = Array.from(container.querySelectorAll('button')).find(b => b.textContent === text);
  expect(found, text).toBeTruthy(); return found!;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function input(label: string, value: string) {
  const element = container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  expect(element, label).toBeTruthy();
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
const activities = [{ id: 'a', activity_id: 'ACT-A', activity_name: 'Current task', wbs_code: '1', discipline: 'Piping' },
  { id: 'b', activity_id: 'ACT-B', activity_name: 'Selected task', wbs_code: '2', discipline: 'Piping' }];
function workspace(rpc = vi.fn(async () => ({ success: true })), rounds: Clarification[] = [], proposals: RemapProposal[] = [], update: FieldUpdate = report) {
  return <WorkflowActions update={update} rounds={rounds} proposals={proposals} activities={activities} act={rpc} available onRemap={vi.fn()} />;
}

describe('planner workflow interactions', () => {
  it('Resolve Now requires contact details and explicit impact and uses its RPC', async () => {
    const rpc = vi.fn(async () => ({ success: true })); await render(workspace(rpc));
    await click('Clarify'); await click('Resolve Now'); expect(button('Confirm').disabled).toBe(true);
    await input('Clarification question', 'Which task?'); await input('Communication method', 'Phone');
    await input('Clarification received', 'Piping fit-up'); await input('Supplied by', 'Supervisor');
    expect(button('Confirm').disabled).toBe(true);
    await input('Clarification impact', 'mapping_inputs_changed'); await submit();
    expect(rpc).toHaveBeenCalledWith('resolve_field_update_clarification_now', expect.objectContaining({ p_impact: 'mapping_inputs_changed', p_response: 'Piping fit-up', p_expected_workflow_revision: 1 }));
  });
  it('Request Response uses original identity server-side and makes no external-message claim', async () => {
    const rpc = vi.fn(async () => ({ success: true })); await render(workspace(rpc));
    await click('Clarify'); await click('Request Response'); await input('Clarification question', 'Which location?'); await submit();
    expect(rpc).toHaveBeenCalledWith('request_field_update_clarification', expect.objectContaining({ p_question: 'Which location?', p_field_update_id: 'report' }));
    await render(workspace(rpc, [round])); expect(container.textContent).toContain('Awaiting Field Response');
    expect(container.textContent).toContain('available to the original submitter in SETU');
    expect(container.querySelectorAll('button')).not.toContainEqual(expect.objectContaining({ textContent: 'Accept' }));
  });
  it('shows response attribution and explicit triage', async () => {
    const rpc = vi.fn(async () => ({ success: true }));
    await render(workspace(rpc, [{ ...round, status: 'responded', response: 'Area confirmed', responded_by_user_id: 'site', responded_at: '2026-10-03' }]));
    expect(container.textContent).toContain('Area confirmed'); expect(container.textContent).toContain('original field submitter');
    await click('Classify response'); await input('Clarification impact', 'validation_inputs_changed'); await submit();
    expect(rpc).toHaveBeenCalledWith('triage_field_update_clarification', expect.objectContaining({ p_clarification_id: 'round', p_impact: 'validation_inputs_changed' }));
  });
  it.each([
    ['Awaiting AI', { confidence_level: 'Pending' as const, validation_status: null }],
    ['Reprocessing Evidence', { evidence_revision: 1 }],
  ])('locks normal actions and technical requeue during %s', async (state, changes) => {
    await render(workspace(undefined, [], [], { ...report, ...changes }));
    expect(container.textContent).toContain(state);
    for (const name of ['Accept', 'Remap', 'Clarify', 'Technical Requeue']) {
      expect(Array.from(container.querySelectorAll('button')).find(b => b.textContent === name)).toBeUndefined();
    }
    expect(button('Close as Invalid').disabled).toBe(false);
  });
  it('locks an already-open clarification form when polling reveals processing', async () => {
    const rpc = vi.fn(async () => ({ success: true })); await render(workspace(rpc));
    await click('Clarify'); await click('Request Response'); await input('Clarification question', 'Which area?');
    await render(workspace(rpc, [], [], { ...report, evidence_revision: 1 }));
    expect(container.querySelector('form')).toBeNull(); expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    ['Accept', 'accept_current_field_update', false],
    ['Exceptional: override validation', 'override_current_field_update_validation', true],
    ['Technical Requeue', 'requeue_current_field_update', false],
  ])('%s uses displayed revision and surfaces stale-state errors', async (action, name, blocked) => {
    const rpc = vi.fn(async () => ({ success: false, error: 'Workflow changed; refresh before acting' }));
    await render(workspace(rpc, [], [], { ...report, validation_status: blocked ? 'block' : 'pass' }));
    await click(action); await input('Planner reason or note', 'Reviewed note'); await submit();
    expect(rpc).toHaveBeenCalledWith(name, expect.objectContaining({ p_field_update_id: report.id, p_expected_workflow_revision: 1 }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Workflow changed');
    expect(container.querySelector('form')).toBeTruthy(); expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('keeps Clarify and Remap as recovery paths for blocked report validation', async () => {
    await render(workspace(undefined, [], [], { ...report, validation_status: 'block' }));
    expect(button('Accept').disabled).toBe(true);
    expect(button('Clarify').disabled).toBe(false); expect(button('Remap').disabled).toBe(false);
  });
  it('Confirm Remap never uses an abandoned action note', async () => {
    const rpc = vi.fn(async () => ({ success: true }));
    await render(workspace(rpc, [], [{ ...proposal, status: 'validated', validation_status: 'pass', validated_generation: 1, validation_evidence_revision: 0 }]));
    await click('Close as Invalid'); await input('Planner reason or note', 'Abandoned invalid-close note'); await click('Cancel');
    await click('Confirm Remap');
    expect(rpc).toHaveBeenCalledWith('finalize_field_update_remap', {
      p_proposal_id: proposal.id, p_expected_workflow_revision: 1, p_remarks: null,
    });
  });
  it('validating target cannot finalize; validated target calls new finalization', async () => {
    const rpc = vi.fn(async () => ({ success: true })); await render(workspace(rpc, [], [proposal]));
    expect(container.textContent).toContain('Validating Selected Activity'); expect(button('Confirm Remap').disabled).toBe(true);
    await render(workspace(rpc, [], [{ ...proposal, status: 'validated', validation_status: 'warn', validated_generation: 1, validation_evidence_revision: 0 }]));
    expect(button('Confirm Remap').disabled).toBe(false); await click('Confirm Remap');
    expect(rpc).toHaveBeenCalledWith('finalize_field_update_remap', expect.objectContaining({ p_proposal_id: 'proposal' }));
  });
  it('blocked proposal needs a reason-scoped override and offers cancellation into Clarify', async () => {
    const rpc = vi.fn(async () => ({ success: true })); await render(workspace(rpc, [], [{ ...proposal, status: 'blocked', validation_status: 'block', validated_generation: 1, validation_evidence_revision: 0 }]));
    expect(button('Confirm Remap').disabled).toBe(true);
    await click('Exceptional: override selected-target validation'); expect(button('Confirm').disabled).toBe(true);
    await input('Planner reason or note', 'Signed site record reviewed'); await submit();
    expect(rpc).toHaveBeenCalledWith('override_field_update_remap_proposal', expect.objectContaining({ p_proposal_id: 'proposal', p_reason: 'Signed site record reviewed' }));
    await click('Cancel proposal & Clarify'); expect(rpc).toHaveBeenCalledWith('cancel_field_update_remap_proposal', expect.objectContaining({ p_reason: 'Planner needs clarification' }));
    expect(container.textContent).toContain('Clarify field evidence');
  });
  it('Close as Invalid requires a reason and calls compatibility-safe RPC', async () => {
    const rpc = vi.fn(async () => ({ success: true })); await render(workspace(rpc)); await click('Close as Invalid');
    expect(button('Confirm').disabled).toBe(true); await input('Planner reason or note', 'Duplicate'); await submit();
    expect(rpc).toHaveBeenCalledWith('close_field_update_as_invalid', expect.objectContaining({ p_reason: 'Duplicate' }));
  });
  it('keeps failed action form open with server error, and disables duplicate submits', async () => {
    const rpc = vi.fn(async () => ({ success: false, error: 'Workflow changed; refresh before acting' }));
    await render(workspace(rpc)); await click('Clarify'); await click('Request Response');
    await input('Clarification question', 'Question'); await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Workflow changed'); expect(container.querySelector('form')).toBeTruthy();
    let release!: (value: { success: boolean }) => void;
    const slow = vi.fn(() => new Promise<{ success: boolean }>(resolve => { release = resolve; }));
    await render(workspace(slow));
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(button('Saving…').disabled).toBe(true); expect(slow).toHaveBeenCalledTimes(1);
    await act(async () => release({ success: true }));
  });
  it.each(['approved', 'rejected', 'remapped'] as const)('keeps %s reports read-only', async status => {
    await render(workspace(undefined, [], [], { ...report, status }));
    expect(container.textContent).toContain('read-only'); expect(container.querySelector('button')).toBeNull();
  });
});

describe('selected target and field response', () => {
  it('requires a different target and keeps selection dialog open on failure', async () => {
    const confirm = vi.fn(async () => false); const close = vi.fn();
    await render(<RemapModal isOpen update={report} activities={activities} plannerName="Planner" onClose={close} onConfirmRemap={confirm} />);
    expect(button('Validate selected activity').disabled).toBe(true);
    const targets = Array.from(container.querySelectorAll('button'));
    expect(targets.find(b => b.textContent?.includes('Current activity'))?.disabled).toBe(true);
    await act(async () => targets.find(b => b.textContent?.includes('Selected task'))!.click());
    await click('Validate selected activity'); expect(confirm).toHaveBeenCalledWith(report, 'ACT-B', '');
    expect(close).not.toHaveBeenCalled(); expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });
  it('preserves optional alias quarantine without alias writes on proposal failure or duplicate proposals on alias retry', async () => {
    const insert = vi.fn().mockResolvedValueOnce({ error: { message: 'Alias unavailable' } }).mockResolvedValue({ error: null });
    vi.mocked(supabase.from).mockReturnValue({ insert } as unknown as ReturnType<typeof supabase.from>);
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true); const close = vi.fn();
    await render(<RemapModal isOpen update={report} activities={activities} plannerName="Planner" onClose={close} onConfirmRemap={confirm} />);
    await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Selected task'))!.click());
    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await input('Alias field term', 'Site jargon'); await input('Alias standard term', 'Selected task');
    await click('Validate selected activity'); expect(insert).not.toHaveBeenCalled();
    await click('Validate selected activity'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('Alias unavailable');
    await click('Retry optional alias proposal'); expect(confirm).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({ status: 'proposed', field_term: 'site jargon', origin: 'planner_correction' })]);
  });
  it('only renders addressed requests and permits one nonblank response', async () => {
    const rpc = vi.fn(async () => ({ success: true }));
    await render(<NeedsClarification rounds={[round, { ...round, id: 'other', recipient_user_id: 'other', question: 'PRIVATE' }]} updates={[report]} userId="site" act={rpc} available />);
    expect(container.textContent).not.toContain('PRIVATE'); expect(button('Submit Response').disabled).toBe(true);
    await input('Response for UPD-TEST', 'Area A'); await submit();
    expect(rpc).toHaveBeenCalledWith('respond_to_field_update_clarification', expect.objectContaining({ p_response: 'Area A', p_clarification_id: 'round' }));
    expect(container.textContent).toContain('Response sent / awaiting planner review'); expect(container.querySelector('textarea')).toBeNull();
  });
  it('shows field RPC failure without losing entered response', async () => {
    const rpc = vi.fn(async () => ({ success: false, error: 'Request no longer open' }));
    await render(<NeedsClarification rounds={[round]} updates={[report]} userId="site" act={rpc} available />);
    await input('Response for UPD-TEST', 'Answer'); await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('no longer open');
    expect(container.querySelector('textarea')?.value).toBe('Answer');
  });
});
