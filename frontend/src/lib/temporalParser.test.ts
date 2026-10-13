import { describe, expect, it } from 'vitest';
import {
  extractTimeFromClause,
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
    // Just before midnight IST: 23:59:59 IST on 2026-10-12 (UTC is 18:29:59Z)
    const beforeMidnight = new Date('2026-10-12T18:29:59.000Z');
    expect(getKolkataReferenceDate(beforeMidnight).yyyyMmDd).toBe('2026-10-12');
    expect(getKolkataReferenceDate(beforeMidnight).hour).toBe(23);
    expect(getKolkataReferenceDate(beforeMidnight).minute).toBe(59);

    // Exactly midnight IST: 00:00:00 IST on 2026-10-13 (UTC is 18:30:00Z)
    const midnight = new Date('2026-10-12T18:30:00.000Z');
    expect(getKolkataReferenceDate(midnight).yyyyMmDd).toBe('2026-10-13');
    expect(getKolkataReferenceDate(midnight).hour).toBe(0);
    expect(getKolkataReferenceDate(midnight).minute).toBe(0);

    // Just after midnight IST: 00:00:01 IST on 2026-10-13 (UTC is 18:30:01Z)
    const afterMidnight = new Date('2026-10-12T18:30:01.000Z');
    expect(getKolkataReferenceDate(afterMidnight).yyyyMmDd).toBe('2026-10-13');
  });
});

describe('temporalParser - Clock range validation & time-only expressions', () => {
  it('rejects invalid clock expressions like "29 baje", "13 PM", "25:30", "9:60"', () => {
    expect(extractTimeFromClause('Pump testing at 29 baje')).toBeNull();
    expect(extractTimeFromClause('Shift started at 13 PM')).toBeNull();
    expect(extractTimeFromClause('Radiography at 25:30')).toBeNull();
    expect(extractTimeFromClause('Tie-in at 9:60')).toBeNull();
    expect(extractTimeFromClause('Hydrotest at 0 AM')).toBeNull();
    expect(extractTimeFromClause('Pressure test at 9:60 AM')).toBeNull();
    expect(extractTimeFromClause('Inspection at 9:60 baje')).toBeNull();
  });

  it('accepts legitimate 12-hour, 24-hour, and Hindi/Hinglish times', () => {
    const t12 = extractTimeFromClause('Pump inspection at 9:30 AM');
    expect(t12).not.toBeNull();
    expect(t12?.display).toBe('09:30 AM');
    expect(t12?.hours24).toBe(9);
    expect(t12?.minutes).toBe(30);

    const t24 = extractTimeFromClause('Line fit-up at 14:30');
    expect(t24).not.toBeNull();
    expect(t24?.display).toContain('14:30');
    expect(t24?.hours24).toBe(14);

    const tBaje = extractTimeFromClause('Shaam 5 baje work ended');
    expect(tBaje).not.toBeNull();
    expect(tBaje?.display).toContain('05:00 PM (Evening)');

    const tDev = extractTimeFromClause('सुबह ९:३० बजे पूरा हुआ'.replace(/[\u0966-\u096F]/g, d => ({ '९': '9', '३': '3', '०': '0' }[d] || d)));
    expect(tDev).not.toBeNull();
    expect(tDev?.display).toContain('09:30 AM (Morning)');
  });

  it('does NOT infer today for time-only expressions (stops inferring today without date anchor)', () => {
    const res = parseTemporalExpressions('9:30 AM pump alignment checked', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].rawExpression).toBe('9:30 am');
    expect(res[0].resolvedDate).toBeUndefined(); // Crucial: Date is NOT inferred!
    expect(res[0].candidates).toHaveLength(0); // Crucial: No inferred date button!
    expect(res[0].time?.display).toBe('09:30 AM');
    expect(res[0].explanation).toContain('No explicit date in narrative');
  });

  it('does NOT infer today for 24-hour time-only expressions', () => {
    const res = parseTemporalExpressions('14:30 hydrostatic inspection completed', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].resolvedDate).toBeUndefined();
    expect(res[0].candidates).toHaveLength(0);
    expect(res[0].time?.hours24).toBe(14);
  });
});

