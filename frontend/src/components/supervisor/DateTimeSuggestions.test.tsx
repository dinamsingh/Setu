// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateTimeSuggestions } from './DateTimeSuggestions';
import type { TemporalSuggestion } from '../../lib/temporalParser';

describe('DateTimeSuggestions component', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const mockSuggestions: TemporalSuggestion[] = [
    {
      id: 'sugg-1',
      matchedText: 'kal welding shuru hogi',
      rawExpression: 'kal',
      intent: 'future_plan',
      intentBadge: 'Planned future work (Advisory)',
      isAmbiguous: true,
      resolvedDate: undefined,
      candidates: [
        {
          date: '2026-10-12',
          label: 'Yesterday (Past work: 2026-10-12)',
          relation: 'past',
        },
        {
          date: '2026-10-14',
          label: 'Tomorrow (Planned work: 2026-10-14)',
          relation: 'future',
          isSuggestedDefault: true,
        },
      ],
      time: {
        raw: '9:30 AM',
        display: '09:30 AM (Morning)',
      },
      confidence: 'confident',
      explanation: 'Identified as planned/scheduled future work, not evidence of completed progress.',
    },
  ];

  it('renders null when there are no suggestions', async () => {
    await act(async () => {
      root.render(
        <DateTimeSuggestions
          suggestions={[]}
          currentReportedDate="2026-10-13"
          onApplyDate={vi.fn()}
          onDismissSuggestion={vi.fn()}
        />
      );
    });

    expect(container.firstChild).toBeNull();
  });

  it('renders suggestions panel with timezone and intent badges', async () => {
    await act(async () => {
      root.render(
        <DateTimeSuggestions
          suggestions={mockSuggestions}
          currentReportedDate="2026-10-13"
          onApplyDate={vi.fn()}
          onDismissSuggestion={vi.fn()}
          onDismissAll={vi.fn()}
        />
      );
    });

    const region = container.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-label')).toBe('Date and time suggestions from narrative');
    expect(container.textContent).toContain('Asia/Kolkata (IST)');
    expect(container.textContent).toContain('“kal”');
    expect(container.textContent).toContain('Planned future work (Advisory)');
    expect(container.textContent).toContain('09:30 AM (Morning)');
    expect(container.textContent).toContain('Advisory only');
  });

  it('renders explicit choices for ambiguous terms and calls onApplyDate when clicked', async () => {
    const onApplyDate = vi.fn();
    await act(async () => {
      root.render(
        <DateTimeSuggestions
          suggestions={mockSuggestions}
          currentReportedDate="2026-10-13"
          onApplyDate={onApplyDate}
          onDismissSuggestion={vi.fn()}
        />
      );
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    const tomBtn = buttons.find((b) => b.textContent?.includes('Tomorrow (Planned work: 2026-10-14)'));
    expect(tomBtn).toBeDefined();

    act(() => {
      tomBtn?.click();
    });

    expect(onApplyDate).toHaveBeenCalledTimes(1);
    expect(onApplyDate).toHaveBeenCalledWith(
      '2026-10-14',
      mockSuggestions[0],
      mockSuggestions[0].candidates[1]
    );
  });

  it('indicates when a candidate date matches currentReportedDate', async () => {
    await act(async () => {
      root.render(
        <DateTimeSuggestions
          suggestions={mockSuggestions}
          currentReportedDate="2026-10-14"
          onApplyDate={vi.fn()}
          onDismissSuggestion={vi.fn()}
        />
      );
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    const tomBtn = buttons.find((b) => b.textContent?.includes('Tomorrow (Planned work: 2026-10-14)'));
    expect(tomBtn?.textContent).toContain('(Selected)');
    expect(tomBtn?.className).toContain('bg-emerald-50');
  });

  it('calls onDismissSuggestion when individual dismiss button is clicked', async () => {
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(
        <DateTimeSuggestions
          suggestions={mockSuggestions}
          currentReportedDate="2026-10-13"
          onApplyDate={vi.fn()}
          onDismissSuggestion={onDismiss}
        />
      );
    });

    const dismissBtn = container.querySelector('button[aria-label=\'Dismiss suggestion for "kal"\']') as HTMLButtonElement | null;
    expect(dismissBtn).not.toBeNull();

    act(() => {
      dismissBtn?.click();
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('sugg-1');
  });

  it('calls onDismissAll when "Dismiss all" is clicked', async () => {
    const onDismissAll = vi.fn();
    await act(async () => {
      root.render(
        <DateTimeSuggestions
          suggestions={mockSuggestions}
          currentReportedDate="2026-10-13"
          onApplyDate={vi.fn()}
          onDismissSuggestion={vi.fn()}
          onDismissAll={onDismissAll}
        />
      );
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    const dismissAllBtn = buttons.find((b) => b.textContent?.includes('Dismiss all'));
    expect(dismissAllBtn).toBeDefined();

    act(() => {
      dismissAllBtn?.click();
    });

    expect(onDismissAll).toHaveBeenCalledTimes(1);
  });
});
