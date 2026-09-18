/**
 * Deterministic Domain Alias Proposer for SETU (Frontend Client).
 * 
 * Extracts candidate domain jargon phrases from field reports when a planner
 * remaps or corrects an activity match. Generates top candidate suggestions
 * directly in the browser without requiring server endpoints.
 */

import type { DomainAlias } from '../types';

export interface ProposedCandidate {
  field_term: string;
  standard_term: string;
  discipline: string;
  score: number;
}

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', "aren't", 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', "can't", 'cannot', 'could', "couldn't",
  'did', "didn't", 'do', 'does', "doesn't", 'doing', "don't", 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', "hadn't", 'has', "hasn't",
  'have', "haven't", 'having', 'he', "he'd", "he'll", "he's", 'her', 'here',
  "here's", 'hers', 'herself', 'him', 'himself', 'his', 'how', "how's", 'i',
  "i'd", "i'll", "i'm", "i've", 'if', 'in', 'into', 'is', "isn't", 'it', "it's",
  'its', 'itself', "let's", 'me', 'more', 'most', "mustn't", 'my', 'myself',
  'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought',
  'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', "shan't", 'she',
  "she'd", "she'll", "she's", 'should', "shouldn't", 'so', 'some', 'such',
  'than', 'that', "that's", 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', "there's", 'these', 'they', "they'd", "they'll", "they're",
  "they've", 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up',
  'very', 'was', "wasn't", 'we', "we'd", "we'll", "we're", "we've", 'were',
  "weren't", 'what', "what's", 'when', "when's", 'where', "where's", 'which',
  'while', 'who', "who's", 'whom', 'why', "why's", 'with', "won't", 'would',
  "wouldn't", 'you', "you'd", "you'll", "you're", "you've", 'your', 'yours',
  'yourself', 'yourselves'
]);

const GENERIC_REPORT_WORDS = new Set([
  'work', 'works', 'completed', 'complete', 'done', 'ongoing', 'started',
  'in-progress', 'progress', 'report', 'reported', 'today', 'yesterday',
  'daily', 'site', 'status', 'activity', 'activities', 'location', 'unit',
  'area', 'section', 'team', 'shift', 'day', 'date'
]);

const MEASUREMENT_UNITS = new Set([
  'm', 'mm', 'cm', 'km', 'in', 'inch', 'inches', 'ft', 'feet', 'm3', 'm2',
  'cum', 'sqm', 'dia', 'nb', 'od', 'id', 'kg', 'ton', 'tons', 'mt', 'psi',
  'bar', 'kpa', 'deg', 'c', 'f', 'hr', 'hrs', 'nos', 'no', 'qty', '%'
]);

function cleanToken(t: string): string {
  return t.replace(/^[^\w\-]+|[^\w\-]+$/g, '').trim();
}

function isNumericOrUnit(token: string): boolean {
  const cleaned = token.toLowerCase().trim();
  if (/^\d+([.,]\d+)?(\w+|%)?$/.test(cleaned)) {
    return true;
  }
  if (/^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(cleaned)) {
    return true;
  }
  return MEASUREMENT_UNITS.has(cleaned);
}

export function extractCandidateTerms(
  fieldText: string,
  targetActivityName: string,
  targetDiscipline?: string | null,
  existingAliases?: DomainAlias[],
  topK: number = 3
): ProposedCandidate[] {
  if (!fieldText || !targetActivityName) {
    return [];
  }

  const existingTerms = new Set<string>();
  if (existingAliases) {
    for (const al of existingAliases) {
      if (al.field_term) {
        existingTerms.add(al.field_term.toLowerCase().trim());
      }
    }
  }

  const actWordsMatch = targetActivityName.toLowerCase().match(/[a-z0-9]+/g) || [];
  const activityWords = new Set(actWordsMatch);

  const rawTokens = fieldText.split(/\s+/);
  const tokens = rawTokens.map(cleanToken).filter(Boolean);

  const candidates = new Map<string, number>();
  const nTokens = tokens.length;

  for (const n of [1, 2, 3]) {
    for (let i = 0; i <= nTokens - n; i++) {
      const ngramTokens = tokens.slice(i, i + n);
      const phrase = ngramTokens.join(' ').toLowerCase();

      const first = ngramTokens[0].toLowerCase();
      const last = ngramTokens[ngramTokens.length - 1].toLowerCase();
      if (STOPWORDS.has(first) || STOPWORDS.has(last)) continue;
      if (GENERIC_REPORT_WORDS.has(first) || GENERIC_REPORT_WORDS.has(last)) continue;

      if (ngramTokens.some(isNumericOrUnit)) continue;
      if (phrase.length < 3) continue;
      if (existingTerms.has(phrase)) continue;

      const phraseWords = phrase.match(/[a-z0-9]+/g) || [];
      if (phraseWords.length === 0 || phraseWords.every(w => activityWords.has(w))) {
        continue;
      }

      let score = 1.0;
      if (phrase.includes('-')) score += 3.0;
      if (n === 2) score += 2.0;
      else if (n === 3) score += 1.2;

      const rawSlice = rawTokens.slice(i, i + n);
      if (rawSlice.some(t => t && t[0] === t[0].toUpperCase() && t[0] !== t[0].toLowerCase())) {
        score += 1.0;
      }
      score += Math.max(0, 1.0 - (i / Math.max(1, nTokens)));

      const currentScore = candidates.get(phrase) || 0;
      if (score > currentScore) {
        candidates.set(phrase, score);
      }
    }
  }

  const sorted = Array.from(candidates.entries()).sort((a, b) => b[1] - a[1]);

  const results: ProposedCandidate[] = [];
  const seen = new Set<string>();

  for (const [term, score] of sorted) {
    const cleanTerm = term.trim().toLowerCase();
    if (seen.has(cleanTerm)) continue;
    seen.add(cleanTerm);

    results.push({
      field_term: cleanTerm,
      standard_term: targetActivityName.trim(),
      discipline: targetDiscipline || 'General',
      score: Number(score.toFixed(2)),
    });

    if (results.length >= topK) break;
  }

  return results;
}
