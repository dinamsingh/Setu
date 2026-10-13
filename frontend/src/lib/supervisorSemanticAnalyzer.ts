import { parseTemporalExpressions, getKolkataReferenceDate, type TemporalSuggestion } from './temporalParser';

export interface ClarificationOption {
  label: string;
  resolution: string;
  targetDate?: string;
}

export interface MaterialAmbiguity {
  id: string;
  question: string;
  options: ClarificationOption[];
  rawContext: string;
  reason: 'relative_day_unanchored' | 'conflicting_status' | 'reported_date_divergence';
}

export interface SupervisorAnalysisResult {
  isValid: boolean;
  validationError?: string;
  completedWork: string[];
  futurePlans: string[];
  ongoingWork: string[];
  uncertainties: string[];
  temporalSuggestions: TemporalSuggestion[];
  materialAmbiguity: MaterialAmbiguity | null;
  summary: {
    hasCompletedWork: boolean;
    hasFuturePlans: boolean;
    hasUncertainty: boolean;
    originalNarrative: string;
    reportedDate: string;
  };
}

/**
 * Intelligent semantic analyzer for supervisor narratives.
 * Validates inputs, extracts temporal/status clauses, separates completed vs. future work,
 * and detects material ambiguities that require targeted clarification before submission.
 */
