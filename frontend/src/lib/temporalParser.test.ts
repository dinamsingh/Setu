import { describe, expect, it } from 'vitest';
import {
  getKolkataReferenceDate,
  offsetKolkataDate,
  parseTemporalExpressions,
} from './temporalParser';

// Use a fixed reference clock: 2026-10-13 10:00:00 IST
const FIXED_CLOCK = new Date('2026-10-13T04:30:00.000Z'); // 10:00 AM IST

describe('temporalParser - Reference Date & Timezone', () => {
  it('correctly calculates Asia/Kolkata reference date parts independently of local runner timezone', () => {
    const kolkata = getKolkataReferenceDate(FIXED_CLOCK);
    expect(kolkata.year).toBe(2026);
    expect(kolkata.month).toBe(10);
    expect(kolkata.day).toBe(13);
    expect(kolkata.yyyyMmDd).toBe('2026-10-13');
  });

  it('correctly handles month end rollover and leap years', () => {
    // Leap year 2024: Feb 28 -> Feb 29
    const leapBase = { year: 2024, month: 2, day: 28 };
    const leapNext = offsetKolkataDate(leapBase, 1);
    expect(leapNext.yyyyMmDd).toBe('2024-02-29');

    // Non-leap year 2025: Feb 28 -> Mar 01
    const nonLeapBase = { year: 2025, month: 2, day: 28 };
    const nonLeapNext = offsetKolkataDate(nonLeapBase, 1);
    expect(nonLeapNext.yyyyMmDd).toBe('2025-03-01');

    // Year-end rollover: Dec 31 -> Jan 01
    const yearEndBase = { year: 2026, month: 12, day: 31 };
    const nextYear = offsetKolkataDate(yearEndBase, 1);
    expect(nextYear.yyyyMmDd).toBe('2027-01-01');

    // Year-start rollback: Jan 01 -> Dec 31
    const yearStartBase = { year: 2026, month: 1, day: 1 };
    const prevYear = offsetKolkataDate(yearStartBase, -1);
    expect(prevYear.yyyyMmDd).toBe('2025-12-31');
  });

  it('correctly resolves leap day Feb 29 reference clock with yesterday Feb 28 and tomorrow Mar 01', () => {
    const leapDayClock = new Date('2024-02-29T06:00:00.000Z'); // 2024-02-29 in IST
    const resYest = parseTemporalExpressions('Spool inspection finished yesterday', {
      referenceDate: leapDayClock,
    });
    expect(resYest[0].resolvedDate).toBe('2024-02-28');

    const resTom = parseTemporalExpressions('Welding will resume tomorrow', {
      referenceDate: leapDayClock,
    });
    expect(resTom[0].resolvedDate).toBe('2024-03-01');
  });

  it('correctly handles midnight boundaries in Asia/Kolkata', () => {
    // 2026-10-13 00:01:00 IST (2026-10-12 18:31:00 UTC)
    const justAfterMidnight = new Date('2026-10-12T18:31:00.000Z');
    const kolkata = getKolkataReferenceDate(justAfterMidnight);
    expect(kolkata.yyyyMmDd).toBe('2026-10-13');

    // 2026-10-12 23:59:00 IST (2026-10-12 18:29:00 UTC)
    const justBeforeMidnight = new Date('2026-10-12T18:29:00.000Z');
    const kolkataPrev = getKolkataReferenceDate(justBeforeMidnight);
    expect(kolkataPrev.yyyyMmDd).toBe('2026-10-12');
  });
});

