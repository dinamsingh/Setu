import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FieldUpdate, ScheduleActivity, ValidationCheckResult } from '../../types';
import { ReviewCard } from './ReviewCard';

const activity: ScheduleActivity = {
  id: 'schedule-row-1',
  activity_id: 'ACT-001',
  activity_name: 'Piping Spool Erection - Manifold A',
  wbs_code: '1.1.1',
  discipline: 'Piping',
};

const validationResults: ValidationCheckResult[] = [
  {
    check: 'date_plausibility',
    name: 'Date Plausibility',
    outcome: 'fail',
    message: 'Reported date is 45 days before planned start.',
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

function makeUpdate(overrides: Partial<FieldUpdate> = {}): FieldUpdate {
  return {
    id: 'field-row-1',
    update_id: 'UPD-TEST-001',
    source_type: 'manual_text',
    field_text: 'Spool erection completed at Manifold A.',
    site_location: 'Manifold A',
    reported_by: 'Site Supervisor',
    expanded_text: null,
    matched_activity_id: 'ACT-001',
    confidence_score: 0.9,
    confidence_level: 'High',
    matched_layer: 'semantic',
    candidate_matches: [],
    validation_status: 'pass',
    validation_results: [],
    validation_overridden: false,
    status: 'pending',
    planner_remarks: null,
    reported_date: '2026-10-03',
    created_at: '2026-10-03T00:00:00Z',
    updated_at: '2026-10-03T00:00:00Z',
    ...overrides,
  };
}

function renderReview(
  overrides: Partial<FieldUpdate> = {},
  matchedActivity: ScheduleActivity | undefined = activity
) {
  return renderToStaticMarkup(
    <ReviewCard
      update={makeUpdate(overrides)}
      matchedActivity={matchedActivity}
      plannerName="Lead Project Planner"
      onAccept={async () => undefined}
      onReject={async () => undefined}
      onOpenRemap={() => undefined}
      onOpenOverride={() => undefined}
      onRequeue={async () => undefined}
    />
  );
}

describe('ReviewCard planner governance states', () => {
  it('offers approval for a pending High, valid, passing link', () => {
    const html = renderReview();
    expect(html).toContain('data-testid="decision-status-bar"');
    expect(html).toContain('sticky top-16');
    expect(html).toContain('Ready for decision');
    expect(html).toContain('Accept mapping');
    expect(html).toContain('Remap activity');
    expect(html).toContain('More actions');
    expect(html).not.toContain('Decision note');
  });

  it('keeps review and remap available for a pending Medium link', () => {
    const html = renderReview({ confidence_level: 'Medium', confidence_score: 0.7 });
    expect(html).toContain('Accept mapping');
    expect(html).toContain('Remap activity');
  });

  it('requires an unlinked Low report to be remapped or rejected', () => {
    const html = renderReview(
      { confidence_level: 'Low', confidence_score: 0.3, matched_activity_id: null },
      undefined
    );
    expect(html).not.toContain('Accept mapping');
    expect(html).toContain('Remap activity');
    expect(html).toContain('No valid schedule activity is linked');
  });

  it('locks approval and final remap for a non-overridden validation block', () => {
    const html = renderReview({
      validation_status: 'block',
      validation_results: validationResults,
    });
    expect(html).toContain('Blocked by validation');
    expect(html).toContain(
      '1 validation control failed. Review failed checks before taking an exceptional action.'
    );
    expect(html).toContain('Review failed checks');
    expect(html).toContain('Exceptional: override validation');
    expect(html).toContain('Normal decision controls are locked');
    expect(html).not.toContain('Accept mapping');
    expect(html).not.toContain('Remap activity');
    expect(html).not.toContain('Decision note');
  });

  it('restores normal planner actions after a documented override', () => {
    const html = renderReview({
      validation_status: 'block',
      validation_results: validationResults,
      validation_overridden: true,
      override_reason: 'Verified against the signed site log.',
    });
    expect(html).toContain('Accept mapping');
    expect(html).toContain('Remap activity');
  });

  it.each(['approved', 'rejected', 'remapped'] as const)(
    'renders a %s row as finalized and read-only',
    (status) => {
      const html = renderReview({ status });
      expect(html).toContain('Finalized / read-only');
      expect(html).toContain('Finalized planner decision');
      expect(html).toContain('Read-only');
      expect(html).not.toContain('Accept mapping');
      expect(html).not.toContain('Remap activity');
      expect(html).not.toContain('Reject report (terminal)');
      expect(html).not.toContain('Requeue matching');
      expect(html).not.toContain('More actions');
    }
  );

  it('shows matching progress without planner decision controls while awaiting AI', () => {
    const html = renderReview(
      {
        confidence_level: 'Pending',
        confidence_score: 0,
        matched_activity_id: null,
        validation_status: null,
      },
      undefined
    );

    expect(html).toContain('Awaiting AI');
    expect(html).toContain('Matching in progress');
    expect(html).toContain(
      'Planner decision controls are unavailable until AI matching and validation complete.'
    );
    expect(html).not.toContain('Accept mapping');
    expect(html).not.toContain('Remap activity');
    expect(html).not.toContain('Requeue matching');
    expect(html).not.toContain('Reject report');
    expect(html).not.toContain('More actions');
  });

  it('renders the stored validation names, outcomes, messages, and evidence', () => {
    const html = renderReview({
      validation_status: 'block',
      validation_results: validationResults,
    });
    expect(html).toContain('Date Plausibility');
    expect(html).toContain('BLOCK');
    expect(html).toContain('Reported date is 45 days before planned start.');
    expect(html).toContain('days_early');
    expect(html).toContain('Reporter Discipline Consistency');
    expect(html).toContain('WARN');
    expect(html).not.toContain('Check passed.');
  });
});
