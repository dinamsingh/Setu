// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configuration = vi.hoisted(() => ({ configured: false }));
const supabase = vi.hoisted(() => ({
  from: vi.fn(),
  getSession: vi.fn(),
  maybeSingle: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('./supabase', () => ({
  get isSupabaseConfigured() {
    return configuration.configured;
  },
  SUPABASE_CONFIGURATION_ERROR: 'SETU authentication is not configured for this local workspace. Add VITE_SUPABASE_PUBLISHABLE_KEY to .env.local.',
  supabase: {
    auth: {
      getSession: supabase.getSession,
      onAuthStateChange: supabase.onAuthStateChange,
      signInWithPassword: supabase.signInWithPassword,
      signOut: supabase.signOut,
    },
    from: supabase.from,
  },
}));

import { AuthProvider, useAuth } from './AuthContext';

let root: Root;
let container: HTMLDivElement;

function AuthProbe({ children }: { children?: ReactNode }) {
  const { loading, role, session, sessionIssue, signIn } = useAuth();
  const [message, setMessage] = useState('');
  return <>
    <output data-testid="loading">{String(loading)}</output>
    <output data-testid="user">{session?.user.id ?? ''}</output>
    <output data-testid="role">{role ?? ''}</output>
    <output data-testid="session-issue">{sessionIssue ?? ''}</output>
    <output data-testid="message">{message}</output>
    <button type="button" onClick={async () => setMessage((await signIn('person@setu.local', 'not-a-real-password')).error?.message ?? '')}>Sign in</button>
    {children}
  </>;
}

const signedInSession = { user: { id: 'user-1' } } as unknown as Session;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  configuration.configured = false;
  supabase.from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({ maybeSingle: supabase.maybeSingle }),
    }),
  }));
  supabase.getSession.mockResolvedValue({ data: { session: null }, error: null });
  supabase.maybeSingle.mockResolvedValue({ data: { role: 'planner' }, error: null });
  supabase.onAuthStateChange.mockImplementation(() => ({
    data: { subscription: { unsubscribe: supabase.unsubscribe } },
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function render() {
  await act(async () => {
    root.render(<AuthProvider><AuthProbe /></AuthProvider>);
    await Promise.resolve();
  });
}

async function flushTimers() {
  await act(async () => {
    await vi.runAllTimersAsync();
    await Promise.resolve();
  });
}

describe('AuthContext missing local configuration', () => {
  it('fails closed without restoring a session or invoking Supabase Auth', async () => {
    await render();
    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe('false');
    expect(supabase.getSession).not.toHaveBeenCalled();
    expect(supabase.onAuthStateChange).not.toHaveBeenCalled();

    const button = container.querySelector('button');
    await act(async () => button?.click());

    expect(supabase.signInWithPassword).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="message"]')?.textContent).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
  });
});

describe('AuthContext session and callback safety', () => {
  it('restores a session, resolves its role, and clears loading', async () => {
    configuration.configured = true;
    vi.useFakeTimers();
    supabase.getSession.mockResolvedValue({ data: { session: signedInSession }, error: null });

    await render();
    await flushTimers();

    expect(container.querySelector('[data-testid="user"]')?.textContent).toBe('user-1');
    expect(container.querySelector('[data-testid="role"]')?.textContent).toBe('planner');
    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe('false');
  });

  it('does not make a Supabase call from the auth callback, then resolves the role after it returns', async () => {
    configuration.configured = true;
    vi.useFakeTimers();
    let callback: ((event: string, session: Session | null) => void) | undefined;
    supabase.onAuthStateChange.mockImplementation((handler) => {
      callback = handler;
      return { data: { subscription: { unsubscribe: supabase.unsubscribe } } };
    });

    await render();
    expect(callback).toBeTypeOf('function');

    const callbackResult = callback?.('SIGNED_IN', signedInSession);
    expect(callbackResult).toBeUndefined();
    expect(supabase.from).not.toHaveBeenCalled();

    await flushTimers();
    expect(supabase.from).toHaveBeenCalledWith('user_roles');
    expect(container.querySelector('[data-testid="role"]')?.textContent).toBe('planner');
  });

  it('ignores a queued role lookup after a later signed-out event and unsubscribes on unmount', async () => {
    configuration.configured = true;
    vi.useFakeTimers();
    let callback: ((event: string, session: Session | null) => void) | undefined;
    supabase.onAuthStateChange.mockImplementation((handler) => {
      callback = handler;
      return { data: { subscription: { unsubscribe: supabase.unsubscribe } } };
    });

    await render();
    callback?.('SIGNED_IN', signedInSession);
    callback?.('SIGNED_OUT', null);
    await flushTimers();

    expect(supabase.from).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="role"]')?.textContent).toBe('');
    await act(async () => root.unmount());
    expect(supabase.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('distinguishes network failures and missing active sessions during sign-in', async () => {
    configuration.configured = true;
    supabase.signInWithPassword.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await render();
    const button = container.querySelector('button');
    await act(async () => button?.click());
    expect(container.querySelector('[data-testid="message"]')?.textContent).toContain('Network error while signing in');

    supabase.signInWithPassword.mockResolvedValueOnce({ data: { session: null, user: null }, error: null });
    await act(async () => button?.click());
    expect(container.querySelector('[data-testid="message"]')?.textContent).toContain('did not create an active session');
  });
});
