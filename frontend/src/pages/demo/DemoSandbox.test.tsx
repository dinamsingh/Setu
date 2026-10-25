// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DemoSandbox } from './DemoSandbox';

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<MemoryRouter><DemoSandbox /></MemoryRouter>);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function button(label: string) {
  const el = [...host.querySelectorAll('button')].find(x => x.textContent?.trim() === label);
  expect(el, 'Button "' + label + '" missing').toBeTruthy();
  await act(async () => el!.click());
}

async function changeText(element: HTMLElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Credential-free synthetic evaluator sandbox', () => {
  it('does not request a username/password and clearly explains isolation', () => {
    expect(host.querySelector('input[type=password]')).toBeNull();
    expect(host.textContent).toContain('SIMULATED SANDBOX');
    expect(host.textContent).toContain('No Supabase login');
    expect(host.textContent).toContain('No email or password');
    expect(host.textContent).toContain('production');
  });

  it('switches between Supervisor and Planner and presents seeded validation decisions', async () => {
    expect(host.textContent).toContain('Submit a synthetic field update');
    await button('Planner');
    expect(host.textContent).toContain('Review Queue');
    expect(host.textContent).toContain('DEMO-001');
    expect(host.textContent).toContain('DEMO-002');
    const blockedReport = [...host.querySelectorAll('button')].find(x => x.textContent?.includes('DEMO-002'));
    expect(blockedReport).toBeTruthy();
    await act(async () => blockedReport!.click());
    expect(host.textContent).toContain('Date plausibility BLOCK');
  });

  it('blocks accepting invalid evidence until a justified override exists', async () => {
    await button('Planner');
    const pendingButtons = [...host.querySelectorAll('button')].filter(x => x.textContent?.includes('DEMO-002'));
    expect(pendingButtons.length).toBeGreaterThan(0);
    await act(async () => pendingButtons[0].click());
    await button('Approve');
    expect(host.textContent).toContain('Validation is blocked.');
    const reason = host.querySelector('textarea');
    expect(reason).toBeTruthy();
    await changeText(reason!, 'Evaluator-only override of date mismatch');
    await button('Record override');
    expect(host.textContent).toContain('Demo override recorded');
    await button('Approve');
    expect(host.textContent).toContain('Demo decision finalized: approved');
    await button('Audit & Export');
    expect(host.textContent).toContain('Download demo approved mapping CSV (1)');
  });

  it('supports a full synthetic Supervisor-to-Planner review cycle and reset', async () => {
    const narrative = host.querySelector('textarea');
    expect(narrative).toBeTruthy();
    await changeText(narrative!, 'SYNTHETIC DEMO ONLY: New spool field fit-up at Manifold A.');
    const form = host.querySelector('form');
    await act(async () => form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(host.textContent).toContain('DEMO-003 created inside this browser sandbox');
    await button('Planner');
    expect(host.textContent).toContain('DEMO-003');
    await button('Approve');
    expect(host.textContent).toContain('Demo decision finalized: approved');
    await button('Audit & Export');
    expect(host.textContent).toContain('Download demo approved mapping CSV (1)');
    expect(host.textContent).toContain('DEMO-003');
    await button('Restart demo');
    expect(host.textContent).toContain('Demo restarted');
    expect(host.textContent).not.toContain('DEMO-003');
  });
});
