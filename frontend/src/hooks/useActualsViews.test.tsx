// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useScheduleActuals } from './useScheduleActuals';
import { useActualsEvidence } from './useActualsEvidence';
import { supabase } from '../lib/supabase';

const identity = vi.hoisted(() => ({ user: { id: 'planner' } as { id: string } | null, role: 'planner' }));
vi.mock('../lib/AuthContext', () => ({ useAuth: () => identity }));
vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }));
let root: Root;
let container: HTMLDivElement;
const range = vi.fn(); const eq = vi.fn(); const order = vi.fn(); const select = vi.fn();
function Summary() {
  const result = useScheduleActuals();
  return <div>{JSON.stringify(result)}<button onClick={result.refetch}>Refresh</button></div>;
}
function Evidence({ id }: { id: string | null }) {
  const result = useActualsEvidence(id);
  return <div>{JSON.stringify(result)}<button onClick={result.refetch}>Retry</button><button onClick={result.next}>Next</button><button onClick={result.previous}>Previous</button></div>;
}
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  identity.user = { id: 'planner' }; identity.role = 'planner'; vi.clearAllMocks();
  const query = { select, eq, order, range }; select.mockReturnValue(query); eq.mockReturnValue(query); order.mockReturnValue(query);
  range.mockResolvedValue({ data: [], error: null }); vi.mocked(supabase.from).mockReturnValue(query as never);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
it('summary reads on entry and explicit Refresh, never polls', async () => {
  vi.useFakeTimers(); await act(async () => root.render(<Summary/>));
  expect(supabase.from).toHaveBeenCalledWith('schedule_actuals_overlay'); expect(range).toHaveBeenCalledWith(0, 199);
  await act(async () => vi.advanceTimersByTimeAsync(60000)); expect(range).toHaveBeenCalledTimes(1);
  await act(async () => container.querySelector('button')!.click()); expect(range).toHaveBeenCalledTimes(2);
});
it('summary pages baseline activities instead of silently truncating at API cap', async () => {
  range.mockResolvedValueOnce({ data: Array.from({ length: 200 }, (_, i) => ({ activity_id: `ACT-${i}` })), error: null })
    .mockResolvedValueOnce({ data: [{ activity_id: 'last-activity' }], error: null });
  await act(async () => root.render(<Summary/>)); expect(range).toHaveBeenCalledWith(200, 399);
  expect(container.textContent).toContain('last-activity');
});
it('summary surfaces error and clears stale data while retrying', async () => {
  range.mockResolvedValueOnce({ data: null, error: { message: 'View unavailable' } });
  await act(async () => root.render(<Summary/>)); expect(container.textContent).toContain('View unavailable');
  range.mockResolvedValueOnce({ data: [{ activity_id: 'recovered' }], error: null });
  await act(async () => container.querySelector('button')!.click()); expect(container.textContent).toContain('recovered');
  expect(container.textContent).not.toContain('View unavailable');
});
it('fetches provenance only for the selected activity with bounded pagination', async () => {
  await act(async () => root.render(<Evidence id={null}/>)); expect(range).not.toHaveBeenCalled();
  range.mockResolvedValueOnce({ data: Array.from({ length: 101 }, (_, i) => ({ event_id: `e-${i}` })), error: null });
  await act(async () => root.render(<Evidence id="ACT-A"/>));
  expect(eq).toHaveBeenCalledWith('activity_id', 'ACT-A'); expect(range).toHaveBeenCalledWith(0, 100);
  expect(container.textContent).toContain('"hasMore":true'); expect(container.textContent).not.toContain('e-100');
  await act(async () => container.querySelectorAll('button')[1].click()); expect(range).toHaveBeenCalledWith(100, 200);
});
it('discards stale selected-activity responses', async () => {
  let resolve!: (value: unknown) => void;
  range.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await act(async () => root.render(<Evidence id="ACT-A"/>));
  range.mockResolvedValueOnce({ data: [{ event_id: 'current-B' }], error: null });
  await act(async () => root.render(<Evidence id="ACT-B"/>));
  await act(async () => resolve({ data: [{ event_id: 'stale-A' }], error: null }));
  expect(container.textContent).not.toContain('stale-A'); expect(container.textContent).toContain('current-B');
});
it('discards old-user results and denies client reads for site/engineer', async () => {
  let resolve!: (value: unknown) => void;
  range.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await act(async () => root.render(<Summary/>)); identity.user = { id: 'site' }; identity.role = 'site';
  await act(async () => root.render(<Summary/>));
  await act(async () => resolve({ data: [{ activity_id: 'private-old-user-data' }], error: null }));
  expect(container.textContent).not.toContain('private-old-user-data'); expect(range).toHaveBeenCalledTimes(1);
  identity.role = 'engineer'; await act(async () => root.render(<Evidence id="ACT-A"/>)); expect(range).toHaveBeenCalledTimes(1);
});
it('provenance surfaces errors and retries without any write path', async () => {
  range.mockResolvedValueOnce({ data: null, error: { message: 'Evidence denied' } });
  await act(async () => root.render(<Evidence id="ACT-A"/>)); expect(container.textContent).toContain('Evidence denied');
  range.mockResolvedValueOnce({ data: [{ event_id: 'retried' }], error: null });
  await act(async () => container.querySelector('button')!.click()); expect(container.textContent).toContain('retried');
});
it('resets provenance page on selection change and clears previous results', async () => {
  await act(async () => root.render(<Evidence id="ACT-A"/>));
  await act(async () => container.querySelectorAll('button')[1].click());
  await act(async () => root.render(<Evidence id="ACT-B"/>));
  expect(range).toHaveBeenLastCalledWith(0, 100); expect(container.textContent).toContain('"page":0');
});
