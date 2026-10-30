import { supabase } from './supabase';

/**
 * Planner-scoped supervisors (Migration 017).
 *
 * A planner creates a supervisor for ONE schedule baseline. The browser
 * never holds a service_role key: it calls the create-planner-supervisor
 * Edge Function with the planner's own JWT plus the publishable key only,
 * exactly like the evaluator flow calls its function. The server verifies
 * the planner role, verifies baseline ownership, generates the password,
 * and returns it ONCE. This module never stores that password anywhere.
 */

export type ScheduleBaseline = {
  id: string;
  name: string;
  owner_planner_id: string | null;
  is_sample: boolean;
  created_at?: string;
};

export type PlannerSupervisorAssignment = {
  id: string;
  baseline_id: string;
  supervisor_id: string;
  planner_id: string;
  created_at?: string;
  schedule_baselines?: { name: string; is_sample: boolean } | null;
};

export type CreatedSupervisor = {
  email: string;
  password: string;
  supervisor_id: string;
  baseline_id: string;
  baseline_name: string;
  is_sample: boolean;
};

export function functionsBaseUrl(): string {
  return (
    import.meta.env.VITE_SUPABASE_URL ||
    'https://zbndpmvihnsdknklmabn.supabase.co'
  ).replace(/\/+$/, '');
}

function parseError(parsed: unknown, fallback: string): string {
  if (parsed && typeof parsed === 'object') {
    const err = (parsed as Record<string, unknown>).error;
    if (typeof err === 'string' && err.length > 0) return err;
  }
  return fallback;
}

export async function listMyBaselines(): Promise<ScheduleBaseline[]> {
  const { data, error } = await supabase
    .from('schedule_baselines')
    .select('id, name, owner_planner_id, is_sample, created_at')
    .order('is_sample', { ascending: false })
    .order('name', { ascending: true });
  if (error) {
    throw new Error(
      'Planner supervisor setup is not live yet. Migration 017 and the ' +
        'create-planner-supervisor function must be deployed first.',
    );
  }
  return (data || []) as ScheduleBaseline[];
}

export async function listMyAssignments(): Promise<PlannerSupervisorAssignment[]> {
  const { data, error } = await supabase
    .from('planner_supervisor_assignments')
    .select('id, baseline_id, supervisor_id, planner_id, created_at, schedule_baselines(name, is_sample)')
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(
      'Planner supervisor setup is not live yet. Migration 017 and the ' +
        'create-planner-supervisor function must be deployed first.',
    );
  }
  // PostgREST may return the joined baseline as an object or a list;
  // normalise to the single object the UI expects.
  return ((data || []) as Array<Record<string, unknown>>).map((row) => {
    const joined = row.schedule_baselines;
    return {
      ...row,
      schedule_baselines: Array.isArray(joined) ? joined[0] ?? null : joined ?? null,
    } as PlannerSupervisorAssignment;
  });
}

export async function createPlannerSupervisor(input: {
  supervisorName: string;
  workEmail: string;
  baselineId: string;
}): Promise<CreatedSupervisor> {
  const name = input.supervisorName.trim();
  const email = input.workEmail.trim().toLowerCase();
  const baselineId = input.baselineId.trim();
  if (name.length < 2 || name.length > 100) {
    throw new Error('Supervisor name is required (2–100 characters).');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new Error('Enter a valid work email.');
  }
  if (!baselineId) {
    throw new Error('Choose a schedule baseline first.');
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new Error('Sign in as a planner to add a supervisor.');
  }
  const resp = await fetch(functionsBaseUrl() + '/functions/v1/create-planner-supervisor', {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      ...(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
        ? { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }
        : {}),
    },
    body: JSON.stringify({ supervisorName: name, workEmail: email, baselineId }),
  });
  const parsed: unknown = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(parseError(parsed, 'Could not create this supervisor.'));
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as Record<string, unknown>).email !== 'string' ||
    typeof (parsed as Record<string, unknown>).password !== 'string'
  ) {
    throw new Error('Planner supervisor service returned an invalid response.');
  }
  return parsed as CreatedSupervisor;
}
