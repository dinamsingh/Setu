// @vitest-environment jsdom
// Tell React's test act() that this environment supports act, so the
// hook's effect-driven state updates do not log act warnings.
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useScheduleData } from './useScheduleData';

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  order: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: mocks.eq,
        order: mocks.order,
      }),
    }),
  },
}));

function renderHook(baselineId?: string | null): Promise<ReturnType<typeof useScheduleData>> {
  return new Promise((resolve) => {
    const holder: { current: ReturnType<typeof useScheduleData> | null } = { current: null };
    const Probe = () => {
      holder.current = useScheduleData(baselineId);
      return null;
    };
    const root = createRoot(document.createElement('div'));
    act(() => {
      root.render(createElement(Probe));
    });
    // The hook resolves its state after the mocked query promise settles.
    setTimeout(() => resolve(holder.current as ReturnType<typeof useScheduleData>), 0);
  });
}

describe('useScheduleData scoped filter', () => {
  it('filters by baseline_id when a baseline is given', async () => {
    const chain = { order: mocks.order };
    mocks.eq.mockReturnValue(chain);
    mocks.order.mockResolvedValue({ data: [{ activity_id: 'A-1' }], error: null });
    await renderHook('base-sample');
    expect(mocks.eq).toHaveBeenCalledWith('baseline_id', 'base-sample');
  });

  it('does not filter when no baseline is given', async () => {
    mocks.eq.mockClear();
    mocks.order.mockResolvedValue({ data: [], error: null });
    await renderHook(null);
    expect(mocks.eq).not.toHaveBeenCalled();
  });
});
