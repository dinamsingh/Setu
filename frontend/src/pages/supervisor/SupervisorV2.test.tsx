// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FieldCapture } from './FieldCapture';

const state = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock('../../hooks/useFieldUpdates', () => ({
  useFieldUpdates: () => ({ updates: [], loading: false, error: null, refetch: vi.fn(), submitSupervisorFieldUpdate: state.submit }),
}));
vi.mock('../../hooks/useWorkflow', () => ({
  useWorkflow: () => ({ rounds: [], loading: false, error: null, act: vi.fn() }),
}));
vi.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'supervisor-v2-test', email: 'supervisor-v2@example.test', user_metadata: {} },
    role: 'site',
    signOut: vi.fn(),
  }),
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><FieldCapture /></MemoryRouter>));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
});
async function clickByText(label: string) {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}
async function enterReport(value: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>('#field-report');
  expect(textarea).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, value);
    textarea?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Supervisor V2 home dashboard', () => {
  it('renders the V2 overview using live hook data instead of screenshot placeholders', () => {
    expect(container.querySelector('#site-log-home-title')?.textContent).toBe('Site Log');
    expect(container.querySelector('.setu-supervisor-v2__home-metrics')?.textContent).toContain('My updates');
    expect(container.querySelector('.setu-supervisor-v2__home-metrics')?.textContent).toContain('Pending review');
    expect(container.querySelector('.setu-supervisor-v2__home-list')?.textContent).toContain("You haven't sent any updates yet.");
  });

  it('opens My updates and returns home without submitting anything', async () => {
    const viewAll = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('View all (0)'));
    expect(viewAll).toBeTruthy();
    await act(async () => viewAll!.click());
    expect(container.querySelector('h1')?.textContent).toBe('My updates');
    expect(state.submit).not.toHaveBeenCalled();
    await clickByText('Site Log');
    expect(container.querySelector('#site-log-home-title')?.textContent).toBe('Site Log');
  });
});

describe('Supervisor V2 review and draft flow', () => {
  it('shows the supplied Write and Review progress and preserves the legacy Supervisor home', async () => {
    expect(container.querySelector('h1')?.textContent).toBe('Site Log');
    await clickByText('New field update');
    expect(container.querySelector('.setu-supervisor-v2__page-title')?.textContent).toBe('New site update');
    expect(container.querySelector('textarea#field-report')).not.toBeNull();
    expect(container.querySelector('[aria-label="Start voice input"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Add attachment"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Report progress"]')?.textContent).toContain('Review');
  });

  it('reviews before invoking the existing submission hook and permits editing', async () => {
    await clickByText('New field update');
    await enterReport('Piping spool erection completed at Duliajan Manifold Area A today');
    await clickByText('Review update');
    expect(state.submit).not.toHaveBeenCalled();
    expect(container.querySelector('.setu-supervisor-v2__review')?.textContent).toContain('Piping spool erection completed');
    expect(container.querySelector('.setu-supervisor-v2__review')?.textContent).toContain('supervisor-v2@example.test');
    await clickByText('Edit update');
    expect(container.querySelector<HTMLTextAreaElement>('#field-report')?.value).toContain('Piping spool erection');
    expect(state.submit).not.toHaveBeenCalled();
  });

  it('keeps drafts in an authenticated user-specific localStorage entry', async () => {
    await clickByText('New field update');
    await enterReport('Work completed at Manifold Area after inspection');
    await clickByText('Save draft');
    expect(localStorage.getItem('setu-supervisor-v2-draft:supervisor-v2-test')).toContain('Work completed at Manifold Area');
    expect(state.submit).not.toHaveBeenCalled();
  });
});
