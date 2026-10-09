// @vitest-environment jsdom
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProgressEvents } from './useProgressEvents';
import { supabase } from '../lib/supabase';
import { report } from '../test/workflowFixtures';
import type { FieldUpdate } from '../types';
import { ProgressEventsSection } from '../components/planner/ProgressEventsSection';

const identity = vi.hoisted(() => ({ user: { id: 'planner' } as { id: string } | null }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => identity }));
vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }));
let root: Root;
let container: HTMLDivElement;
const eq = vi.fn();
const order = vi.fn();
const select = vi.fn();
const current = { ...report, evidence_revision: 1, progress_extraction_revision: 1 };
function Probe({ update, refresh }: { update: FieldUpdate; refresh?: (isPolling: boolean) => Promise<void> }) {
  const result = useProgressEvents(update, refresh);
  return <div>{JSON.stringify(result)}<button onClick={result.refetch}>Retry</button></div>;
}
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  identity.user = { id: 'planner' }; vi.clearAllMocks();
  const query = { select, eq, order }; select.mockReturnValue(query); eq.mockReturnValue(query);
  vi.mocked(supabase.from).mockReturnValue(query as never);
  order.mockResolvedValue({ data: [], error: null });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function render(update: FieldUpdate) { await act(async () => root.render(<Probe update={update} />)); }
it('queries only selected parent/current revision when extraction is completed', async () => {
  order.mockResolvedValue({ data: [{ id: 'current-event' }], error: null });
  await render(current);
  expect(supabase.from).toHaveBeenCalledWith('progress_events');
  expect(eq).toHaveBeenCalledWith('field_update_id', report.id);
  expect(eq).toHaveBeenCalledWith('evidence_revision', 1);
  expect(order).toHaveBeenCalledWith('event_index', { ascending: true });
  expect(container.textContent).toContain('current-event');
});
it('does not fetch or show historical events while current extraction is pending', async () => {
  await render({ ...current, progress_extraction_revision: 0 });
  expect(supabase.from).not.toHaveBeenCalled(); expect(container.textContent).toContain('"events":[]');
});
it('ignores stale in-flight results after evidence revision changes', async () => {
  let resolve!: (value: unknown) => void;
  order.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await render(current);
  await render({ ...current, evidence_revision: 2 });
  await act(async () => resolve({ data: [{ id: 'stale-event' }], error: null }));
  expect(container.textContent).not.toContain('stale-event');
});
it('hides events on parent/identity change and ignores an obsolete response', async () => {
  let resolve!: (value: unknown) => void;
  order.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await render(current); identity.user = { id: 'another-planner' };
  await render({ ...current, id: 'another-report' });
  await act(async () => resolve({ data: [{ id: 'previous-user-event' }], error: null }));
  expect(container.textContent).not.toContain('previous-user-event');
});
it('surfaces fetch errors and allows read-only retry', async () => {
  order.mockResolvedValueOnce({ data: null, error: { message: 'Read failed' } });
  await render(current); expect(container.textContent).toContain('Read failed');
  order.mockResolvedValueOnce({ data: [{ id: 'retried-event' }], error: null });
  await act(async () => container.querySelector('button')!.click());
  expect(container.textContent).toContain('retried-event'); expect(container.textContent).not.toContain('Read failed');
});

it('keeps refreshing after matching completes and stops when current events appear without reload', async () => {
  vi.useFakeTimers();
  let stored: FieldUpdate = { ...current, confidence_level: 'Pending', progress_extraction_revision: 0 };
  let setUpdate!: (update: FieldUpdate) => void;
  const refresh = vi.fn(async () => { setUpdate({ ...stored }); });
  function PlannerProbe() {
    const [update, set] = useState(stored);
    useEffect(() => { setUpdate = set; }, []);
    const result = useProgressEvents(update, refresh);
    return <ProgressEventsSection update={update} events={result.events} loading={result.loading} error={result.error} />;
  }
  await act(async () => root.render(<PlannerProbe />));
  expect(container.textContent).toContain('Awaiting structured progress extraction');
  expect(order).not.toHaveBeenCalled();
  stored = { ...stored, confidence_level: 'High' };
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(refresh).toHaveBeenCalledWith(true);
  expect(container.textContent).toContain('Awaiting structured progress extraction');
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(refresh).toHaveBeenCalledTimes(2);
  order.mockResolvedValue({ data: [{ id: 'later-event', field_update_id: report.id, evidence_revision: 1,
    event_index: 0, event_type: 'START', event_date: '2026-10-03', evidence_text: 'started today',
    extraction_reason: 'Explicit start', extraction_version: 'phase1_rules_v1' }], error: null });
  stored = { ...stored, progress_extraction_revision: 1 };
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(container.textContent).toContain('START');
  expect(container.textContent).not.toContain('Awaiting structured progress extraction');
  expect(eq).toHaveBeenCalledWith('evidence_revision', 1);
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(refresh).toHaveBeenCalledTimes(3);
  expect(order).toHaveBeenCalledTimes(1);
});
it('does not start extra polling for completed extraction and cleans up when unmounted', async () => {
  vi.useFakeTimers();
  const refresh = vi.fn(async () => {});
  await act(async () => root.render(<Probe update={current} refresh={refresh} />));
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => root.render(<Probe update={{ ...current, evidence_revision: 2 }} refresh={refresh} />));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null));
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(refresh).toHaveBeenCalledTimes(1);
});
it('bounds pending refresh to one in-flight request and cancels on identity change', async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  const refresh = vi.fn(() => new Promise<void>(r => { resolve = r; }));
  await act(async () => root.render(<Probe update={{ ...current, progress_extraction_revision: 0 }} refresh={refresh} />));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(refresh).toHaveBeenCalledTimes(1);
  identity.user = null;
  await act(async () => root.render(<Probe update={current} refresh={refresh} />));
  await act(async () => { resolve(); });
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(refresh).toHaveBeenCalledTimes(1);
});