describe('temporalParser - English phrases', () => {
  it('parses "today" as current date', () => {
    const res = parseTemporalExpressions('Piping hydrotest completed today at Manifold A', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].rawExpression).toBe('today');
    expect(res[0].resolvedDate).toBe('2026-10-13');
    expect(res[0].intent).toBe('completed_work');
    expect(res[0].isAmbiguous).toBe(false);
  });

  it('parses "yesterday" as T-1', () => {
    const res = parseTemporalExpressions('Spool fit-up was finished yesterday', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].rawExpression).toBe('yesterday');
    expect(res[0].resolvedDate).toBe('2026-10-12');
    expect(res[0].intent).toBe('completed_work');
    expect(res[0].isAmbiguous).toBe(false);
  });

  it('parses "tomorrow" as future planned work with T+1', () => {
    const res = parseTemporalExpressions('Flange bolt torqueing is scheduled for tomorrow', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].rawExpression).toBe('tomorrow');
    expect(res[0].resolvedDate).toBe('2026-10-14');
    expect(res[0].intent).toBe('future_plan');
    expect(res[0].intentBadge).toContain('Planned future work');
  });

  it('parses relative "two days ago" as T-2', () => {
    const res = parseTemporalExpressions('Excavation halted two days ago due to rain', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].rawExpression).toBe('two days ago');
    expect(res[0].resolvedDate).toBe('2026-10-11');
    expect(res[0].isAmbiguous).toBe(false);
  });

  it('parses "last night" as T-1 with night time advisory', () => {
    const res = parseTemporalExpressions('Line leak test was successful last night', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].rawExpression).toBe('last night');
    expect(res[0].resolvedDate).toBe('2026-10-12');
    expect(res[0].time?.display).toContain('Night');
  });

  it('parses explicit 12-hour clock times like "9:30 AM"', () => {
    const res = parseTemporalExpressions('9:30 AM pump alignment checked', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].time?.display).toBe('09:30 AM');
    expect(res[0].time?.hours24).toBe(9);
    expect(res[0].time?.minutes).toBe(30);
    expect(res[0].time?.isAmbiguousMeridiem).toBe(false);
  });

  it('parses 24-hour military times like "14:30"', () => {
    const res = parseTemporalExpressions('14:30 spool placement finished', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].time?.hours24).toBe(14);
    expect(res[0].time?.minutes).toBe(30);
    expect(res[0].time?.display).toContain('14:30');
  });
});

describe('temporalParser - Hindi and Devanagari phrases', () => {
  it('parses "आज" as today', () => {
    const res = parseTemporalExpressions('आज पाइपिंग निरीक्षण पूरा हुआ', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].resolvedDate).toBe('2026-10-13');
    expect(res[0].intent).toBe('completed_work');
  });

  it('parses "२ दिन पहले" as 2 days ago', () => {
    const res = parseTemporalExpressions('२ दिन पहले लाइन क्लीयरेंस मिला था', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].resolvedDate).toBe('2026-10-11');
  });

  it('parses "कल" with ambiguous candidates', () => {
    const res = parseTemporalExpressions('कल काम होगा', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].isAmbiguous).toBe(true);
    expect(res[0].resolvedDate).toBeUndefined(); // Never silently guessed
    expect(res[0].candidates).toHaveLength(2);
    expect(res[0].candidates.map(c => c.date)).toEqual(['2026-10-12', '2026-10-14']);
  });

  it('parses Hindi numerals in time expressions: "सुबह ९:३० बजे"', () => {
    const res = parseTemporalExpressions('सुबह ९:३० बजे लाइन प्रेशर चेक किया', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].time?.display).toContain('09:30 AM (Morning)');
  });
});

