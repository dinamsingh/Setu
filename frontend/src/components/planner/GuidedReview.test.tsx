// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewCard } from './ReviewCard';
import { ReviewStepper } from './ReviewStepper';
import { reviewStage } from '../../lib/guidedReview';
import { WorkflowActions } from './WorkflowActions';
import { report, round, proposal } from '../../test/workflowFixtures';
import type { FieldUpdate, ScheduleActivity } from '../../types';
import type { Clarification, RemapProposal } from '../../types/workflow';
import type { ProgressEvent } from '../../types/progressEvents';

const activities: ScheduleActivity[] = [{ id: 'a', activity_id: 'ACT-A', activity_name: 'Rack B spool welding',
  wbs_code: '1.2.3', discipline: 'Piping' }, { id: 'b', activity_id: 'ACT-B', activity_name: 'Alternative activity',
  wbs_code: '1.2.4', discipline: 'Piping' }];
const blocked = { ...report, validation_status: 'block' as const, validation_results: [
  { check: 'date_plausibility', name: 'Date Plausibility', outcome: 'fail' as const,
    message: 'Reported date precedes planned work.', evidence: {} },
] };
const overridden = { ...blocked, validation_overridden: true, override_evidence_revision: 0,
  override_activity_id: 'ACT-A', override_reason: 'Signed site record reviewed', workflow_revision: 2 };
