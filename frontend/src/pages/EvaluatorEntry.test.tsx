// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EvaluatorEntry } from './EvaluatorEntry';

const api = vi.hoisted(() => ({
  currentEvaluatorAccess: vi.fn(),
  enterEvaluatorRole: vi.fn(),
  forgetEvaluatorAccess: vi.fn(),
  redeemEvaluatorInvite: vi.fn(),
}));
vi.mock('../lib/evaluatorAccess', () => api);

let root: Root;
let host: HTMLDivElement;
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}
async function render() {
  await act(async () => {
    root.render(<StrictMode><MemoryRouter initialEntries={['/evaluator']}>
      <EvaluatorEntry /><LocationProbe />
    </MemoryRouter></StrictMode>);
  });
}
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  api.currentEvaluatorAccess.mockReturnValue(null);
  api.enterEvaluatorRole.mockResolvedValue(undefined);
  api.redeemEvaluatorInvite.mockResolvedValue(undefined);
  window.history.replaceState(null, '', '/evaluator');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.history.replaceState(null, '', '/');
});
function primaryButton(): HTMLButtonElement {
  const b = Array.from(host.querySelectorAll('button')).find(x => x.textContent?.includes('Start 24-Hour Evaluation'));
  expect(b).toBeDefined();
  return b!;
}

describe('Real evaluator entry CTA', () => {
  it('explains missing private invitation when clicked rather than silently disabling CTA', async () => {
    await render();
    expect(primaryButton().disabled).toBe(false);
    await act(async () => primaryButton().click());
    expect(host.textContent).toContain('A private SIH invitation link is required.');
    expect(api.redeemEvaluatorInvite).not.toHaveBeenCalled();
    expect(api.enterEvaluatorRole).not.toHaveBeenCalled();
  });

  it('preserves one-use link fragment in StrictMode and can redeem on click', async () => {
    const secret = 'a'.repeat(64);
    window.history.replaceState(null, '', '/evaluator#invite=' + secret);
    await render();
    expect(window.location.hash).toBe('');
    expect(primaryButton().disabled).toBe(false);
    expect(host.textContent).not.toContain('This is the evaluator entry screen, not a public registration page.');
    await act(async () => primaryButton().click());
    expect(api.redeemEvaluatorInvite).toHaveBeenCalledWith(secret);
    expect(api.enterEvaluatorRole).toHaveBeenCalledWith('site');
    expect(host.querySelector('[data-testid="location"]')?.textContent).toBe('/supervisor/capture');
  });
});