describe('temporalParser - Hinglish & Ambiguity Handling', () => {
  it('parses "aaj subah 9 baje" with date and advisory time', () => {
    const res = parseTemporalExpressions('Aaj subah 9 baje hydrotest shuru hua', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].resolvedDate).toBe('2026-10-13');
    expect(res[0].time?.display).toContain('09:00 AM (Morning)');
    expect(res[0].time?.hours24).toBe(9);
    expect(res[0].intent).toBe('completed_work');
  });

  it('never silently guesses "kal": identifies future intent in "Kal welding shuru hogi"', () => {
    const res = parseTemporalExpressions('Kal welding shuru hogi', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    const sugg = res[0];
    expect(sugg.rawExpression).toBe('kal');
    expect(sugg.isAmbiguous).toBe(true);
    expect(sugg.resolvedDate).toBeUndefined(); // Crucial: must NOT pick a date silently
    expect(sugg.intent).toBe('future_plan');
    expect(sugg.intentBadge).toContain('Planned future work');
    expect(sugg.candidates).toHaveLength(2);

    const yesterdayCandidate = sugg.candidates.find(c => c.relation === 'past');
    const tomorrowCandidate = sugg.candidates.find(c => c.relation === 'future');
    expect(yesterdayCandidate?.date).toBe('2026-10-12');
    expect(tomorrowCandidate?.date).toBe('2026-10-14');
    expect(tomorrowCandidate?.isSuggestedDefault).toBe(true);
  });

  it('never silently guesses "kal": identifies past intent in "Kal welding complete hui thi"', () => {
    const res = parseTemporalExpressions('Kal welding complete hui thi', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    const sugg = res[0];
    expect(sugg.isAmbiguous).toBe(true);
    expect(sugg.resolvedDate).toBeUndefined();
    expect(sugg.intent).toBe('completed_work');
    expect(sugg.candidates.find(c => c.relation === 'past')?.isSuggestedDefault).toBe(true);
  });

  it('handles ambiguous "parso" with options for 2 days ago and in 2 days', () => {
    const res = parseTemporalExpressions('Parso NDT testing complete hui thi', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    const sugg = res[0];
    expect(sugg.rawExpression).toBe('parso');
    expect(sugg.isAmbiguous).toBe(true);
    expect(sugg.resolvedDate).toBeUndefined();
    expect(sugg.candidates).toEqual([
      expect.objectContaining({ date: '2026-10-11', relation: 'past' }),
      expect.objectContaining({ date: '2026-10-15', relation: 'future' }),
    ]);
  });

  it('keeps completed work and future plan separate in compound sentence: "Aaj inspection complete hua, kal welding hogi"', () => {
    const text = 'Aaj inspection complete hua, kal welding hogi';
    const res = parseTemporalExpressions(text, { referenceDate: FIXED_CLOCK });
    expect(res).toHaveLength(2);

    const aajSugg = res[0];
    expect(aajSugg.rawExpression).toBe('aaj');
    expect(aajSugg.intent).toBe('completed_work');
    expect(aajSugg.resolvedDate).toBe('2026-10-13');
    expect(aajSugg.isAmbiguous).toBe(false);

    const kalSugg = res[1];
    expect(kalSugg.rawExpression).toBe('kal');
    expect(kalSugg.intent).toBe('future_plan');
    expect(kalSugg.isAmbiguous).toBe(true);
    expect(kalSugg.resolvedDate).toBeUndefined();
    expect(kalSugg.candidates.map(c => c.date)).toEqual(['2026-10-12', '2026-10-14']);
  });

  it('supports multiple sequential clauses with distinct temporal references', () => {
    const text = 'Subah 9 baje clearance mila, kal welding shuru hogi aur parso NDT testing hogi';
    const res = parseTemporalExpressions(text, { referenceDate: FIXED_CLOCK });
    expect(res).toHaveLength(3);
    expect(res[0].time?.display).toContain('09:00 AM');
    expect(res[1].rawExpression).toBe('kal');
    expect(res[1].intent).toBe('future_plan');
    expect(res[2].rawExpression).toBe('parso');
    expect(res[2].intent).toBe('future_plan');
  });

  it('flags ambiguous meridiem in bare "9 baje"', () => {
    const res = parseTemporalExpressions('9 baje compressor band hua', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].time?.isAmbiguousMeridiem).toBe(true);
    expect(res[0].time?.display).toContain('AM/PM unconfirmed');
    expect(res[0].confidence).toBe('needs_confirmation');
  });

  it('resolves explicit "shaam 5 baje" to PM', () => {
    const res = parseTemporalExpressions('shaam 5 baje concrete pouring finish hua', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].time?.display).toContain('05:00 PM (Evening)');
    expect(res[0].time?.hours24).toBe(17);
    expect(res[0].time?.isAmbiguousMeridiem).toBe(false);
  });

  it('marks negation or uncertainty as "Needs confirmation"', () => {
    const res = parseTemporalExpressions('Kal hydrotest shayad nahi hua', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].intent).toBe('uncertain');
    expect(res[0].intentBadge).toBe('Needs confirmation');
    expect(res[0].confidence).toBe('needs_confirmation');
  });

  it('returns empty array when narrative has no temporal references', () => {
    const res = parseTemporalExpressions('Piping spool erection and flange alignment finished at Manifold Area A', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toEqual([]);
  });

  it('parses "this morning" as today with morning time advisory', () => {
    const res = parseTemporalExpressions('Hydrostatic pressure test passed this morning', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].resolvedDate).toBe('2026-10-13');
    expect(res[0].candidates[0].date).toBe('2026-10-13');
    expect(res[0].time?.display).toBe('Morning (Advisory)');
  });

  it('parses Hinglish "subah" as today with morning advisory', () => {
    const res = parseTemporalExpressions('Subah civil foundation excavation complete ho gaya', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].resolvedDate).toBe('2026-10-13');
    expect(res[0].time?.display).toBe('Morning (Advisory)');
  });

  it('parses Hinglish "shaam" as today with evening advisory', () => {
    const res = parseTemporalExpressions('Shaam ko tie-in welding check kiya', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].resolvedDate).toBe('2026-10-13');
    expect(res[0].time?.display).toBe('Evening (Advisory)');
  });

  it('parses "tonight" as today with night advisory', () => {
    const res = parseTemporalExpressions('Night shift radiography scheduled tonight', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].resolvedDate).toBe('2026-10-13');
    expect(res[0].time?.display).toBe('Night (Advisory)');
  });

  it('parses Hinglish "2 din pehle" as 2 days ago', () => {
    const res = parseTemporalExpressions('2 din pehle pump skid unbolting complete hua', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].resolvedDate).toBe('2026-10-11');
    expect(res[0].candidates[0].date).toBe('2026-10-11');
    expect(res[0].candidates[0].relation).toBe('past');
  });
});
