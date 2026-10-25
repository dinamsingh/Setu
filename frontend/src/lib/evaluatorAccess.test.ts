// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentEvaluatorAccess, enterEvaluatorRole, forgetEvaluatorAccess,
  otherEvaluatorRole, redeemEvaluatorInvite, saveEvaluatorAccess,
} from './evaluatorAccess';

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  maybeSingle: vi.fn(),
}));
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
  },
}));

const makeAccess = () => ({
  mode: 'real_authenticated' as const,
  expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  site: { email: 'site@evaluator.invalid', password: 'a'.repeat(64) },
  planner: { email: 'planner@evaluator.invalid', password: 'b'.repeat(64) },
});
beforeEach(() => {
  forgetEvaluatorAccess();
  vi.restoreAllMocks();
  mocks.signInWithPassword.mockResolvedValue({
    data: { session: { access_token: 'fake' }, user: { id: 'test-user' } }, error: null,
  });
  mocks.maybeSingle.mockResolvedValue({ data: { role: 'site' }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});
afterEach(() => {
  forgetEvaluatorAccess();
  vi.unstubAllGlobals();
});

describe('Real temporary evaluator access', () => {
  it('keeps issued credentials in sessionStorage and recognizes both personas', () => {
    saveEvaluatorAccess(makeAccess());
    expect(otherEvaluatorRole('site@evaluator.invalid')).toBe('planner');
    expect(otherEvaluatorRole('planner@evaluator.invalid')).toBe('site');
    expect(currentEvaluatorAccess()?.site.password).toHaveLength(64);
    expect(localStorage.length).toBe(0);
  });

  it('rejects and clears expired access', () => {
    saveEvaluatorAccess(makeAccess());
    const stored = JSON.parse(sessionStorage.getItem('setu-evaluator-24h-access') || '{}');
    stored.expiresAt = new Date(Date.now() - 1000).toISOString();
    sessionStorage.setItem('setu-evaluator-24h-access', JSON.stringify(stored));
    expect(currentEvaluatorAccess()).toBeNull();
    expect(sessionStorage.getItem('setu-evaluator-24h-access')).toBeNull();
  });

  it('does not trust caller-selected role if Supabase role table disagrees', async () => {
    saveEvaluatorAccess(makeAccess());
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'planner' }, error: null });
    await expect(enterEvaluatorRole('site')).rejects.toThrow('expected role');
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it('authenticates with real Supabase password flow and checks DB role', async () => {
    saveEvaluatorAccess(makeAccess());
    await enterEvaluatorRole('site');
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'site@evaluator.invalid', password: 'a'.repeat(64),
    });
    expect(mocks.maybeSingle).toHaveBeenCalledOnce();
  });

  it('rejects guessed/bad private links without network calls', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(redeemEvaluatorInvite('123')).rejects.toThrow('Invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redeems a proper one-time invite and keeps it only in the current tab', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => makeAccess(),
    });
    vi.stubGlobal('fetch', fetchMock);
    await redeemEvaluatorInvite('f'.repeat(64));
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = fetchMock.mock.calls[0][0] as string;
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(url).toContain('/functions/v1/redeem-evaluator-invite');
    expect(options.cache).toBe('no-store');
    expect(options.credentials).toBe('omit');
    expect(options.body).toBe(JSON.stringify({ token: 'f'.repeat(64) }));
    expect(currentEvaluatorAccess()?.planner.email).toBe('planner@evaluator.invalid');
  });
});
