import { describe, expect, it } from 'vitest';
import type { FieldUpdate, ScheduleActivity, ValidationCheckResult } from '../types';
import { buildExportData, parseValidationResults } from './utils';

const validationChecks: ValidationCheckResult[] = [
  {
    check: 'date_plausibility',
    name: 'Date Plausibility',
    outcome: 'fail',
    message: 'Reported date is outside the permitted window.',
    evidence: { days_early: 45 },
  },
  {
    check: 'reporter_discipline',
    name: 'Reporter Discipline Consistency',
    outcome: 'warn',
    message: 'Reporter discipline differs from the activity discipline.',
    evidence: { activity_discipline: 'Piping' },
  },
];

function makeUpdate(overrides: Partial<FieldUpdate>): FieldUpdate {
  return {
    id: 'row-1',
    update_id: 'UPD-TEST-001',
    source_type: 'manual_text',
    field_text: 'Test field evidence',
    site_location: 'Area A',
    reported_by: 'Site Supervisor',
    expanded_text: null,
    matched_activity_id: 'ACT-001',
    confidence_score: 0.9,
    confidence_level: 'High',
    matched_layer: 'semantic',
    candidate_matches: [],
    status: 'approved',
    planner_remarks: 'Verified',
    reported_date: '2026-10-03',
    created_at: '2026-10-03T00:00:00Z',
    updated_at: '2026-10-03T00:00:00Z',
    ...overrides,
  };
}

describe('validation result parsing', () => {
  it('preserves the backend array structure and identifiers', () => {
    expect(parseValidationResults(validationChecks)).toEqual(validationChecks);
  });

  it('parses a serialized backend array without inventing checks', () => {
    expect(parseValidationResults(JSON.stringify(validationChecks))).toEqual(validationChecks);
    expect(parseValidationResults('not-json')).toEqual([]);
  });
});

describe('approved schedule export safety', () => {
  it('exports only finalized rows linked to a loaded schedule activity', () => {
    const activity: ScheduleActivity = {
      id: 'schedule-row-1',
      activity_id: 'ACT-001',
      activity_name: 'Approved Schedule Activity',
      wbs_code: '1.1',
      discipline: 'Piping',
    };
    const activities = new Map([[activity.activity_id, activity]]);
    const updates = [
      makeUpdate({ id: 'valid' }),
      makeUpdate({ id: 'remapped', status: 'remapped' }),
      makeUpdate({ id: 'unlinked', matched_activity_id: null }),
      makeUpdate({ id: 'unknown', matched_activity_id: 'ACT-MISSING' }),
      makeUpdate({ id: 'rejected', status: 'rejected' }),
    ];

    const exported = buildExportData(updates, activities);

    expect(exported).toHaveLength(2);
    expect(exported[0]['Activity ID']).toBe('ACT-001');
    expect(exported[0]['Activity Name']).toBe('Approved Schedule Activity');
    expect(exported[0]['Mapping Source']).toBe('AI suggestion accepted by planner');
    expect(exported[0]['AI Suggestion Confidence Score']).toBe('0.900');
    expect(exported[1]['Mapping Source']).toBe('Planner-selected validated remap');
    expect(exported[1]['AI Suggestion Confidence Score']).toBe('');
    expect(exported[1]).not.toHaveProperty('Confidence Score');
  });
});
