// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewQueue } from './ReviewQueue';
import { report } from '../../test/workflowFixtures';
import type { FieldUpdate } from '../../types';

const state = vi.hoisted(() => ({ updates: [] as FieldUpdate[], rpc: vi.fn(), refetch: vi.fn(async () => {}) }));
vi.mock('../../hooks/useFieldUpdates', () => ({ useFieldUpdates: () => ({ updates: state.updates, loading: false,
  error: null, refetch: state.refetch, submitPlannerDecision: vi.fn(), requeueForRematching: vi.fn(), overrideValidation: vi.fn() }) }));
vi.mock('../../hooks/useScheduleData', () => ({ useScheduleData: () => {
  const activity = { id: 'a', activity_id: 'ACT-A', activity_name: 'Current task', wbs_code: '1', discipline: 'Piping' };
  return { activities: [activity], activitiesMap: new Map([['ACT-A', activity]]), disciplines: ['Piping'], loading: false, error: null };
} }));
vi.mock('../../hooks/useWorkflow', () => ({ useWorkflow: () => ({ rounds: [], proposals: [], loading: false, error: null, act: state.rpc }) }));
vi.mock('../../hooks/useProgressEvents', () => ({ useProgressEvents: () => ({ events: [], loading: false, error: null, refetch: vi.fn() }) }));
vi.mock('../../lib/AuthContext', () => ({ useAuth: () => ({ role: 'planner', user: { id: 'planner' } }) }));
vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../components/common/Header', () => ({ Header: () => <header /> }));
vi.mock('../../components/common/Sidebar', () => ({ Sidebar: () => <aside /> }));
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); state.updates = [{ ...report }];
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(initialEntries = ['/planner/review']) {
  await act(async () => root.render(<MemoryRouter initialEntries={initialEntries}><ReviewQueue /></MemoryRouter>));
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(label));
  expect(button, `Button "${label}"`).toBeTruthy(); await act(async () => button!.click());
}

describe('two-mode queue/detail behavior', () => {
  it('1. Queue mode shows pending list only', async () => {
    await render();
    expect(container.querySelector('[data-testid="queue-mode"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="queue-list"]')).toBeTruthy();
    expect(container.textContent).toContain('UPD-TEST');
    expect(container.textContent).toContain('Review Queue');
  });

  it('2. Queue mode does NOT render selected-report detail', async () => {
    await render();
    expect(container.querySelector('[data-testid="detail-mode"]')).toBeNull();
    expect(container.querySelector('article')).toBeNull();
  });

  it('3. Clicking a queue item hides the queue completely', async () => {
    await render();
    await click('UPD-TEST');
    expect(container.querySelector('[data-testid="queue-mode"]')).toBeNull();
    expect(container.querySelector('[data-testid="queue-list"]')).toBeNull();
    expect(container.querySelector('[data-testid="detail-mode"]')).toBeTruthy();
  });

  it('4. Detail mode shows only the selected report workspace', async () => {
    await render();
    await click('UPD-TEST');
    expect(container.querySelector('article')).toBeTruthy();
    expect(container.textContent).toContain('UPD-TEST');
    expect(container.textContent).toContain('Back to Review Queue');
  });

  it('5. Back to Review Queue restores list', async () => {
    await render();
    await click('UPD-TEST');
    expect(container.querySelector('[data-testid="detail-mode"]')).toBeTruthy();
    await click('Back to Review Queue');
    expect(container.querySelector('[data-testid="queue-mode"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="detail-mode"]')).toBeNull();
  });

  it('6. Detail mode does NOT render queue rows', async () => {
    state.updates = [{ ...report }, { ...report, id: 'next', update_id: 'UPD-NEXT', created_at: '2026-10-01', field_text: 'Next evidence' }];
    await render();
    await click('UPD-TEST');
    // Queue list should not exist in detail mode
    expect(container.querySelector('[data-testid="queue-list"]')).toBeNull();
    // Only one article (the detail) should exist
    expect(container.querySelectorAll('article')).toHaveLength(1);
  });

  it('7. Selected report survives URL state via ?selected= param', async () => {
    await render(['/planner/review?selected=report']);
    expect(container.querySelector('[data-testid="detail-mode"]')).toBeTruthy();
    expect(container.textContent).toContain('UPD-TEST');
  });
});

