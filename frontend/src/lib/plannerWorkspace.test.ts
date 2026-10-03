import { describe, expect, it } from 'vitest';
import type { FieldUpdate, ScheduleActivity } from '../types';
import {
  actionErrorMessage,
  canRemapToActivity,
  computeOperationalCounts,
  describeAuditActivityChange,
  filterAndSortPlannerUpdates,
  humanizeAuditAction,
} from './plannerWorkspace';

const activity: ScheduleActivity = {
  id: 'schedule-1',
  activity_id: 'ACT-001',
  activity_name: 'Piping spool erection',
  wbs_code: '1.1.1',
  discipline: 'Piping',
};

const activities = new Map([[activity.activity_id, activity]]);

function makeUpdate(id: string, overrides: Partial<FieldUpdate> = {}): FieldUpdate {
  return {
    id,
    update_id: `UPD-${id}`,
    source_type: 'manual_text',
    field_text: `Evidence ${id}`,
    site_location: 'Area A',
    reported_by: 'Supervisor',
    expanded_text: null,
    matched_activity_id: 'ACT-001',
    confidence_score: 0.88,
    confidence_level: 'High',
    matched_layer: 'hybrid',
    candidate_matches: [],
    validation_status: 'pass',
    validation_results: [],
    validation_overridden: false,
    status: 'pending',
    planner_remarks: null,
    reported_date: '2026-10-03',
    created_at: '2026-10-03T08:00:00Z',
    updated_at: '2026-10-03T08:00:00Z',
    ...overrides,
  };
}

describe('planner operational counts', () => {
  it('uses pending, matching, validation, confidence, and valid-link definitions', () => {
    const updates = [
      makeUpdate('ready'),
      makeUpdate('blocked', { validation_status: 'block' }),
      makeUpdate('low', {
        confidence_level: 'Low',
        confidence_score: 0.31,
        matched_activity_id: null,
      }),
      makeUpdate('invalid-link', { matched_activity_id: 'ACT-MISSING' }),
      makeUpdate('awaiting', {
        confidence_level: 'Pending',
        confidence_score: 0,
        matched_activity_id: null,
        validation_status: null,
      }),
      makeUpdate('finalized', {
        status: 'approved',
        confidence_level: 'Low',
        matched_activity_id: null,
      }),
    ];

    expect(computeOperationalCounts(updates, activities)).toEqual({
      pendingReview: 4,
      blocked: 1,
      lowConfidence: 1,
      unmatched: 2,
      awaitingAi: 1,
    });
  });
});

describe('planner queue filtering and ordering', () => {
  const baseFilters = {
    view: 'unresolved' as const,
    confidence: 'All',
    status: 'All',
    discipline: 'All',
    validation: 'All',
    search: '',
  };

  it('defaults unresolved view to pending rows and excludes finalized history', () => {
    const rows = filterAndSortPlannerUpdates(
      [makeUpdate('pending'), makeUpdate('approved', { status: 'approved' })],
      activities,
      baseFilters
    );

    expect(rows.map((row) => row.id)).toEqual(['pending']);
  });

  it('prioritizes blocked, unmatched, and low-confidence work before normal and awaiting work', () => {
    const rows = filterAndSortPlannerUpdates(
      [
        makeUpdate('normal'),
        makeUpdate('awaiting', { confidence_level: 'Pending', validation_status: null }),
        makeUpdate('low', { confidence_level: 'Low', matched_activity_id: null }),
        makeUpdate('blocked', { validation_status: 'block' }),
      ],
      activities,
      baseFilters
    );

    expect(rows.map((row) => row.id)).toEqual(['blocked', 'low', 'normal', 'awaiting']);
  });

  it('does not classify null validation as pass', () => {
    const updates = [
      makeUpdate('pass'),
      makeUpdate('null', { validation_status: null }),
    ];

    const passed = filterAndSortPlannerUpdates(updates, activities, {
      ...baseFilters,
      validation: 'pass',
    });
    const unvalidated = filterAndSortPlannerUpdates(updates, activities, {
      ...baseFilters,
      validation: 'unvalidated',
    });

    expect(passed.map((row) => row.id)).toEqual(['pass']);
    expect(unvalidated.map((row) => row.id)).toEqual(['null']);
  });
});

describe('planner action guards and feedback', () => {
  it('rejects empty and same-activity remap selections', () => {
    expect(canRemapToActivity('ACT-001', '')).toBe(false);
    expect(canRemapToActivity('ACT-001', 'ACT-001')).toBe(false);
    expect(canRemapToActivity('ACT-001', 'ACT-002')).toBe(true);
  });

  it('preserves RPC error text for visible action feedback', () => {
    expect(
      actionErrorMessage(
        { success: false, error: 'Blocked validation requires an override before approval' },
        'Fallback error'
      )
    ).toBe('Blocked validation requires an override before approval');
    expect(actionErrorMessage({ success: false }, 'Fallback error')).toBe('Fallback error');
    expect(actionErrorMessage({ success: true }, 'Fallback error')).toBeNull();
  });
});

describe('planner audit presentation', () => {
  it('humanizes stored action values without changing them', () => {
    expect(humanizeAuditAction('ACCEPT')).toBe('Accepted');
    expect(humanizeAuditAction('REMAP')).toBe('Remapped');
    expect(humanizeAuditAction('REJECT')).toBe('Rejected');
  });

  it('describes audit activity links without a no-activity-to-no-activity label', () => {
    expect(describeAuditActivityChange(null, null)).toBe(
      'Unlinked report · no mapped activity'
    );
    expect(describeAuditActivityChange(null, 'ACT-002')).toBe('Mapped to ACT-002');
    expect(describeAuditActivityChange('ACT-001', null)).toBe(
      'Previous activity ACT-001 · no mapped activity'
    );
  });
});
