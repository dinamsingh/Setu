import { describe, it, expect } from 'vitest';
import { extractCandidateTerms } from './aliasProposer';
import fs from 'node:fs';
import path from 'node:path';

interface TestCase {
  case_id: string;
  field_text: string;
  target_activity_name: string;
  target_discipline: string;
  expected_candidates: Array<{
    field_term: string;
    standard_term: string;
    discipline: string;
    score: number;
  }>;
}

describe('Deterministic Alias Proposer Parity (TypeScript vs Python)', () => {
  const fixturePath = path.resolve(__dirname, '../../../tests/fixtures/alias_proposal_cases.json');
  const testCases: TestCase[] = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

  for (const tc of testCases) {
    it(`should produce identical outputs for ${tc.case_id}`, () => {
      const candidates = extractCandidateTerms(
        tc.field_text,
        tc.target_activity_name,
        tc.target_discipline
      );

      expect(candidates).toEqual(tc.expected_candidates);
    });
  }
});
