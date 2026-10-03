import { describe, expect, it } from 'vitest';
import { addressedRequests, canAccept, proposalReady, workflowState } from './workflow';
import { computeOperationalCounts, filterAndSortPlannerUpdates } from './plannerWorkspace';
import { report, round, proposal } from '../test/workflowFixtures';

describe('workflow freshness and authority', () => {
  it('locks decisions during requests, responses, reprocessing, null validation and proposals', () => {
    expect(workflowState(report, [round])).toBe('Awaiting Field Response');
    expect(workflowState(report, [{ ...round, status: 'responded' }])).toBe('Response Received');
    expect(workflowState({ ...report, evidence_revision: 1 })).toBe('Reprocessing Evidence');
    expect(canAccept({ ...report, validation_status: null })).toBe(false);
    expect(canAccept(report, [round])).toBe(false);
    expect(canAccept(report, [], [proposal])).toBe(false);
  });
  it('only accepts current pass/warn or evidence/activity-scoped report overrides', () => {
    expect(canAccept(report)).toBe(true);
    expect(canAccept({ ...report, validation_status: 'warn' })).toBe(true);
    expect(canAccept({ ...report, validation_status: 'block', validation_overridden: true })).toBe(false);
    expect(canAccept({ ...report, validation_status: 'block', validation_overridden: true,
      override_evidence_revision: 0, override_activity_id: 'ACT-A' })).toBe(true);
  });
  it('binds proposal readiness to validated generation, evidence and proposal override', () => {
    const validated = { ...proposal, status: 'validated' as const, validation_status: 'warn' as const,
      validated_generation: 1, validation_evidence_revision: 0 };
    expect(proposalReady(validated, report)).toBe(true);
    expect(proposalReady({ ...validated, validated_generation: 2 }, report)).toBe(false);
    expect(proposalReady(validated, { ...report, evidence_revision: 1 })).toBe(false);
    const blocked = { ...validated, status: 'blocked' as const, validation_status: 'block' as const };
    expect(proposalReady(blocked, { ...report, validation_overridden: true })).toBe(false);
    expect(proposalReady({ ...blocked, validation_overridden: true, override_evidence_revision: 0, override_validation_generation: 1 }, report)).toBe(true);
  });
  it('filters addressed requests by auth identity, not display name', () => {
    expect(addressedRequests([round, { ...round, id: 'other', recipient_user_id: 'other' }], 'site')).toEqual([round]);
  });
  it('counts real workflow states, with overlapping matched pending counts', () => {
    const rows = [report, { ...report, id: 'triage' }, { ...report, id: 'processing', evidence_revision: 1 }, { ...report, id: 'remap' }];
    const counts = computeOperationalCounts(rows, new Map(), [round, { ...round, field_update_id: 'triage', status: 'responded' }],
      [{ ...proposal, field_update_id: 'remap' }]);
    expect(counts.awaitingResponse).toBe(1); expect(counts.needsTriage).toBe(1);
    expect(counts.reprocessing).toBe(1); expect(counts.remapPending).toBe(1);
    expect(counts.pendingReview).toBe(4); expect(counts.awaitingAi).toBe(0);
  });
  it('prioritizes triage before blocks, review and waiting states', () => {
    const rows = [{ ...report, id: 'awaiting' }, { ...report, id: 'reviewable' }, { ...report, id: 'blocked', validation_status: 'block' as const }, { ...report, id: 'triage' }];
    const sorted = filterAndSortPlannerUpdates(rows, new Map([['ACT-A', { id: 'a', activity_id: 'ACT-A', activity_name: 'Task', wbs_code: '1', discipline: 'Piping' }]]),
      { view: 'unresolved', confidence: 'All', status: 'All', discipline: 'All', validation: 'All', search: '' },
      [{ ...round, field_update_id: 'awaiting' }, { ...round, field_update_id: 'triage', status: 'responded' }]);
    expect(sorted.map(r => r.id)).toEqual(['triage', 'blocked', 'reviewable', 'awaiting']);
  });
});