export function analyzeSupervisorNarrative(
  fieldText: string,
  reportedDate: string,
  options?: { referenceDate?: Date; location?: string }
): SupervisorAnalysisResult {
  const trimmedText = (fieldText || '').trim();

  // Basic narrative validation
  if (!trimmedText) {
    return {
      isValid: false,
      validationError: 'Field update narrative is required.',
      completedWork: [],
      futurePlans: [],
      ongoingWork: [],
      uncertainties: [],
      temporalSuggestions: [],
      materialAmbiguity: null,
      summary: {
        hasCompletedWork: false,
        hasFuturePlans: false,
        hasUncertainty: false,
        originalNarrative: trimmedText,
        reportedDate,
      },
    };
  }

  if (trimmedText.length < 3) {
    return {
      isValid: false,
      validationError: 'Narrative is too short. Please describe what happened on site.',
      completedWork: [],
      futurePlans: [],
      ongoingWork: [],
      uncertainties: [],
      temporalSuggestions: [],
      materialAmbiguity: null,
      summary: {
        hasCompletedWork: false,
        hasFuturePlans: false,
        hasUncertainty: false,
        originalNarrative: trimmedText,
        reportedDate,
      },
    };
  }

  // Parse temporal expressions using the deterministic parser
  const suggestions = parseTemporalExpressions(trimmedText, options);

  const completedWork: string[] = [];
  const futurePlans: string[] = [];
  const ongoingWork: string[] = [];
  const uncertainties: string[] = [];

  // Group clauses and suggestions by intent
  for (const s of suggestions) {
    const clause = (s.matchedText || s.rawExpression || '').trim();
    if (s.confidence === 'needs_confirmation' || s.intent === 'uncertain') {
      uncertainties.push(clause);
    } else if (s.intent === 'future_plan') {
      futurePlans.push(clause);
    } else if (s.intent === 'completed_work') {
      completedWork.push(clause);
    }
  }

  // Also inspect narrative clauses directly for explicit Hindi/Hinglish patterns
  const sentences = trimmedText.split(/[।\n.,;?!]+/).map(s => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const hasNegation = /(?:^|[^\w\u0900-\u097F])(?:नहीं|ना|मत|nahi|nahin|not|never)(?=[^\w\u0900-\u097F]|$)/i.test(sentence);
    const hasUncertainty = /(?:^|[^\w\u0900-\u097F])(?:शायद|संभवतः|shayad|maybe|perhaps|uncertain)(?=[^\w\u0900-\u097F]|$)/i.test(sentence);
    const hasFuture = /(?:^|[^\w\u0900-\u097F])(?:होगी|होगा|करेंगे|करेगा|shuru\s+hogi|shuru\s+hoga|will|shall|tomorrow|aage)(?=[^\w\u0900-\u097F]|$)/i.test(sentence);
    const hasCompleted = /(?:^|[^\w\u0900-\u097F])(?:पूरा\s+हुआ|हो\s+गया|किया|complete\s+hua|finished|done|completed|erected|aligned)(?=[^\w\u0900-\u097F]|$)/i.test(sentence);

    if (hasNegation || hasUncertainty) {
      if (!uncertainties.some(u => u.includes(sentence))) {
        uncertainties.push(sentence);
      }
    } else if (hasFuture && !hasCompleted) {
      if (!futurePlans.some(f => f.includes(sentence))) {
        futurePlans.push(sentence);
      }
    } else if (hasCompleted && !hasNegation && !hasFuture) {
      if (!completedWork.some(c => c.includes(sentence))) {
        completedWork.push(sentence);
      }
    }
  }

  // Material Ambiguity Analysis:
  let materialAmbiguity: MaterialAmbiguity | null = null;

  // 1. Check for conflicting claims on the same action (e.g. welding complete ... kal shuru)
  const weldingConflict = /(?:welding|feeder|pipeline|pump).*complete.*(?:kal|tomorrow).*shuru/i.test(trimmedText)
    || /(?:kal|tomorrow).*shuru.*(?:welding|feeder|pipeline|pump).*complete/i.test(trimmedText);
  if (weldingConflict) {
    materialAmbiguity = {
      id: 'conflict-welding',
      question: 'Welding complete hui hai ya kal shuru hogi?',
      options: [
        { label: 'Complete hui hai (Completed)', resolution: 'completed' },
        { label: 'Kal shuru hogi (Future plan)', resolution: 'future_plan' },
      ],
      rawContext: trimmedText,
      reason: 'conflicting_status',
    };
  }

  // 2. Check for ambiguous relative day 'kal' without clear past or future tense marker
  if (!materialAmbiguity) {
    const ambiguousKalSuggestion = suggestions.find(s => s.isAmbiguous && s.candidates && s.candidates.length > 1);
    if (ambiguousKalSuggestion) {
      const clause = (ambiguousKalSuggestion.matchedText || '').toLowerCase();
      const hasPastMarker = /(?:hua|gaya|kiya|khatam|finished|done|was)/i.test(clause);
      const hasFutureMarker = /(?:hoga|hogi|karenge|will|shall|start|shuru)/i.test(clause);

      if (!hasPastMarker && !hasFutureMarker) {
        materialAmbiguity = {
          id: 'ambiguous-kal',
          question: 'Ye kaam kal hua tha ya aage plan hai?',
          options: [
            { label: 'Kal hua tha (Completed)', resolution: 'past_completed' },
            { label: 'Kal hoga (Future plan)', resolution: 'future_plan' },
          ],
          rawContext: ambiguousKalSuggestion.matchedText,
          reason: 'relative_day_unanchored',
        };
      }
    }
  }

  // 3. Check for divergence between narrative explicit completed day and reported date
  // e.g. narrative explicitly states "kaam kal complete hua" but reportedDate is today
  if (!materialAmbiguity) {
    const baseKolkata = getKolkataReferenceDate(options?.referenceDate);
    const explicitYesterdayPast = /(?:kal\s+(?:kaam|work)?.*(?:hua|complete|finished)|yesterday.*(?:finished|completed))/i.test(trimmedText)
      && !/(?:nahi|not)/i.test(trimmedText);

    if (explicitYesterdayPast && reportedDate === baseKolkata.yyyyMmDd) {
      materialAmbiguity = {
        id: 'date-divergence',
        question: 'Ye kaam aaj hua tha ya kal?',
        options: [
          { label: 'Aaj hua tha (Today)', resolution: 'today' },
          { label: 'Kal hua tha (Yesterday)', resolution: 'yesterday' },
        ],
        rawContext: trimmedText,
        reason: 'reported_date_divergence',
      };
    }
  }

  return {
    isValid: true,
    completedWork,
    futurePlans,
    ongoingWork,
    uncertainties,
    temporalSuggestions: suggestions,
    materialAmbiguity,
    summary: {
      hasCompletedWork: completedWork.length > 0,
      hasFuturePlans: futurePlans.length > 0,
      hasUncertainty: uncertainties.length > 0,
      originalNarrative: trimmedText,
      reportedDate,
    },
  };
}