describe('temporalParser - Hindi & Hinglish Intent Classification', () => {
  it('correctly classifies "आज निरीक्षण पूरा हुआ" as completed work', () => {
    const res = parseTemporalExpressions('आज निरीक्षण पूरा हुआ', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].intent).toBe('completed_work');
    expect(res[0].intentBadge).toBe('Completed field work');
    expect(res[0].resolvedDate).toBe('2026-10-13');
  });

  it('correctly classifies "आज निरीक्षण पूरा नहीं हुआ" as needs confirmation (negated)', () => {
    const res = parseTemporalExpressions('आज निरीक्षण पूरा नहीं हुआ', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].intent).toBe('uncertain');
    expect(res[0].intentBadge).toBe('Needs confirmation');
    expect(res[0].confidence).toBe('needs_confirmation');
  });

  it('correctly classifies "कल काम होगा" as future plan with ambiguous date choices', () => {
    const res = parseTemporalExpressions('कल काम होगा', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].intent).toBe('future_plan');
    expect(res[0].intentBadge).toBe('Planned future work (Advisory)');
    expect(res[0].isAmbiguous).toBe(true);
    expect(res[0].candidates).toHaveLength(2);
    expect(res[0].candidates[0].date).toBe('2026-10-12'); // Yesterday
    expect(res[0].candidates[1].date).toBe('2026-10-14'); // Tomorrow
  });

  it('correctly classifies "कल काम नहीं हुआ" as needs confirmation (not completed)', () => {
    const res = parseTemporalExpressions('कल काम नहीं हुआ', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].intent).toBe('uncertain');
    expect(res[0].intentBadge).toBe('Needs confirmation');
    expect(res[0].isAmbiguous).toBe(true);
  });

  it('correctly classifies "शायद कल काम होगा" as uncertain', () => {
    const res = parseTemporalExpressions('शायद कल काम होगा', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].intent).toBe('uncertain');
    expect(res[0].intentBadge).toBe('Needs confirmation');
  });

  it('correctly classifies "Aaj inspection complete nahi hua" as needs confirmation', () => {
    const res = parseTemporalExpressions('Aaj inspection complete nahi hua', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].intent).toBe('uncertain');
    expect(res[0].intentBadge).toBe('Needs confirmation');
  });

  it('correctly classifies "Kal welding shuru hogi" as future planned work', () => {
    const res = parseTemporalExpressions('Kal welding shuru hogi', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].intent).toBe('future_plan');
    expect(res[0].intentBadge).toBe('Planned future work (Advisory)');
    expect(res[0].isAmbiguous).toBe(true);
    expect(res[0].resolvedDate).toBeUndefined(); // Never silently guessed
  });
});

describe('temporalParser - Word boundary enforcement for unrelated words', () => {
  it('does NOT match "kal" inside unrelated words like "nikal", "kalka", "sakal", "chakal"', () => {
    const res = parseTemporalExpressions('Nikal gaya site se kalka station sakal pipe chakal', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(0);
  });

  it('does NOT match Devanagari "कल" inside unrelated words like "निकल", "कल्याण", "आजकल"', () => {
    const res = parseTemporalExpressions('निकल गया कल्याण कार्य आजकल', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(0);
  });

  it('does NOT match "aaj" inside unrelated words like "raaj", "swaraj", "aaji", "आजाद", "राजा"', () => {
    const res = parseTemporalExpressions('Raaj path swaraj pipe aaji pump आजाद राजा', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(0);
  });
});

describe('temporalParser - Uncertainty respected across all parser branches', () => {
  it('respects negation in yesterday branch: "Yesterday inspection was not completed"', () => {
    const res = parseTemporalExpressions('Yesterday inspection was not completed', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].intent).toBe('uncertain');
    expect(res[0].intentBadge).toBe('Needs confirmation');
    expect(res[0].resolvedDate).toBe('2026-10-12');
  });

  it('respects negation in last night branch: "Last night pressure test failed"', () => {
    const res = parseTemporalExpressions('Last night pressure test failed', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].intent).toBe('uncertain');
    expect(res[0].intentBadge).toBe('Needs confirmation');
    expect(res[0].resolvedDate).toBe('2026-10-12');
  });

  it('respects negation in relative days branch: "2 days ago tie-in was cancelled"', () => {
    const res = parseTemporalExpressions('2 days ago tie-in was cancelled', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].intent).toBe('uncertain');
    expect(res[0].intentBadge).toBe('Needs confirmation');
    expect(res[0].resolvedDate).toBe('2026-10-11');
  });

  it('separates completed work and future plan in compound sentence: "Aaj inspection complete hua, kal welding hogi"', () => {
    const res = parseTemporalExpressions('Aaj inspection complete hua, kal welding hogi', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(2);

    expect(res[0].intent).toBe('completed_work');
    expect(res[0].intentBadge).toBe('Completed field work');
    expect(res[0].resolvedDate).toBe('2026-10-13');

    expect(res[1].intent).toBe('future_plan');
    expect(res[1].intentBadge).toBe('Planned future work (Advisory)');
    expect(res[1].isAmbiguous).toBe(true);
  });
});

describe('temporalParser - Additional common phrases & relative dates', () => {
  it('parses "this morning" as today with morning time advisory', () => {
    const res = parseTemporalExpressions('Hydrostatic pressure test passed this morning', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].resolvedDate).toBe('2026-10-13');
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

  it('handles ambiguous "parso" with options for 2 days ago and in 2 days', () => {
    const res = parseTemporalExpressions('Parso flange alignment complete hua', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toHaveLength(1);
    expect(res[0].isAmbiguous).toBe(true);
    expect(res[0].resolvedDate).toBeUndefined();
    expect(res[0].candidates).toHaveLength(2);
    expect(res[0].candidates[0].date).toBe('2026-10-11');
    expect(res[0].candidates[1].date).toBe('2026-10-15');
  });

  it('returns empty array when narrative has no temporal references', () => {
    const res = parseTemporalExpressions('Piping spool erection and flange alignment finished at Manifold Area A', {
      referenceDate: FIXED_CLOCK,
    });
    expect(res).toEqual([]);
  });
});
