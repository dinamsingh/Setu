// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supabase = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('./supabase', () => ({
  isSupabaseConfigured: false,
  SUPABASE_CONFIGURATION_ERROR: 'SETU authentication is not configured for this local workspace. Add VITE_SUPABASE_PUBLISHABLE_KEY to .env.local.',
  supabase: {
    auth: {
      getSession: supabase.getSession,
      onAuthStateChange: supabase.onAuthStateChange,
      signInWithPassword: supabase.signInWithPassword,
      signOut: supabase.signOut,
    },
  },
}));

import { AuthProvider, useAuth } from './AuthContext';

let root: Root;
let container: HTMLDivElement;

function AuthProbe() {
  const { loading, signIn } = useAuth();
  const [message, setMessage] = useState('');
  return <>
    <output data-testid="loading">{String(loading)}</output>
    <output data-testid="message">{message}</output>
    <button type="button" onClick={async () => setMessage((await signIn('person@setu.local', 'password123')).error?.message ?? '')}>Sign in</button>
  </>;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('AuthContext missing local configuration', () => {
  it('fails closed without restoring a session or invoking Supabase Auth', async () => {
    await act(async () => root.render(<AuthProvider><AuthProbe /></AuthProvider>));
    expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe('false');
    expect(supabase.getSession).not.toHaveBeenCalled();
    expect(supabase.onAuthStateChange).not.toHaveBeenCalled();

    const button = container.querySelector('button');
    await act(async () => button?.click());

    expect(supabase.signInWithPassword).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="message"]')?.textContent).toContain('VITE_SUPABASE_PUBLISHABLE_KEY');
  });
});
