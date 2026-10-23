// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleSelection } from './RoleSelection';

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  refreshRole: vi.fn(),
}));

vi.mock('../lib/AuthContext', () => ({
  useAuth: () => ({ signIn: auth.signIn, refreshRole: auth.refreshRole, sessionIssue: null }),
}));

let root: Root;
let container: HTMLDivElement;

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  auth.signIn.mockResolvedValue({ error: null, userId: 'user-1' });
  auth.refreshRole.mockResolvedValue('planner');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={['/']}><RoleSelection /><LocationProbe /></MemoryRouter>);
  });
}

async function changeInput(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  expect(input).toBeTruthy();
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  const form = container.querySelector('form');
  expect(form).toBeTruthy();
  await act(async () => {
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('Login V2 role selection', () => {
  it('validates required credentials before calling Supabase Auth', async () => {
    await render();
    await submit();

    expect(auth.signIn).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Check these fields to continue.');
    expect(container.querySelector('#setu-email')?.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('#setu-password')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('shows invalid-credential failures without attempting role resolution', async () => {
    auth.signIn.mockResolvedValue({ error: new Error('Invalid login credentials'), userId: null });
    await render();
    await changeInput('setu-email', 'person@setu.local');
    await changeInput('setu-password', 'incorrect-password');
    await submit();

    expect(auth.signIn).toHaveBeenCalledWith('person@setu.local', 'incorrect-password');
    expect(auth.refreshRole).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Invalid login credentials');
  });

  it('resolves a planner role and redirects to the planner command center', async () => {
    auth.refreshRole.mockResolvedValue('planner');
    await render();
    await changeInput('setu-email', ' planner@setu.local ');
    await changeInput('setu-password', 'password123');
    await submit();

    expect(auth.signIn).toHaveBeenCalledWith('planner@setu.local', 'password123');
    expect(auth.refreshRole).toHaveBeenCalledWith('user-1');
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/planner/command-center');
  });

  it('resolves an engineer role and redirects to supervisor capture', async () => {
    auth.refreshRole.mockResolvedValue('engineer');
    await render();
    await changeInput('setu-email', 'site@setu.local');
    await changeInput('setu-password', 'password123');
    await submit();

    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/supervisor/capture');
  });

  it('does not grant access when an authenticated account has no SETU role', async () => {
    auth.refreshRole.mockResolvedValue(null);
    await render();
    await changeInput('setu-email', 'unassigned@setu.local');
    await changeInput('setu-password', 'password123');
    await submit();

    expect(container.textContent).toContain('Authenticated account has no SETU role assignment.');
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/');
  });

  it('toggles the password visibility control accessibly', async () => {
    await render();
    const password = container.querySelector<HTMLInputElement>('#setu-password');
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-controls="setu-password"]');
    expect(password?.type).toBe('password');
    expect(toggle?.getAttribute('aria-label')).toBe('Show password');

    await act(async () => toggle?.click());
    expect(password?.type).toBe('text');
    expect(toggle?.getAttribute('aria-label')).toBe('Hide password');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
  });

  it('offers a public evaluator walkthrough without requesting credentials', async () => {
    await render();
    const link = container.querySelector<HTMLAnchorElement>('a[href="/demo.html"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('Explore a 2-minute illustrative walkthrough');
    expect(container.textContent).toContain('No account needed');
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('selects a workspace role without injecting a demo password', async () => {
    await render();
    const planner = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Planner'));
    const password = container.querySelector<HTMLInputElement>('#setu-password');

    await act(async () => planner?.click());

    expect(planner?.getAttribute('aria-pressed')).toBe('true');
    expect(password?.value).toBe('');
    expect(container.textContent).toContain('Role selection does not grant access.');
    expect(container.textContent).not.toContain('password123');
  });
});
