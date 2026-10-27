import { supabase } from './supabase';

export type EvaluatorRole = 'site' | 'planner';
export type EvaluatorAccount = { email: string; password: string };
export type EvaluatorAccess = {
  mode: 'real_authenticated';
  expiresAt: string;
  site: EvaluatorAccount;
  planner: EvaluatorAccount;
};

const KEY = 'setu-evaluator-48h-access';
// P0 fix: the pair lives for 48 hours, so tab-only sessionStorage was the
// wrong lifetime. A logout + role switch in a new tab, or a closed and
// reopened tab, emptied sessionStorage and the pair vanished from the page
// even though the Supabase accounts were still valid for 48 hours.
// These are disposable, isolated demo accounts (no real evaluator data), so
// the pair is kept in this browser's localStorage until expiry or until the
// evaluator explicitly ends the demo. Never put them in URLs, analytics,
// HTML or GitHub. On a shared computer, use "End demo & forget credentials".
export function storageForEvaluatorAccess(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch { /* private browser restrictions */ }
  return null;
}
const isAccount = (v: unknown): v is EvaluatorAccount => {
  if (!v || typeof v !== 'object') return false;
  const x = v as Record<string, unknown>;
  return typeof x.email === 'string' && x.email.length > 5 &&
    typeof x.password === 'string' && x.password.length >= 20;
};
const valid = (v: unknown): v is EvaluatorAccess => {
  if (!v || typeof v !== 'object') return false;
  const x = v as Record<string, unknown>;
  const expiry = typeof x.expiresAt === 'string' ? Date.parse(x.expiresAt) : NaN;
  return x.mode === 'real_authenticated' && Number.isFinite(expiry) &&
    Date.now() < expiry && isAccount(x.site) && isAccount(x.planner);
};
export function forgetEvaluatorAccess(): void {
  // Clear both stores: the current store and any legacy tab-only copy, so
  // "End demo" really forgets the pair everywhere in this browser.
  try { localStorage.removeItem(KEY); } catch { /* private browser restrictions */ }
  try { sessionStorage.removeItem(KEY); } catch { /* private browser restrictions */ }
}
export function saveEvaluatorAccess(value: unknown): EvaluatorAccess {
  if (!valid(value)) throw new Error('SETU returned invalid or expired evaluator access.');
  const store = storageForEvaluatorAccess();
  if (!store) throw new Error('This browser does not allow storage for temporary evaluator access.');
  try { store.setItem(KEY, JSON.stringify(value)); }
  catch { throw new Error('This browser does not allow storage for temporary evaluator access.'); }
  try { sessionStorage.removeItem(KEY); } catch { /* legacy copy cleanup */ }
  return value;
}
export function currentEvaluatorAccess(): EvaluatorAccess | null {
  try {
    // Migrate a legacy tab-only pair once, so evaluators who generated
    // credentials before this fix do not lose them on the next page load.
    let raw: string | null = null;
    try { raw = localStorage.getItem(KEY); } catch { /* private browser restrictions */ }
    if (!raw) {
      try { raw = sessionStorage.getItem(KEY); } catch { /* private browser restrictions */ }
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (valid(parsed)) {
            try { localStorage.setItem(KEY, JSON.stringify(parsed)); } catch { /* keep tab copy */ }
            try { sessionStorage.removeItem(KEY); } catch { /* legacy copy cleanup */ }
          }
        } catch { /* fall through to the invalid-pair handling below */ }
      }
    }
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
  if (!access) throw new Error('48-hour evaluator access has expired. Generate a fresh demo pair.');
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
/**
 * Creates a fresh REAL 48-hour linked Supervisor/Planner workspace. The
 * backend checks Turnstile, quotas, role provisioning and expiry.
 */
export async function createEvaluatorWorkspace(turnstileToken:string): Promise<EvaluatorAccess> {
  if(!turnstileToken || turnstileToken.length>2048)throw new Error("Security check required.");
  const url=(import.meta.env.VITE_SUPABASE_URL || 'https://zbndpmvihnsdknklmabn.supabase.co').replace(/\/+$/,'');
  const resp=await fetch(url+'/functions/v1/create-evaluator-workspace',{
    method:'POST',credentials:'omit',cache:'no-store',
    headers:{
      'Content-Type':'application/json',
      ...(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ? {
        apikey:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      } : {}),
    },
    body:JSON.stringify({turnstileToken}),
  });
  const parsed:unknown=await resp.json().catch(()=>null);
  if(!resp.ok){
    const msg=parsed && typeof parsed==='object' &&
      typeof (parsed as Record<string,unknown>).error==='string'
      ? String((parsed as Record<string,unknown>).error) : 'Evaluator service unavailable.';
    throw new Error(msg);
  }
  return saveEvaluatorAccess(parsed);
}