const event: ProgressEvent = { id: 'event', field_update_id: report.id, evidence_revision: 0, event_index: 0,
  event_type: 'PROGRESS', event_date: '2026-10-03', progress_percent: 60, evidence_text: '60% complete today',
  extraction_reason: 'Explicit progress', extraction_version: 'phase1_rules_v1', created_at: report.created_at };
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(node: ReactNode) { await act(async () => root.render(node)); }
function button(label: string) { const result = [...container.querySelectorAll('button')].find(b => b.textContent === label);
  expect(result, label).toBeTruthy(); return result!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function note(value: string) {
  const field = container.querySelector<HTMLTextAreaElement>('[aria-label="Planner reason or note"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
function workspace(update: FieldUpdate = report, rounds: Clarification[] = [], proposals: RemapProposal[] = [],
  rpc = vi.fn(async () => ({ success: true })), next = vi.fn(), events: ProgressEvent[] = []) {
  return <ReviewCard update={update} matchedActivity={activities.find(a => a.activity_id === update.matched_activity_id)}
    plannerName="Planner" onAccept={async () => {}} onReject={async () => {}} onOpenRemap={vi.fn()}
    rounds={rounds} proposals={proposals} onReviewNext={next} progressEvents={events}
    decisionContent={<WorkflowActions update={update} rounds={rounds} proposals={proposals} activities={activities}
      act={rpc} available onRemap={vi.fn()} progressEvents={events} />} />;
}

describe('data-derived review steps', () => {
  it.each([
    ['awaiting AI', { confidence_level: 'Pending', validation_status: null }, [], [], 2, false],
    ['validation pending', { validation_status: null }, [], [], 3, false],
    ['stale validation', { evidence_revision: 1 }, [], [], 3, false],
    ['blocked', blocked, [], [], 3, false],
    ['current override', overridden, [], [], 4, true],
    ['stale override scope', { ...overridden, override_activity_id: 'ACT-B' }, [], [], 3, false],
    ['pass', {}, [], [], 4, true],
    ['warn', { validation_status: 'warn' }, [], [], 4, true],
    ['Low', { confidence_level: 'Low' }, [], [], 4, false],
    ['unmatched', { matched_activity_id: null }, [], [], 4, false],
    ['open clarification', {}, [round], [], 4, false],
    ['received response', {}, [{ ...round, status: 'responded' }], [], 4, false],
    ['remap pending', {}, [], [proposal], 3, false],
    ['remap ready', {}, [], [{ ...proposal, status: 'validated', validation_status: 'pass',
      validated_generation: 1, validation_evidence_revision: 0 }], 4, false],
    ['approved', { status: 'approved' }, [], [], 5, false],
    ['rejected', { status: 'rejected' }, [], [], 5, false],
    ['remapped', { status: 'remapped' }, [], [], 5, false],
  ] as const)('%s derives step %s without persisted UI state', async (_name, changes, rounds, proposals, current, ready) => {
    const update = { ...report, ...changes } as FieldUpdate;
    const stage = reviewStage(update, [...rounds] as Clarification[], [...proposals] as RemapProposal[],
      activities.find(a => a.activity_id === update.matched_activity_id));
    expect(stage.current).toBe(current); expect(stage.canApprove).toBe(ready);
    await render(<ReviewStepper stage={stage} />);
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain(['Evidence', 'AI Match', 'Validation', 'Planner Decision', 'Done'][current - 1]);
  });
  it('completes evidence and AI, not validation, while validation is pending', () => {
    expect(reviewStage({ ...report, validation_status: null }, [], [], activities[0]).completed).toEqual([true, true, false, false, false]);
    expect(reviewStage({ ...report, status: 'rejected', confidence_level: 'Pending', validation_status: null }).completed)
      .toEqual([true, false, false, true, true]);
  });
});

describe('guided planner decisions', () => {
  it('keeps expandable details keyboard-native and exposes their expansion state', async () => {
    await render(workspace(overridden));
    const summaries = [...container.querySelectorAll('summary')];
    expect(summaries).toHaveLength(3);
    for (const summary of summaries) {
      expect(summary.getAttribute('aria-expanded')).toBe('false');
      await act(async () => {
        const details = summary.parentElement as HTMLDetailsElement;
        details.open = true;
        details.dispatchEvent(new Event('toggle'));
      });
      expect(summary.getAttribute('aria-expanded')).toBe('true');
    }
  });
  it('makes the inline confirmation the sole dominant action during triage or remap recovery', async () => {
    await render(workspace(report, [{ ...round, status: 'responded', response: 'Area confirmed' }]));
    await click('Classify response');
    expect([...container.querySelectorAll('button')].filter(b => b.textContent === 'Classify response')).toHaveLength(0);
    expect([...container.querySelectorAll('button')].filter(b => b.classList.contains('bg-setu-navy'))).toHaveLength(1);
    await click('Cancel');
    await render(workspace(report, [], [{ ...proposal, status: 'validated', validation_status: 'pass',
      validated_generation: 1, validation_evidence_revision: 0 }]));
    await click('Close as invalid');
    expect([...container.querySelectorAll('button')].filter(b => b.textContent === 'Confirm Remap')).toHaveLength(0);
    expect([...container.querySelectorAll('button')].filter(b => b.classList.contains('bg-setu-navy'))).toHaveLength(1);
    await click('Cancel'); expect(button('Confirm Remap').disabled).toBe(false);
  });
  it('locks approval when workflow data is unavailable', async () => {
    await render(<WorkflowActions update={report} rounds={[]} proposals={[]} activities={activities}
      act={vi.fn()} available={false} onRemap={vi.fn()} />);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Workflow data unavailable');
    expect(container.textContent).not.toContain('Accept suggested mapping');
    expect(button('Choose different activity').disabled).toBe(true);
  });
  it('exposes the required governed override form without More Actions and never auto-approves', async () => {
    const rpc = vi.fn(async () => ({ success: true })); await render(workspace(blocked, [], [], rpc));
    expect(container.textContent).toContain('1 issue needs your decision');
    expect(container.textContent).toContain('Reported date precedes planned work.');
    expect(container.querySelector('details[open]')).toBeNull();
    await click('Resolve validation issue'); expect(button('Confirm').disabled).toBe(true);
    await note('Signed site record reviewed'); await submit();
    expect(rpc).toHaveBeenCalledWith('override_current_field_update_validation', {
      p_field_update_id: report.id, p_expected_workflow_revision: 1, p_reason: 'Signed site record reviewed',
    });
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Validation'); // RPC success alone is not new data
    await render(workspace(overridden, [], [], rpc));
    expect(container.textContent).toContain('Validation exception recorded under planner governance.');
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Planner Decision');
    expect(button('Accept suggested mapping').disabled).toBe(false); expect(rpc).toHaveBeenCalledTimes(1);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
  });
  it('confirms activity, current events, override and optional note before approval', async () => {
    const rpc = vi.fn(async () => ({ success: true }));
    await render(workspace({ ...overridden, progress_extraction_revision: 0 }, [], [], rpc, undefined,
      [event, { ...event, id: 'stale', evidence_revision: 9, progress_percent: 99 }]));
    await click('Accept suggested mapping'); expect(rpc).not.toHaveBeenCalled();
    const form = container.querySelector('form')!;
    expect(form.textContent).toContain('ACT-A'); expect(form.textContent).toContain('60%');
    expect(form.textContent).toContain('2026-10-03'); expect(form.textContent).not.toContain('99%');
    expect(form.textContent).toContain('Governed validation exception');
    await note('Reviewed by planner'); await click('Approve field update');
    expect(rpc).toHaveBeenCalledWith('accept_current_field_update', {
      p_field_update_id: report.id, p_expected_workflow_revision: 2, p_remarks: 'Reviewed by planner',
    });
  });
  it.each([{ confidence_level: 'Pending' as const, validation_status: null }, { validation_status: null },
    { confidence_level: 'Low' as const }, { matched_activity_id: null }])('never offers premature acceptance: %j', async changes => {
    await render(workspace({ ...report, ...changes }));
    expect(container.textContent).not.toContain('Accept suggested mapping');
  });
  it('preserves remap and clarification recovery with one dominant action', async () => {
    const remap = vi.fn();
    await render(<WorkflowActions update={{ ...report, confidence_level: 'Low' }} rounds={[]} proposals={[]} activities={activities}
      act={vi.fn()} available onRemap={remap} />);
    await click('Choose different activity'); expect(remap).toHaveBeenCalledWith(expect.objectContaining({ id: report.id }));
    await click('Ask for clarification'); expect(button('Resolve Now')).toBeTruthy(); expect(button('Request Response')).toBeTruthy();
  });
  it('renders open/responded clarification and pending/ready proposal without false acceptance', async () => {
    await render(workspace(report, [round])); expect(container.textContent).toContain('Awaiting Field Response');
    expect(container.textContent).not.toContain('Accept suggested mapping');
    await render(workspace(report, [{ ...round, status: 'responded', response: 'Area confirmed' }]));
    expect(button('Classify response')).toBeTruthy(); expect(container.textContent).toContain('Area confirmed');
    await render(workspace(report, [], [proposal])); expect(button('Confirm Remap').disabled).toBe(true);
    await render(workspace(report, [], [{ ...proposal, status: 'validated', validation_status: 'pass', validated_generation: 1, validation_evidence_revision: 0 }]));
    expect(button('Confirm Remap').disabled).toBe(false);
  });
  it.each(['approved', 'remapped', 'rejected'] as const)('shows truthful read-only Done for %s', async status => {
    const next = vi.fn(); await render(workspace({ ...report, status }, [], [], undefined, next));
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Done');
    expect(container.querySelector('form')).toBeNull(); expect(container.textContent).toContain('Read-only');
    const actuals = container.querySelector('a[href="/planner/schedule-actuals"]');
    if (status === 'rejected') { expect(actuals).toBeNull(); expect(container.textContent).toContain('does not contribute'); }
    else expect(actuals?.textContent).toBe('View Schedule Actuals');
    expect(container.querySelector('a[href="/planner/audit-export"]')).toBeTruthy();
    await click('Review next item'); expect(next).toHaveBeenCalledTimes(1);
  });
});
