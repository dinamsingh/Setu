// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScheduleActuals } from './ScheduleActuals';
import { actualsEvidence, actualsRow } from '../../test/actualsFixtures';

const state = vi.hoisted(() => ({ summary: { rows: [] as unknown[], loading: false, error: null as string | null, refetch: vi.fn() },
  evidence: { events: [] as unknown[], loading: false, error: null as string | null, page: 0, hasMore: false, next: vi.fn(), previous: vi.fn(), refetch: vi.fn() } }));
vi.mock('../../hooks/useScheduleActuals', () => ({ useScheduleActuals: () => state.summary }));
vi.mock('../../hooks/useActualsEvidence', () => ({ useActualsEvidence: () => state.evidence }));
vi.mock('../../components/common/Header', () => ({ Header: () => <header/> }));
vi.mock('../../components/common/Sidebar', () => ({ Sidebar: () => <aside/> }));
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); state.summary.rows = [actualsRow]; state.summary.loading = false; state.summary.error = null;
  Element.prototype.scrollIntoView = vi.fn();
  state.evidence.events = [actualsEvidence]; state.evidence.loading = false; state.evidence.error = null;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(<ScheduleActuals/>)); }
async function click(text: string) { await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === text)!.click()); }
it('shows required derived-overlay disclaimer without writeback claims or edit controls', async () => {
  await render(); expect(container.textContent).toContain('SETU actuals overlay — derived from current planner-approved evidence. Imported baseline unchanged.');
  expect(container.textContent).toContain('No baseline updates or Primavera writeback');
  expect([...container.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Refresh', 'View evidence']);
});
it('opens/closes provenance with selected sources, report revision and authoritative audit actor', async () => {
  await render(); expect(container.querySelector('[aria-label="Evidence for ACT-A"]')).toBeNull();
  await click('View evidence');
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  for (const text of ['Selected source', 'FU-001', 'evidence revision 2', 'Rack B piping started today', 'Explicit actual START',
    'authoritative-planner-id', 'audit-id', 'display label only', '2026-09-03T12:00:00Z']) expect(container.textContent).toContain(text);
  await act(async () => (container.querySelector('[aria-label="Close evidence"]') as HTMLButtonElement).click());
  expect(container.querySelector('[aria-label="Evidence for ACT-A"]')).toBeNull();
});
it('explicit Refresh closes provenance and refreshes summary', async () => {
  await render(); await click('View evidence'); await click('Refresh');
  expect(state.summary.refetch).toHaveBeenCalledTimes(1); expect(container.querySelector('[aria-label="Evidence for ACT-A"]')).toBeNull();
});
it('shows independent provenance loading/error/empty states and retry', async () => {
  state.evidence.loading = true; await render(); await click('View evidence'); expect(container.textContent).toContain('Loading evidence');
  state.evidence.loading = false; state.evidence.error = 'Read failed'; await render(); expect(container.textContent).toContain('Could not load evidence: Read failed');
  await click('Retry evidence'); expect(state.evidence.refetch).toHaveBeenCalledTimes(1);
  state.evidence.error = null; state.evidence.events = []; await render(); expect(container.textContent).toContain('No current eligible evidence returned');
});
it('shows source dates unresolved without presenting report-date fallback as actual start', async () => {
  state.summary.rows = [{ ...actualsRow, actual_start: null, actual_finish: null, unresolved_event_date: true }];
  state.evidence.events = [{ ...actualsEvidence, event_date: null, chronology_basis: 'reported_date' }];
  await render(); await click('View evidence');
  expect(container.textContent).toContain('Approved evidence; date unresolved'); expect(container.textContent).toContain('Date unresolved');
  expect(container.textContent).toContain('reported_date; not an inferred START/FINISH date');
});
