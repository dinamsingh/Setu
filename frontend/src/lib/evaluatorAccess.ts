import { supabase } from './supabase';

export type EvaluatorRole = 'site' | 'planner';
export type EvaluatorAccount = { email: string; password: string };
export type EvaluatorAccess = {
  mode: 'real_authenticated';
  expiresAt: string;
  site: EvaluatorAccount;
  planner: EvaluatorAccount;
};

const KEY = 'setu-evaluator-24h-access';
// This holds two temporary, random password grants only in the active browser tab.
// Never put them in URLs, localStorage, analytics, HTML or GitHub.
const isAccount = (v: unknown): v is EvaluatorAccount => {
  if (!v || typeof v !== 'object') return false;
  const x = v as Record<string, unknown>;
  return typeof x.email === 'string' && x.email.length > 5 &&
    typeof x.password === 'string' && x.password.length >= 32;
};
const valid = (v: unknown): v is EvaluatorAccess => {
  if (!v || typeof v !== 'object') return false;
  const x = v as Record<string, unknown>;
  const expiry = typeof x.expiresAt === 'string' ? Date.parse(x.expiresAt) : NaN;
  return x.mode === 'real_authenticated' && Number.isFinite(expiry) &&
    Date.now() < expiry && isAccount(x.site) && isAccount(x.planner);
};
export function forgetEvaluatorAccess(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* private browser restrictions */ }
}
export function saveEvaluatorAccess(value: unknown): EvaluatorAccess {
  if (!valid(value)) throw new Error('SETU returned invalid or expired evaluator access.');
  try { sessionStorage.setItem(KEY, JSON.stringify(value)); }
  catch { throw new Error('This browser does not allow session storage for temporary evaluator access.'); }
  return value;
}
export function currentEvaluatorAccess(): EvaluatorAccess | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!valid(parsed)) { forgetEvaluatorAccess(); return null; }
    return parsed;
  } catch { forgetEvaluatorAccess(); return null; }
}
export function otherEvaluatorRole(email: string | undefined): EvaluatorRole | null {
  const access = currentEvaluatorAccess();
  if (!access || !email) return null;
  if (email === access.site.email) return 'planner';
  if (email === access.planner.email) return 'site';
  return null;
}
export async function enterEvaluatorRole(target: EvaluatorRole): Promise<void> {
  const access = currentEvaluatorAccess();
  if (!access) throw new Error('24-hour evaluator access has expired. Ask for another private invitation.');
  const account = access[target];
  const { data, error } = await supabase.auth.signInWithPassword(account);
  if (error || !data.user || !data.session) throw new Error('Could not sign in to the temporary ' + target + ' account.');
  // Only rely on the database-assigned role, NEVER a client-selected role string.
  const { data: assigned, error: roleError } = await supabase.from('user_roles')
    .select('role').eq('user_id', data.user.id).maybeSingle();
  if (roleError || assigned?.role !== target) {
    await supabase.auth.signOut();
    throw new Error('The temporary account has expired or does not have the expected role.');
  }
}
export async function redeemEvaluatorInvite(token: string): Promise<EvaluatorAccess> {
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('Invalid private evaluator link.');
  const url = (import.meta.env.VITE_SUPABASE_URL || 'https://zbndpmvihnsdknklmabn.supabase.co').replace(/\/+$/,'');
  const resp = await fetch(url + '/functions/v1/redeem-evaluator-invite', {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      // Public publishable key, never service_role.
      ...(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ? {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      } : {}),
    },
    body: JSON.stringify({ token }),
  });
  const parsed: unknown = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = parsed && typeof parsed === 'object' &&
      typeof (parsed as Record<string,unknown>).error === 'string'
      ? String((parsed as Record<string,unknown>).error) : 'Evaluator service unavailable.';
    throw new Error(msg);
  }
  return saveEvaluatorAccess(parsed);
}
