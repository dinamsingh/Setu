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

  const mockAmbiguousSuggestion: TemporalSuggestion[] = [
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
          label: 'Tomorrow (Planned activity: 2026-10-14)',
          relation: 'future',
          isSuggestedDefault: false,
        },
      ],
      time: {
        raw: '9:30 AM',
        display: '09:30 AM (Morning)',
      },
      confidence: 'needs_confirmation',
      explanation: 'Identified as planned future work ("kal welding shuru hogi"). Select whether report date refers to yesterday or planned future activity.',
    },
  ];

  const mockTimeOnlySuggestion: TemporalSuggestion[] = [
    {
      id: 'sugg-time-1',
      matchedText: '14:30 pump alignment check',
      rawExpression: '14:30',
      intent: 'completed_work',
      intentBadge: 'Completed field work',
      isAmbiguous: false,
      resolvedDate: undefined,
      candidates: [],
      time: {
        raw: '14:30',
        display: '14:30 (02:30 PM)',
        hours24: 14,
        minutes: 30,
        isAmbiguousMeridiem: false,
      },
      confidence: 'confident',
      explanation: 'Time mentioned: 14:30 (02:30 PM). No explicit date in narrative; advisory only.',
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

  it('renders suggestions panel with timezone, intent badges and advisory notice for future work', async () => {
    await act(async () => {
      root.render(
        <DateTimeSuggestions
          suggestions={mockAmbiguousSuggestion}
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
    expect(container.textContent).toContain('Planned future activity:');
  });

  it('renders explicit choices for ambiguous terms and calls onApplyDate when clicked', async () => {
    const onApplyDate = vi.fn();
    await act(async () => {
      root.render(
        <DateTimeSuggestions
          suggestions={mockAmbiguousSuggestion}
          currentReportedDate="2026-10-13"
          onApplyDate={onApplyDate}
          onDismissSuggestion={vi.fn()}
        />
      );
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    const tomBtn = buttons.find((b) => b.textContent?.includes('Tomorrow (Planned activity: 2026-10-14)'));
    expect(tomBtn).toBeDefined();

    act(() => {
      tomBtn?.click();
    });

    expect(onApplyDate).toHaveBeenCalledTimes(1);
    expect(onApplyDate).toHaveBeenCalledWith(
      '2026-10-14',
      mockAmbiguousSuggestion[0],
      mockAmbiguousSuggestion[0].candidates[1]
    );
  });

  it('safely handles date-less time-only suggestions without offering an inferred Use Today button', async () => {
    const onApplyDate = vi.fn();
    await act(async () => {
      root.render(
        <DateTimeSuggestions
          suggestions={mockTimeOnlySuggestion}
          currentReportedDate="2026-10-13"
          onApplyDate={onApplyDate}
          onDismissSuggestion={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('14:30 (02:30 PM)');
    expect(container.textContent).toContain('No date specified in narrative. Current reported date is preserved.');

    // Crucial check: No date application buttons are rendered!
    const buttons = Array.from(container.querySelectorAll('button'));
    const useDateButtons = buttons.filter((b) => b.textContent?.includes('Use ') || b.textContent?.includes('Set future date:'));
    expect(useDateButtons).toHaveLength(0);
  });

  it('calls onDismissSuggestion when individual dismiss button is clicked', async () => {
    const onDismiss = vi.fn();
    await act(async () => {
      root.render(
        <DateTimeSuggestions
          suggestions={mockAmbiguousSuggestion}
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
          suggestions={mockAmbiguousSuggestion}
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
