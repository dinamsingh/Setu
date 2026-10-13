export type TemporalIntent = 'completed_work' | 'in_progress' | 'future_plan' | 'uncertain';

export interface DateCandidate {
  date: string; // 'YYYY-MM-DD'
  label: string; // e.g. 'Today (2026-10-13)', 'Yesterday (2026-10-12)', 'Tomorrow (2026-10-14)'
  relation: 'past' | 'today' | 'future';
  isSuggestedDefault?: boolean;
}

export interface TimeAdvisory {
  raw: string; // e.g. '9:30 AM', 'shaam 5 baje', '14:30'
  display: string; // e.g. '09:30 AM (Morning)', '05:00 PM (Evening)'
  hours24?: number;
  minutes?: number;
  isAmbiguousMeridiem?: boolean;
}

export interface TemporalSuggestion {
  id: string;
  matchedText: string;
  rawExpression: string;
  intent: TemporalIntent;
  intentBadge: string;
  isAmbiguous: boolean;
  resolvedDate?: string;
  candidates: DateCandidate[];
  time?: TimeAdvisory;
  confidence: 'confident' | 'needs_confirmation';
  explanation: string;
}

export interface ParseTemporalOptions {
  referenceDate?: Date | string | number;
  timezone?: string;
}

export function formatYyyyMmDd(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getKolkataReferenceDate(ref: Date | string | number = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  yyyyMmDd: string;
} {
  const d = ref instanceof Date ? ref : new Date(ref);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  let year = 2026, month = 10, day = 13, hour = 0, minute = 0;
  for (const part of parts) {
    if (part.type === 'year') year = parseInt(part.value, 10);
    if (part.type === 'month') month = parseInt(part.value, 10);
    if (part.type === 'day') day = parseInt(part.value, 10);
    if (part.type === 'hour') hour = parseInt(part.value, 10);
    if (part.type === 'minute') minute = parseInt(part.value, 10);
  }
  return {
    year,
    month,
    day,
    hour: hour === 24 ? 0 : hour,
    minute,
    yyyyMmDd: formatYyyyMmDd(year, month, day),
  };
}

export function offsetKolkataDate(
  base: { year: number; month: number; day: number },
  offsetDays: number
): { year: number; month: number; day: number; yyyyMmDd: string } {
  const utcDate = new Date(Date.UTC(base.year, base.month - 1, base.day + offsetDays));
  const year = utcDate.getUTCFullYear();
  const month = utcDate.getUTCMonth() + 1;
  const day = utcDate.getUTCDate();
  return {
    year,
    month,
    day,
    yyyyMmDd: formatYyyyMmDd(year, month, day),
  };
}

const DEVANAGARI_DIGITS: Record<string, string> = {
  '\u0966': '0', '\u0967': '1', '\u0968': '2', '\u0969': '3', '\u096A': '4',
  '\u096B': '5', '\u096C': '6', '\u096D': '7', '\u096E': '8', '\u096F': '9',
};

function normalizeDevanagariDigits(text: string): string {
  return text.replace(/[\u0966-\u096F]/g, d => DEVANAGARI_DIGITS[d] || d);
}

function parseNumberWord(word: string): number | null {
  const w = word.toLowerCase().trim();
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  const map: Record<string, number> = {
    one: 1, ek: 1, '\u090F\u0915': 1,
    two: 2, do: 2, '\u0926\u094B': 2,
    three: 3, teen: 3, '\u0924\u0940\u0928': 3,
    four: 4, chaar: 4, '\u091a\u093e\u0930': 4,
    five: 5, paanch: 5, '\u092a\u093e\u0902\u091a': 5,
  };
  return map[w] ?? null;
}

export function extractTimeFromClause(clause: string): TimeAdvisory | null {
  // 1. Hindi/Hinglish 'baje' or period-modified time
  // e.g. 'subah 9 baje', 'subah 9:30 baje', 'shaam 5 baje', '9 baje'
  // Reject: 29 baje, 0 baje, 13 baje, 9:60 baje
  const mbaje = clause.match(
    /(?:^|[^\w\u0900-\u097F])(?:(subah|\u0938\u0941\u092c\u0939|shaam|sham|\u0936\u093e\u092e|dopehar|dopahar|\u0926\u094b\u092a\u0939\u0930|raat|\u0930\u093e\u0924)\s+)?(\d{1,2})(?::(\d{1,2}))?\s*(?:baje|bje|bajay|\u092c\u091c\u0947)(?=[^\w\u0900-\u097F]|$)/i
  );
  if (mbaje) {
    let h = parseInt(mbaje[2], 10);
    const m = mbaje[3] ? parseInt(mbaje[3], 10) : 0;
    if (h < 1 || h > 12 || m < 0 || m > 59) {
      return null;
    }
    const rawPeriod = mbaje[1] ? mbaje[1].toLowerCase() : null;
    let isAmbiguousMeridiem = false;
    let desc = '';

    if (rawPeriod === 'subah' || rawPeriod === '\u0938\u0941\u092c\u0939') {
      if (h === 12) h = 0;
      desc = ' (Morning)';
    } else if (rawPeriod === 'shaam' || rawPeriod === 'sham' || rawPeriod === '\u0936\u093e\u092e') {
      if (h < 12) h += 12;
      desc = ' (Evening)';
    } else if (rawPeriod === 'dopehar' || rawPeriod === 'dopahar' || rawPeriod === '\u0926\u094b\u092a\u0939\u0930') {
      if (h < 12 && h !== 12) h += 12;
      desc = ' (Afternoon)';
    } else if (rawPeriod === 'raat' || rawPeriod === '\u0930\u093e\u0924') {
      if (h < 12 && h >= 6) h += 12;
      desc = ' (Night)';
    } else {
      isAmbiguousMeridiem = true;
      desc = ' (AM/PM unconfirmed)';
    }

    const h12 = h % 12 || 12;
    const ampm = !isAmbiguousMeridiem ? (h >= 12 ? 'PM' : 'AM') : '';
    return {
      raw: mbaje[0].trim().toLowerCase(),
      display: `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')}${ampm ? ' ' + ampm : ''}${desc}`,
      hours24: isAmbiguousMeridiem ? undefined : h,
      minutes: m,
      isAmbiguousMeridiem,
    };
  }

  // 2. 12-hour format with explicit AM/PM: e.g. '9:30 AM', '9 AM', '5:00 pm'
  // Reject: 13 PM, 0 AM, 9:60 AM
  const m12 = clause.match(/(?:^|[^\w\u0900-\u097F])(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)(?=[^\w\u0900-\u097F]|$)/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const m = m12[2] ? parseInt(m12[2], 10) : 0;
    if (h < 1 || h > 12 || m < 0 || m > 59) {
      return null;
    }
    const isPm = m12[3].toLowerCase() === 'pm';
    let h24 = h;
    if (isPm && h < 12) h24 += 12;
    if (!isPm && h === 12) h24 = 0;
    return {
      raw: m12[0].trim().toLowerCase(),
      display: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${isPm ? 'PM' : 'AM'}`,
      hours24: h24,
      minutes: m,
      isAmbiguousMeridiem: false,
    };
  }

  // 3. 24-hour military/ISO format: e.g. '14:30', '09:15'
  // Reject: 25:30, 24:00, 9:60
  const m24 = clause.match(/(?:^|[^\w\u0900-\u097F])(\d{1,2}):(\d{2})(?=[^\w\u0900-\u097F]|$)/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const m = parseInt(m24[2], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      return null;
    }
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return {
      raw: m24[0].trim(),
      display: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm})`,
      hours24: h,
      minutes: m,
      isAmbiguousMeridiem: false,
    };
  }

  return null;
}

export function determineClauseIntent(clause: string): {
  intent: TemporalIntent;
  badge: string;
  isFuture: boolean;
  isPast: boolean;
  isUncertain: boolean;
} {
  // 1. Negation detection: Word-aware for English/Hinglish and Devanagari
  const enHinglishNegation = /\b(nahi|nahin|nhi|na|not|uncompleted|incomplete|cancelled|cancel|failed|doubtful|pakka\s+nahi|unlikely|ruk\s+gaya|rok\s+diya)\b/i;
  const devanagariNegation = /(?:^|[^\u0900-\u097F\w])(\u0928\u0939\u0940\u0902|\u0928\u093e|\u0930\u0926\u094d\u0926|\u0905\u092a\u0942\u0930\u094d\u0923|\u0905\u0938\u092b\u0932|\u0930\u0941\u0915\u093e|\u0930\u094b\u0915\u093e)(?=[^\u0900-\u097F\w]|$)/;
  const hasNegation = enHinglishNegation.test(clause) || devanagariNegation.test(clause);

  // 2. Uncertainty detection: Word-aware for English/Hinglish and Devanagari
  const enHinglishUncertainty = /\b(may|might|could|possible|possibly|maybe|shayad|lagta\s+hai|probably|soch\s+rahe|tentative|unconfirmed)\b/i;
  const devanagariUncertainty = /(?:^|[^\u0900-\u097F\w])(\u0936\u093e\u092f\u0926|\u0938\u0902\u092d\u0935\u0924\u0903|\u0938\u0902\u092d\u0935|\u0932\u0917\u0924\u093e\s+\u0939\u0948)(?=[^\u0900-\u097F\w]|$)/;
  const hasUncertainty = enHinglishUncertainty.test(clause) || devanagariUncertainty.test(clause);

  // 3. Future plan detection: Word-aware for English/Hinglish and Devanagari
  const enHinglishFuture = /\b(will|shall|scheduled|plan|planned|target|upcoming|hoga|hogi|honge|karenge|karega|karegi|jayega|jayegi|shuru\s+hogi|shuru\s+hoga|hona\s+hai|karna\s+hai|tomorrow)\b/i;
  const devanagariFuture = /(?:^|[^\u0900-\u097F\w])(\u0939\u094b\u0917\u093e|\u0939\u094b\u0917\u0940|\u0939\u094b\u0902\u0917\u0947|\u0915\u0930\u0947\u0902\u0917\u0947|\u0915\u0930\u0947\u0917\u093e|\u0915\u0930\u0947\u0917\u0940|\u091c\u093e\u090f\u0917\u093e|\u091c\u093e\u090f\u0917\u0940|\u092f\u094b\u091c\u0928\u093e|\u0936\u0941\u0930\u0942\s+\u0939\u094b\u0917\u0940|\u0936\u0941\u0930\u0942\s+\u0939\u094b\u0917\u093e|\u0939\u094b\u0928\u093e\s+\u0939\u0948|\u0915\u0930\u0928\u093e\s+\u0939\u0948)(?=[^\u0900-\u097F\w]|$)/;
  const hasFuture = enHinglishFuture.test(clause) || devanagariFuture.test(clause);

  // 4. Past / completed work detection: Word-aware for English/Hinglish and Devanagari
  const enHinglishPast = /\b(completed|finished|done|tested|checked|passed|inspected|erected|welded|halted|was|were|did|had|hua|hui|hue|tha|thi|the|gaya|gayi|gaye|kiya|kiye|finish\s+hua|complete\s+hua|ho\s+gaya|yesterday)\b/i;
  const devanagariPast = /(?:^|[^\u0900-\u097F\w])(\u092a\u0942\u0930\u093e\s+\u0939\u0941\u0906|\u092a\u0942\u0930\u093e|\u0939\u0941\u0906|\u0939\u0941\u0908|\u0939\u0941\u090f|\u0925\u093e|\u0925\u0940|\u0925\u0947|\u0917\u092f\u093e|\u0917\u092f\u0940|\u0917\u0908|\u0917\u090f|\u0915\u093f\u092f\u093e|\u0915\u093f\u090f|\u0938\u092e\u094d\u092a\u0928\u094d\u0928|\u0938\u092e\u093e\u092a\u094d\u0924)(?=[^\u0900-\u097F\w]|$)/;
  const hasPast = enHinglishPast.test(clause) || devanagariPast.test(clause);

  // 5. In-progress detection: Word-aware for English/Hinglish and Devanagari
  const enHinglishInProgress = /\b(ongoing|in\s+progress|underway|continuing|chal\s+raha|chal\s+rahi|chalu\s+hai|progressing)\b/i;
  const devanagariInProgress = /(?:^|[^\u0900-\u097F\w])(\u091a\u0932\s+\u0930\u0939\u093e|\u091a\u0932\s+\u0930\u0939\u0940|\u091c\u093e\u0930\u0940)(?=[^\u0900-\u097F\w]|$)/;
  const hasInProgress = enHinglishInProgress.test(clause) || devanagariInProgress.test(clause);

  if (hasNegation || hasUncertainty) {
    return {
      intent: 'uncertain',
      badge: 'Needs confirmation',
      isFuture: hasFuture,
      isPast: hasPast,
      isUncertain: true,
    };
  }
  if (hasFuture && !hasPast) {
    return {
      intent: 'future_plan',
      badge: 'Planned future work (Advisory)',
      isFuture: true,
      isPast: false,
      isUncertain: false,
    };
  }
  if (hasPast && !hasFuture) {
    return {
      intent: 'completed_work',
      badge: 'Completed field work',
      isFuture: false,
      isPast: true,
      isUncertain: false,
    };
  }
  if (hasInProgress) {
    return {
      intent: 'in_progress',
      badge: 'In progress',
      isFuture: false,
      isPast: false,
      isUncertain: false,
    };
  }
  return {
    intent: 'uncertain',
    badge: 'Needs confirmation',
    isFuture: hasFuture,
    isPast: hasPast,
    isUncertain: true,
  };
}

export function parseTemporalExpressions(
  text: string,
  options: ParseTemporalOptions = {}
): TemporalSuggestion[] {
  if (!text || !text.trim()) return [];

  const normalized = normalizeDevanagariDigits(text);
  const baseKolkata = getKolkataReferenceDate(options.referenceDate);
  const suggestions: TemporalSuggestion[] = [];

  // Split into clauses across punctuation and major conjunctions
  const clauses = normalized
    .split(/(?:[.!?;,\n]|\b(?:aur|and|lekin|but|tatha)\b)+/)
    .map(c => c.trim())
    .filter(Boolean);

  let suggestionIndex = 0;

  for (const clause of clauses) {
    const timeInfo = extractTimeFromClause(clause);
    const intentAnalysis = determineClauseIntent(clause);
    const isUncertain = intentAnalysis.intent === 'uncertain' || intentAnalysis.isUncertain;

    // 1. Check relative days ago: e.g. 'two days ago', '2 days ago', '3 din pehle', '2 din pehle'
    const relMatch = clause.match(
      /(?:^|[^\w\u0900-\u097F])(\d+|one|two|three|four|five|ek|do|teen|chaar|paanch|\u090F\u0915|\u0926\u094B|\u0924\u0940\u0928|\u091a\u093e\u0930|\u092a\u093e\u0902\u091a)\s*(?:days?\s+ago|din\s+pehle|\u0926\u093F\u0928\s*\u092A\u0939\u0932\u0947)(?=[^\w\u0900-\u097F]|$)/i
    );
    if (relMatch) {
      const count = parseNumberWord(relMatch[1]);
      if (count && count > 0) {
        const offsetResult = offsetKolkataDate(baseKolkata, -count);
        const intent: TemporalIntent = isUncertain
          ? 'uncertain'
          : intentAnalysis.intent === 'future_plan'
          ? 'future_plan'
          : 'completed_work';
        const badge = intent === 'uncertain'
          ? 'Needs confirmation'
          : intent === 'future_plan'
          ? 'Planned future work (Advisory)'
          : 'Completed field work';

        suggestions.push({
          id: `temp-sugg-${++suggestionIndex}`,
          matchedText: clause,
          rawExpression: relMatch[0].trim().toLowerCase(),
          intent,
          intentBadge: badge,
          isAmbiguous: false,
          resolvedDate: offsetResult.yyyyMmDd,
          candidates: [
            {
              date: offsetResult.yyyyMmDd,
              label: `${count} days ago (${offsetResult.yyyyMmDd})`,
              relation: 'past',
              isSuggestedDefault: true,
            },
          ],
          time: timeInfo || undefined,
          confidence: isUncertain ? 'needs_confirmation' : 'confident',
          explanation: isUncertain
            ? `Past relative offset detected (${count} days ago), but narrative indicates uncertain or uncompleted work. Needs confirmation.`
            : `Resolved to ${count} days prior to reference date in Asia/Kolkata timezone.`,
        });
        continue;
      }
    }

    // 2. Check 'parso' / 'परसों' (Ambiguous between 2 days ago and in 2 days)
    const parsoMatch = clause.match(/(?:^|[^\w\u0900-\u097F])(parso|parson|\u092A\u0930\u0938\u094B\u0902)(?=[^\w\u0900-\u097F]|$)/i);
    if (parsoMatch) {
      const past2 = offsetKolkataDate(baseKolkata, -2);
      const future2 = offsetKolkataDate(baseKolkata, 2);
      const isFut = intentAnalysis.isFuture;
      const intent: TemporalIntent = isUncertain
        ? 'uncertain'
        : isFut
        ? 'future_plan'
        : intentAnalysis.isPast
        ? 'completed_work'
        : 'uncertain';

      const badge = intent === 'uncertain'
        ? 'Needs confirmation'
        : intent === 'future_plan'
        ? 'Planned future work (Advisory)'
        : 'Completed field work';

      suggestions.push({
        id: `temp-sugg-${++suggestionIndex}`,
        matchedText: clause,
        rawExpression: (parsoMatch[1] || parsoMatch[0]).trim().toLowerCase(),
        intent,
        intentBadge: badge,
        isAmbiguous: true,
        resolvedDate: undefined, // Never silently guess ambiguous parso
        candidates: [
          {
            date: past2.yyyyMmDd,
            label: `2 days ago (Past: ${past2.yyyyMmDd})`,
            relation: 'past',
            isSuggestedDefault: !isFut,
          },
          {
            date: future2.yyyyMmDd,
            label: `In 2 days (Planned: ${future2.yyyyMmDd})`,
            relation: 'future',
            isSuggestedDefault: isFut,
          },
        ],
        time: timeInfo || undefined,
        confidence: 'needs_confirmation',
        explanation: `'${parsoMatch[1]}' is inherently ambiguous in Hindi/Hinglish (can refer to 2 days ago or in 2 days). Select the intended date.`,
      });
      continue;
    }

    // 3. Check 'kal' / 'कल' (Ambiguous between yesterday and tomorrow)
    const kalMatch = clause.match(/(?:^|[^\w\u0900-\u097F])(kal|\u0915\u0932)(?=[^\w\u0900-\u097F]|$)/i);
    if (kalMatch) {
      const yesterday = offsetKolkataDate(baseKolkata, -1);
      const tomorrow = offsetKolkataDate(baseKolkata, 1);
      const isFut = intentAnalysis.isFuture;
      const intent: TemporalIntent = isUncertain
        ? 'uncertain'
        : isFut
        ? 'future_plan'
        : intentAnalysis.isPast
        ? 'completed_work'
        : 'uncertain';

      const badge = intent === 'uncertain'
        ? 'Needs confirmation'
        : intent === 'future_plan'
        ? 'Planned future work (Advisory)'
        : 'Completed field work';

      suggestions.push({
        id: `temp-sugg-${++suggestionIndex}`,
        matchedText: clause,
        rawExpression: (kalMatch[1] || kalMatch[0]).trim().toLowerCase(),
        intent,
        intentBadge: badge,
        isAmbiguous: true,
        resolvedDate: undefined, // Critical rule: Never silently guess kal
        candidates: [
          {
            date: yesterday.yyyyMmDd,
            label: `Yesterday (Past work: ${yesterday.yyyyMmDd})`,
            relation: 'past',
            isSuggestedDefault: !isFut,
          },
          {
            date: tomorrow.yyyyMmDd,
            label: `Tomorrow (Planned activity: ${tomorrow.yyyyMmDd})`,
            relation: 'future',
            isSuggestedDefault: false, // Never default future activity date for report
          },
        ],
        time: timeInfo || undefined,
        confidence: 'needs_confirmation',
        explanation: isFut
          ? `Identified as planned future work ("${clause}"). Select whether report date refers to yesterday or planned future activity.`
          : isUncertain
          ? `'${kalMatch[1]}' detected, but work status indicates uncertainty or negation. Select whether report refers to yesterday or planned work.`
          : `'${kalMatch[1]}' can refer to yesterday or tomorrow in Hindi/Hinglish. Select the intended date.`,
      });
      continue;
    }

    // 4. Check explicit 'yesterday' (English)
    const yestMatch = clause.match(/\byesterday\b/i);
    if (yestMatch) {
      const yesterday = offsetKolkataDate(baseKolkata, -1);
      const intent: TemporalIntent = isUncertain
        ? 'uncertain'
        : intentAnalysis.intent === 'future_plan'
        ? 'future_plan'
        : 'completed_work';
      const badge = intent === 'uncertain'
        ? 'Needs confirmation'
        : intent === 'future_plan'
        ? 'Planned future work (Advisory)'
        : 'Completed field work';

      suggestions.push({
        id: `temp-sugg-${++suggestionIndex}`,
        matchedText: clause,
        rawExpression: yestMatch[0].toLowerCase(),
        intent,
        intentBadge: badge,
        isAmbiguous: false,
        resolvedDate: yesterday.yyyyMmDd,
        candidates: [
          {
            date: yesterday.yyyyMmDd,
            label: `Yesterday (${yesterday.yyyyMmDd})`,
            relation: 'past',
            isSuggestedDefault: true,
          },
        ],
        time: timeInfo || undefined,
        confidence: isUncertain ? 'needs_confirmation' : 'confident',
        explanation: isUncertain
          ? `Explicit yesterday reference in narrative, but work status indicates uncertainty or negation. Needs confirmation.`
          : `Explicit yesterday reference in narrative.`,
      });
      continue;
    }

    // 5. Check explicit 'tomorrow' (English)
    const tomMatch = clause.match(/\btomorrow\b/i);
    if (tomMatch) {
      const tomorrow = offsetKolkataDate(baseKolkata, 1);
      const intent: TemporalIntent = isUncertain ? 'uncertain' : 'future_plan';
      const badge = intent === 'uncertain' ? 'Needs confirmation' : 'Planned future work (Advisory)';

      suggestions.push({
        id: `temp-sugg-${++suggestionIndex}`,
        matchedText: clause,
        rawExpression: tomMatch[0].toLowerCase(),
        intent,
        intentBadge: badge,
        isAmbiguous: false,
        resolvedDate: tomorrow.yyyyMmDd,
        candidates: [
          {
            date: tomorrow.yyyyMmDd,
            label: `Tomorrow (Planned activity: ${tomorrow.yyyyMmDd})`,
            relation: 'future',
            isSuggestedDefault: false, // Never default future activity date for report
          },
        ],
        time: timeInfo || undefined,
        confidence: isUncertain ? 'needs_confirmation' : 'confident',
        explanation: `Reference to planned future activity. Advisory only (field reports generally record current or past progress).`,
      });
      continue;
    }

    // 6. Check 'last night'
    const lastNightMatch = clause.match(/\blast\s+night\b/i);
    if (lastNightMatch) {
      const yesterday = offsetKolkataDate(baseKolkata, -1);
      const intent: TemporalIntent = isUncertain ? 'uncertain' : 'completed_work';
      const badge = intent === 'uncertain' ? 'Needs confirmation' : 'Completed field work';

      suggestions.push({
        id: `temp-sugg-${++suggestionIndex}`,
        matchedText: clause,
        rawExpression: lastNightMatch[0].toLowerCase(),
        intent,
        intentBadge: badge,
        isAmbiguous: false,
        resolvedDate: yesterday.yyyyMmDd,
        candidates: [
          {
            date: yesterday.yyyyMmDd,
            label: `Last night (${yesterday.yyyyMmDd})`,
            relation: 'past',
            isSuggestedDefault: true,
          },
        ],
        time: timeInfo || {
          raw: 'last night',
          display: 'Night (Advisory)',
        },
        confidence: isUncertain ? 'needs_confirmation' : 'confident',
        explanation: isUncertain
          ? `Refers to previous night, but work status indicates uncertainty or negation. Needs confirmation.`
          : `Refers to previous night.`,
      });
      continue;
    }

    // 7. Check 'today' / 'aaj' / 'आज' / 'this morning' / 'subah' / 'सुबह' / 'shaam' / 'शाम' / 'evening' / 'tonight'
    const todayMatch = clause.match(
      /(?:^|[^\w\u0900-\u097F])(aaj|today|this\s+morning|this\s+evening|this\s+afternoon|tonight|subah|shaam|sham|morning|evening|afternoon|dopahar|dopehar|\u0906\u091c|\u0938\u0941\u092c\u0939|\u0936\u093e\u092e|\u0926\u094b\u092a\u0939\u0930|\u0930\u093e\u0924)(?=[^\w\u0900-\u097F]|$)/i
    );
    if (todayMatch) {
      const expr = (todayMatch[1] || todayMatch[0]).trim().toLowerCase();
      let advisoryTime = timeInfo;
      if (!advisoryTime) {
        if (expr.includes('morning') || expr.includes('subah') || expr === '\u0938\u0941\u092c\u0939') {
          advisoryTime = { raw: expr, display: 'Morning (Advisory)' };
        } else if (expr.includes('evening') || expr.includes('shaam') || expr.includes('sham') || expr === '\u0936\u093e\u092e') {
          advisoryTime = { raw: expr, display: 'Evening (Advisory)' };
        } else if (expr.includes('afternoon') || expr.includes('dopahar') || expr.includes('dopehar') || expr === '\u0926\u094b\u092a\u0939\u0930') {
          advisoryTime = { raw: expr, display: 'Afternoon (Advisory)' };
        } else if (expr === 'tonight' || expr === '\u0930\u093e\u0924') {
          advisoryTime = { raw: expr, display: 'Night (Advisory)' };
        }
      }

      const intent: TemporalIntent = isUncertain
        ? 'uncertain'
        : intentAnalysis.intent === 'future_plan'
        ? 'future_plan'
        : intentAnalysis.intent === 'in_progress'
        ? 'in_progress'
        : 'completed_work';
      const badge = intent === 'uncertain'
        ? 'Needs confirmation'
        : intent === 'future_plan'
        ? 'Planned future work (Advisory)'
        : intent === 'in_progress'
        ? 'In progress'
        : 'Completed field work';

      suggestions.push({
        id: `temp-sugg-${++suggestionIndex}`,
        matchedText: clause,
        rawExpression: expr,
        intent,
        intentBadge: badge,
        isAmbiguous: false,
        resolvedDate: baseKolkata.yyyyMmDd,
        candidates: [
          {
            date: baseKolkata.yyyyMmDd,
            label: `Today (${baseKolkata.yyyyMmDd})`,
            relation: 'today',
            isSuggestedDefault: true,
          },
        ],
        time: advisoryTime || undefined,
        confidence: isUncertain ? 'needs_confirmation' : 'confident',
        explanation: isUncertain
          ? `Current day reference in Asia/Kolkata timezone, but work status indicates uncertainty or negation. Needs confirmation.`
          : `Current day reference in Asia/Kolkata timezone.`,
      });
      continue;
    }

    // 8. If no date matched but an explicit clock time is mentioned: e.g. '9:30 AM pump alignment checked'
    // CRITICAL RULE: Stop inferring today from time-only expressions!
    if (timeInfo) {
      const intent: TemporalIntent = isUncertain ? 'uncertain' : intentAnalysis.intent;
      const badge = isUncertain ? 'Needs confirmation' : intentAnalysis.badge;

      suggestions.push({
        id: `temp-sugg-${++suggestionIndex}`,
        matchedText: clause,
        rawExpression: timeInfo.raw,
        intent,
        intentBadge: badge,
        isAmbiguous: false,
        resolvedDate: undefined, // Do NOT infer today!
        candidates: [], // No inferred date button!
        time: timeInfo,
        confidence: timeInfo.isAmbiguousMeridiem || isUncertain ? 'needs_confirmation' : 'confident',
        explanation: `Time mentioned: ${timeInfo.display}. No explicit date in narrative; advisory only.`,
      });
    }
  }

  return suggestions;
}
