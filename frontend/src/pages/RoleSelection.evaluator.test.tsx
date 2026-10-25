// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleSelection } from './RoleSelection';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  refreshRole: vi.fn(),
  currentEvaluatorAccess: vi.fn(),
  enterEvaluatorRole: vi.fn(),
  redeemEvaluatorInvite: vi.fn(),
}));
vi.mock('../lib/AuthContext', () => ({
  useAuth: () => ({ signIn: mocks.signIn, refreshRole: mocks.refreshRole, sessionIssue: null }),
}));
vi.mock('../lib/evaluatorAccess', () => ({
  currentEvaluatorAccess: mocks.currentEvaluatorAccess,
  enterEvaluatorRole: mocks.enterEvaluatorRole,
  redeemEvaluatorInvite: mocks.redeemEvaluatorInvite,
}));

let root: Root;
let node: HTMLDivElement;
const accounts = {
  mode: 'real_authenticated' as const,
  expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
  site: { email: 'demo-supervisor@evaluator.invalid', password: 's'.repeat(64) },
  planner: { email: 'demo-planner@evaluator.invalid', password: 'p'.repeat(64) },
};
function PathProbe() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}</output>;
}
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.currentEvaluatorAccess.mockReturnValue(null);
  mocks.redeemEvaluatorInvite.mockResolvedValue(accounts);
  mocks.enterEvaluatorRole.mockResolvedValue(undefined);
  mocks.refreshRole.mockResolvedValue('site');
  node = document.createElement('div');
  document.body.appendChild(node);
  root = createRoot(node);
  window.history.replaceState(null, '', '/');
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  window.history.replaceState(null, '', '/');
});
async function render() {
  await act(async () => root.render(
    <StrictMode><MemoryRouter initialEntries={['/']}><RoleSelection /><PathProbe /></MemoryRouter></StrictMode>,
  ));
}
async function click(name: string) {
  const b = [...node.querySelectorAll('button')].find(button => button.textContent?.trim() === name);
  expect(b, name).toBeTruthy();
  await act(async () => b!.click());
}

describe('SIH evaluator login on the original login screen', () => {
  it('always shows the CTA, but does not issue public accounts without a private invitation', async () => {
    await render();
    expect(node.textContent).toContain('Welcome back.');
    expect(node.querySelector('#setu-email')).toBeTruthy();
    await click('SIH Evaluator Login');
    expect(node.textContent).toContain('A private SIH evaluator invitation link is required');
    expect(mocks.redeemEvaluatorInvite).not.toHaveBeenCalled();
  });

  it('consumes the private link on login and displays two real 48-hour credential pairs', async () => {
    const invite = 'e'.repeat(64);
    window.history.replaceState(null, '', '/#invite=' + invite);
    await render();
    expect(window.location.hash).toBe('');
    await click('SIH Evaluator Login');
    expect(mocks.redeemEvaluatorInvite).toHaveBeenCalledExactlyOnceWith(invite);
    expect(node.textContent).toContain('48 hours');
    expect(node.querySelector<HTMLInputElement>('input[aria-label="Supervisor demo email"]')?.value).toBe(accounts.site.email);
    expect(node.querySelector<HTMLInputElement>('input[aria-label="Supervisor demo password"]')?.value).toBe(accounts.site.password);
    expect(node.querySelector<HTMLInputElement>('input[aria-label="Planner demo email"]')?.value).toBe(accounts.planner.email);
    expect(node.querySelector<HTMLInputElement>('input[aria-label="Planner demo password"]')?.value).toBe(accounts.planner.password);
    expect(node.textContent).not.toContain(invite);
  });

  it('signs in to the actual site workspace with the issued Supervisor account', async () => {
    window.history.replaceState(null, '', '/#invite=' + 'f'.repeat(64));
    await render();
    await click('SIH Evaluator Login');
    await click('Login as Supervisor');
    expect(mocks.enterEvaluatorRole).toHaveBeenCalledWith('site');
    expect(mocks.refreshRole).toHaveBeenCalled();
    expect(node.querySelector('[data-testid="path"]')?.textContent).toBe('/supervisor/capture');
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});