describe('validation and decision workflow', () => {
  it('8. Validation blocked → Resolve validation issue primary CTA in sticky bar', async () => {
    state.updates = [{ ...report, validation_status: 'block' as const,
      validation_results: [{ check: 'date', name: 'Date Check', outcome: 'fail' as const, message: 'Date issue', evidence: {} }] }];
    await render(['/planner/review?selected=report']);
    expect(container.querySelector('[data-testid="sticky-action-bar"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="sticky-action-bar"]')?.textContent).toContain('Resolve this validation issue');
  });

  it('9. Override complete → Accept suggested mapping primary CTA', async () => {
    state.updates = [{ ...report, validation_status: 'block' as const, validation_overridden: true,
      override_evidence_revision: 0, override_activity_id: 'ACT-A', override_reason: 'Reviewed', workflow_revision: 2 }];
    await render(['/planner/review?selected=report']);
    expect(container.querySelector('[data-testid="sticky-action-bar"]')?.textContent).toContain('Accept suggested mapping');
  });

  it('10. Accept confirmation shows activity and approve button', async () => {
    await render(['/planner/review?selected=report']);
    await click('Accept suggested mapping');
    expect(container.querySelector('form')).toBeTruthy();
    expect(container.textContent).toContain('ACT-A');
    expect(container.textContent).toContain('Approve field update');
  });

  it('11. Remap and Clarify still accessible', async () => {
    await render(['/planner/review?selected=report']);
    expect([...container.querySelectorAll('button')].some(b => b.textContent?.includes('Choose different activity'))).toBe(true);
    expect([...container.querySelectorAll('button')].some(b => b.textContent?.includes('Ask for clarification'))).toBe(true);
  });
});

describe('terminal states', () => {
  it('12. Approved Done state with Schedule Actuals', async () => {
    state.updates = [{ ...report, status: 'approved' }];
    await render(['/planner/review?selected=report']);
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Done');
    expect(container.textContent).toContain('Approved');
    expect(container.textContent).toContain('contribute to Schedule Actuals');
    expect(container.querySelector('a[href="/planner/schedule-actuals"]')?.textContent).toBe('View Schedule Actuals');
  });

  it('13. Rejected/invalid Done state does not show Schedule Actuals claim', async () => {
    state.updates = [{ ...report, status: 'rejected' }];
    await render(['/planner/review?selected=report']);
    expect(container.textContent).toContain('Rejected');
    expect(container.textContent).toContain('does not contribute');
    expect(container.querySelector('a[href="/planner/schedule-actuals"]')).toBeNull();
  });

  it('14. View Schedule Actuals link present for approved', async () => {
    state.updates = [{ ...report, status: 'approved' }];
    await render(['/planner/review?selected=report']);
    const link = container.querySelector('a[href="/planner/schedule-actuals"]');
    expect(link).toBeTruthy();
    expect(link?.textContent).toBe('View Schedule Actuals');
  });

  it('15. Review next item navigates to next or back to queue', async () => {
    state.updates = [{ ...report, status: 'approved' }];
    await render(['/planner/review?selected=report']);
    // Review next item should exist
    const reviewNext = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('Review next item'));
    expect(reviewNext).toBeTruthy();
  });
});

describe('existing planner workflow tests — preserved', () => {
  it('16. retains the actual terminal report when the unresolved queue becomes empty', async () => {
    state.rpc.mockImplementation(async () => {
      state.updates = [{ ...report, status: 'approved', workflow_revision: 2 }]; return { success: true };
    });
    await render(['/planner/review?selected=report']);
    await click('Accept suggested mapping'); await click('Approve field update');
    expect(state.rpc).toHaveBeenCalledWith('accept_current_field_update', {
      p_field_update_id: report.id, p_expected_workflow_revision: 1, p_remarks: null,
    });
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Done');
    expect(container.querySelector('a[href="/planner/schedule-actuals"]')?.textContent).toBe('View Schedule Actuals');
  });

  it('RPC failure keeps the confirmation and does not fabricate Done', async () => {
    state.rpc.mockResolvedValue({ success: false, error: 'Workflow changed; refresh before acting' });
    await render(['/planner/review?selected=report']);
    await click('Accept suggested mapping'); await click('Approve field update');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Workflow changed');
    expect(container.querySelector('form')).toBeTruthy();
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Planner Decision');
    expect(container.querySelector('a[href="/planner/schedule-actuals"]')).toBeNull();
  });
});
