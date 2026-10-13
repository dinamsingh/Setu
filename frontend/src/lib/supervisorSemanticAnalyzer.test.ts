import { describe, expect, it } from 'vitest';
import { analyzeSupervisorNarrative } from './supervisorSemanticAnalyzer';

describe('supervisorSemanticAnalyzer', () => {
  const referenceDate = new Date('2026-10-13T10:00:00+05:30'); // Today: 2026-10-13
  const todayYmd = '2026-10-13';

  it('validates empty or excessively short narratives with friendly error', () => {
    const empty = analyzeSupervisorNarrative('', todayYmd);
    expect(empty.isValid).toBe(false);
    expect(empty.validationError).toBe('Field update narrative is required.');

    const short = analyzeSupervisorNarrative('ok', todayYmd);
    expect(short.isValid).toBe(false);
    expect(short.validationError).toContain('Narrative is too short');
  });

  it('analyzes clean completed update without requiring clarification', () => {
    const result = analyzeSupervisorNarrative(
      'Piping spool erection finished at Manifold A today',
      todayYmd,
      { referenceDate }
    );

    expect(result.isValid).toBe(true);
    expect(result.completedWork.length).toBeGreaterThan(0);
    expect(result.futurePlans).toHaveLength(0);
    expect(result.uncertainties).toHaveLength(0);
    expect(result.materialAmbiguity).toBeNull();
  });

  it('correctly separates completed work and future planned work without unnecessary interruption ("Aaj inspection complete hua, kal welding shuru hogi")', () => {
    const text = 'Aaj inspection complete hua, kal welding shuru hogi';
    const result = analyzeSupervisorNarrative(text, todayYmd, { referenceDate });

    expect(result.isValid).toBe(true);
    // Inspection is completed
    expect(result.completedWork.some((w) => w.toLowerCase().includes('inspection'))).toBe(true);
    // Welding is planned for future, NOT completed
    expect(result.futurePlans.some((f) => f.toLowerCase().includes('welding'))).toBe(true);
    expect(result.completedWork.some((w) => w.toLowerCase().includes('welding'))).toBe(false);
    // Clean narrative with distinct, unambiguous clauses does not interrupt supervisor
    expect(result.materialAmbiguity).toBeNull();
  });

  it('never marks negated work as completed ("Inspection complete nahi hua")', () => {
    const result = analyzeSupervisorNarrative(
      'Inspection complete nahi hua',
      todayYmd,
      { referenceDate }
    );

    expect(result.isValid).toBe(true);
    expect(result.completedWork).toHaveLength(0);
    expect(result.futurePlans).toHaveLength(0);
    expect(result.uncertainties.length).toBeGreaterThan(0);
    expect(result.uncertainties[0]).toContain('Inspection complete nahi hua');
    expect(result.materialAmbiguity).toBeNull();
  });

  it('detects material ambiguity when "kal" has no tense marker', () => {
    const result = analyzeSupervisorNarrative(
      'Kal welding at Manifold Area',
      todayYmd,
      { referenceDate }
    );

    expect(result.isValid).toBe(true);
    expect(result.materialAmbiguity).not.toBeNull();
    expect(result.materialAmbiguity?.question).toBe('Ye kaam kal hua tha ya aage plan hai?');
    expect(result.materialAmbiguity?.options).toHaveLength(2);
  });

  it('detects conflicting status for the same activity and provides targeted question', () => {
    const result = analyzeSupervisorNarrative(
      'Feeder line welding complete ho gayi lekin kal shuru hogi testing',
      todayYmd,
      { referenceDate }
    );

    expect(result.isValid).toBe(true);
    expect(result.materialAmbiguity).not.toBeNull();
    expect(result.materialAmbiguity?.question).toContain('complete hui hai ya kal shuru');
  });

  it('detects divergence when narrative explicitly reports past work completed yesterday but reported date is today', () => {
    const result = analyzeSupervisorNarrative(
      'Kal kaam complete hua tha',
      todayYmd,
      { referenceDate }
    );

    expect(result.isValid).toBe(true);
    expect(result.materialAmbiguity).not.toBeNull();
    expect(result.materialAmbiguity?.question).toBe('Ye kaam aaj hua tha ya kal?');
    expect(result.materialAmbiguity?.options[0].label).toContain('Aaj hua tha');
    expect(result.materialAmbiguity?.options[1].label).toContain('Kal hua tha');
  });

  it('preserves the original narrative verbatim in summary', () => {
    const raw = '  Site inspection completed at Duliajan  ';
    const result = analyzeSupervisorNarrative(raw, todayYmd, { referenceDate });
    expect(result.summary.originalNarrative).toBe('Site inspection completed at Duliajan');
  });
});
