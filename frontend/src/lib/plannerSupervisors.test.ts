// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPlannerSupervisor,
  listMyBaselines,
  listMyAssignments,
} from './plannerSupervisors';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  from: vi.fn(),
}));

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    from: mocks.from,
  },
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: 'planner-token' } },
    error: null,
  });
  // Default: baselines and assignments queries succeed with empty rows.
  mocks.from.mockImplementation(() => ({
    select: () => ({
      order: () => Promise.resolve({ data: [], error: null }),
    }),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('plannerSupervisors', () => {
  it('creates a supervisor through the Edge Function with the planner JWT, never a service key', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        email: 'supervisor@example.com',
        password: 'SETU-XXXX-XXXX-XXXX-XXXX',
        supervisor_id: 'sup-1',
        baseline_id: 'base-1',
        baseline_name: 'Sample Baseline',
        is_sample: true,
      }),
    });
    const created = await createPlannerSupervisor({
      supervisorName: 'Demo Supervisor',
      workEmail: 'supervisor@example.com',
      baselineId: 'base-1',
    });
    expect(created.email).toBe('supervisor@example.com');
    expect(created.baseline_name).toBe('Sample Baseline');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/create-planner-supervisor');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer planner-token');
    expect(JSON.stringify(init.headers)).not.toContain('service_role');
    expect(JSON.stringify(init.body)).toContain('base-1');
  });

  it('surfaces an already-registered email as a clear error', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'This work email is already registered. Use a different email or sign in with the existing account.',
      }),
    });
    await expect(
      createPlannerSupervisor({
        supervisorName: 'Demo Supervisor',
        workEmail: 'taken@example.com',
        baselineId: 'base-1',
      }),
    ).rejects.toThrow('already registered');
  });

  it('rejects a missing baseline before any network call', async () => {
    await expect(
      createPlannerSupervisor({
        supervisorName: 'Demo Supervisor',
        workEmail: 'supervisor@example.com',
        baselineId: '',
      }),
    ).rejects.toThrow('Choose a schedule baseline');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists baselines and assignments from the scoped tables', async () => {
    mocks.from.mockImplementation((table: string) => {
      const rows =
        table === 'schedule_baselines'
          ? [{ id: 'base-1', name: 'Sample Baseline', is_sample: true, owner_planner_id: null }]
          : [{ id: 'asg-1', baseline_id: 'base-1', supervisor_id: 'sup-1', planner_id: 'plan-1' }];
      // Supabase query builders chain .order() calls; the final call resolves.
      const chain: { order: () => unknown } = {
        order: () => chain,
      };
      let calls = 0;
      chain.order = () => {
        calls += 1;
        return calls === 1 && table === 'schedule_baselines'
          ? chain
          : Promise.resolve({ data: rows, error: null });
      };
      return { select: () => chain };
    });
    const baselines = await listMyBaselines();
    expect(baselines[0].is_sample).toBe(true);
    const assignments = await listMyAssignments();
    expect(assignments[0].supervisor_id).toBe('sup-1');
  });
});
