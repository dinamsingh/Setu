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

function extractTimeFromClause(clause: string): TimeAdvisory | null {
  // 1. Hindi/Hinglish 'baje' or period-modified time (e.g. 'subah 9 baje', 'subah 9:30 baje', 'shaam 5 baje')
  const mbaje = clause.match(/(?:(subah|\u0938\u0941\u092c\u0939|shaam|sham|\u0936\u093e\u092e|dopehar|dopahar|\u0926\u094B\u092a\u0939\u0930|raat|\u0930\u093e\u0924)\s+)?(\d{1,2})(?::([0-5]\d))?\s*(?:baje|bje|bajay|\u092c\u091c\u0947)(?=[^\w\u0900-\u097F]|$)/i);
  if (mbaje) {
    const rawPeriod = mbaje[1] ? mbaje[1].toLowerCase() : null;
    let h = parseInt(mbaje[2], 10);
    const m = mbaje[3] ? parseInt(mbaje[3], 10) : 0;
    let isAmbiguousMeridiem = false;
    let desc = '';

    if (rawPeriod === 'subah' || rawPeriod === '\u0938\u0941\u092c\u0939') {
      if (h === 12) h = 0;
      desc = ' (Morning)';
    } else if (rawPeriod === 'shaam' || rawPeriod === 'sham' || rawPeriod === '\u0936\u093e\u092e') {
      if (h < 12) h += 12;
      desc = ' (Evening)';
    } else if (rawPeriod === 'dopehar' || rawPeriod === 'dopahar' || rawPeriod === '\u0926\u094B\u092a\u0939\u0930') {
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
      raw: mbaje[0].toLowerCase(),
      display: `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')}${ampm ? ' ' + ampm : ''}${desc}`,
      hours24: isAmbiguousMeridiem ? undefined : h,
      minutes: m,
      isAmbiguousMeridiem,
    };
  }

  // 2. 12-hour format with explicit AM/PM: e.g. '9:30 AM', '9 AM', '5:00 pm'
  const m12 = clause.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const m = m12[2] ? parseInt(m12[2], 10) : 0;
    const isPm = m12[3].toLowerCase() === 'pm';
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    const h12 = h % 12 || 12;
    return {
      raw: m12[0].toLowerCase(),
      display: `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${isPm ? 'PM' : 'AM'}`,
      hours24: h,
      minutes: m,
      isAmbiguousMeridiem: false,
    };
  }

  // 3. 24-hour military/ISO format: e.g. '14:30', '09:15'
  const m24 = clause.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const m = parseInt(m24[2], 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return {
      raw: m24[0],
      display: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm})`,
      hours24: h,
      minutes: m,
      isAmbiguousMeridiem: false,
    };
  }

  return null;
}

function determineClauseIntent(clause: string): {
  intent: TemporalIntent;
  badge: string;
  isFuture: boolean;
  isPast: boolean;
  isUncertain: boolean;
} {
  const hasNegation = /\b(nahi|not|nhi|na|doubtful|pakka\s+nahi|unlikely|cancel)\b/i.test(clause) || /[\u0928\u0939\u0940\u0902\u0930\u0926\u094D\u0926]/.test(clause);
  const hasUncertainty = /\b(may|might|could|possible|maybe|shayad|lagta\s+hai|probably|soch\s+rahe)\b/i.test(clause) || /[\u0936\u093e\u092f\u0926\u0938\u0902\u092d\u0935]/.test(clause);

  const hasFuture = /\b(will|shall|scheduled|plan|planned|target|upcoming|hoga|hogi|honge|karenge|karega|karegi|jayega|jayegi|shuru\s+hogi|shuru\s+hoga|hona\s+hai|karna\s+hai|tomorrow)\b/i.test(clause) ||
    /[\u0939\u094B\u0917\u093E\u0939\u094B\u0917\u0940\u0939\u094B\u0902\u0917\u0947\u0915\u0930\u0947\u0902\u0917\u0947\u0915\u0930\u0947\u0917\u093E\u0915\u0930\u0947\u0917\u0940\u092F\u094B\u091c\u0928\u093e]/.test(clause);

  const hasPast = /\b(completed|finished|done|tested|checked|passed|inspected|erected|welded|halted|was|were|did|had|hua|hui|hue|tha|thi|the|gaya|gayi|gaye|kiya|kiye|finish\s+hua|complete\s+hua|ho\s+gaya|yesterday)\b/i.test(clause) ||
    /[\u0939\u0941\u0906\u0939\u0941\u0908\u0939\u0941\u090F\u0925\u093E\u0925\u0940\u0925\u0947\u0917\u092F\u093E\u0917\u0908\u0917\u090F\u0915\u093F\u092F\u093E\u0938\u092E\u094D\u092A\u0928\u094D\u0928]/.test(clause);

  const hasInProgress = /\b(ongoing|in\s+progress|underway|continuing|chal\s+raha|chalu\s+hai|progressing)\b/i.test(clause) ||
    /[\u091a\u0932\u0930\u0939\u093e\u091c\u093e\u0930\u0940]/.test(clause);

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

    // 1. Check relative days ago: e.g. 'two days ago', '2 days ago', '3 din pehle', '2 din pehle'
    const relMatch = clause.match(/(?:^|[^\w\u0900-\u097F])(\d+|one|two|three|four|five|ek|do|teen|chaar|paanch|\u090F\u0915|\u0926\u094B|\u0924\u0940\u0928|\u091a\u093e\u0930|\u092a\u093e\u0902\u091a)\s*(?:days?\s+ago|din\s+pehle|\u0926\u093F\u0928\s*\u092A\u0939\u0932\u0947)(?=[^\w\u0900-\u097F]|$)/i);
    if (relMatch) {
      const count = parseNumberWord(relMatch[1]);
      if (count && count > 0) {
        const offsetResult = offsetKolkataDate(baseKolkata, -count);
        suggestions.push({
          id: `temp-sugg-${++suggestionIndex}`,
          matchedText: clause,
          rawExpression: relMatch[0].trim().toLowerCase(),
          intent: intentAnalysis.intent === 'future_plan' ? 'uncertain' : 'completed_work',
          intentBadge: intentAnalysis.intent === 'future_plan' ? 'Needs confirmation' : 'Completed field work',
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
          confidence: 'confident',
          explanation: `Resolved to ${count} days prior to reference date in Asia/Kolkata timezone.`,
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
      const intent = intentAnalysis.intent === 'uncertain'
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
      const intent = intentAnalysis.intent === 'uncertain'
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
            label: `Tomorrow (Planned work: ${tomorrow.yyyyMmDd})`,
            relation: 'future',
            isSuggestedDefault: isFut,
          },
        ],
        time: timeInfo || undefined,
        confidence: intent === 'uncertain' ? 'needs_confirmation' : 'confident',
        explanation: isFut
          ? `Identified as planned/scheduled future work, not evidence of completed progress. Select whether report date refers to yesterday or tomorrow.`
          : `'${kalMatch[1]}' can refer to yesterday or tomorrow in Hindi/Hinglish. Select the intended date.`,
      });
      continue;
    }

    // 4. Check explicit 'yesterday' (English)
    const yestMatch = clause.match(/\byesterday\b/i);
    if (yestMatch) {
      const yesterday = offsetKolkataDate(baseKolkata, -1);
      suggestions.push({
        id: `temp-sugg-${++suggestionIndex}`,
        matchedText: clause,
        rawExpression: yestMatch[0].toLowerCase(),
        intent: 'completed_work',
        intentBadge: 'Completed field work',
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
        confidence: 'confident',
        explanation: `Explicit yesterday reference in narrative.`,
      });
      continue;
    }

    // 5. Check explicit 'tomorrow' (English)
    const tomMatch = clause.match(/\btomorrow\b/i);
    if (tomMatch) {
      const tomorrow = offsetKolkataDate(baseKolkata, 1);
      suggestions.push({
        id: `temp-sugg-${++suggestionIndex}`,
        matchedText: clause,
        rawExpression: tomMatch[0].toLowerCase(),
        intent: 'future_plan',
        intentBadge: 'Planned future work (Advisory)',
        isAmbiguous: false,
        resolvedDate: tomorrow.yyyyMmDd,
        candidates: [
          {
            date: tomorrow.yyyyMmDd,
            label: `Tomorrow (Planned: ${tomorrow.yyyyMmDd})`,
            relation: 'future',
            isSuggestedDefault: true,
          },
        ],
        time: timeInfo || undefined,
        confidence: 'confident',
        explanation: `Planned future work reference; advisory only.`,
      });
      continue;
    }

    // 6. Check 'last night'
    const lastNightMatch = clause.match(/\blast\s+night\b/i);
    if (lastNightMatch) {
      const yesterday = offsetKolkataDate(baseKolkata, -1);
      suggestions.push({
        id: `temp-sugg-${++suggestionIndex}`,
        matchedText: clause,
        rawExpression: lastNightMatch[0].toLowerCase(),
        intent: 'completed_work',
        intentBadge: 'Completed field work',
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
        confidence: 'confident',
        explanation: `Refers to previous night.`,
      });
      continue;
    }

        // 7. Check 'today' / 'aaj' / 'आज' / 'this morning' / 'subah' / 'सुबह' / 'shaam' / 'शाम' / 'evening' / 'tonight'
    const todayMatch = clause.match(/(?:^|[^w\u0900-\u097F])(aaj|today|this\s+morning|this\s+evening|this\s+afternoon|tonight|subah|shaam|sham|morning|evening|afternoon|dopahar|dopehar|\u0906\u091c|\u0938\u0941\u092c\u0939|\u0936\u093e\u092e|\u0926\u094b\u092a\u0939\u0930|\u0930\u093e\u0924)(?=[^\w\u0900-\u097F]|$)/i);
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

      suggestions.push({
        id: `temp-sugg-${++suggestionIndex}`,
        matchedText: clause,
        rawExpression: expr,
        intent: intentAnalysis.intent === 'future_plan' ? 'future_plan' : 'completed_work',
        intentBadge: intentAnalysis.intent === 'future_plan' ? 'Planned future work (Advisory)' : 'Completed field work',
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
        confidence: 'confident',
        explanation: `Current day reference in Asia/Kolkata timezone.`,
      });
      continue;
    }

    // 8. If no date matched but an explicit clock time is mentioned: e.g. '9:30 AM pump alignment checked'
    if (timeInfo) {
      suggestions.push({
        id: `temp-sugg-${++suggestionIndex}`,
        matchedText: clause,
        rawExpression: timeInfo.raw,
        intent: intentAnalysis.intent,
        intentBadge: intentAnalysis.badge,
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
        time: timeInfo,
        confidence: timeInfo.isAmbiguousMeridiem ? 'needs_confirmation' : 'confident',
        explanation: `Clock time mentioned: ${timeInfo.display}. Inferred date is today (${baseKolkata.yyyyMmDd}).`,
      });
    }
  }

  return suggestions;
}
