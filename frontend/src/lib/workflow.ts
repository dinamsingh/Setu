import type { FieldUpdate } from '../types';
import type { Clarification, RemapProposal, WorkflowState } from '../types/workflow';

export const impactLabels = {
  confirm_only: 'Confirm only', validation_inputs_changed: 'Validation inputs changed',
  mapping_inputs_changed: 'Mapping inputs changed',
};
export function activeProposal(proposals: RemapProposal[], id: string) {
  return proposals.find(p => p.field_update_id === id && ['pending_validation', 'validated', 'blocked'].includes(p.status));
}
export function proposalReady(p: RemapProposal, update: FieldUpdate) {
  const fresh = p.evidence_revision === (update.evidence_revision ?? 0)
    && p.validation_evidence_revision === p.evidence_revision && p.validated_generation === p.validation_generation;
  return fresh && ((p.status === 'validated' && ['pass', 'warn'].includes(p.validation_status ?? ''))
    || (p.status === 'blocked' && p.validation_status === 'block' && p.validation_overridden
      && p.override_evidence_revision === p.evidence_revision && p.override_validation_generation === p.validation_generation));
}
export function workflowState(update: FieldUpdate, rounds: Clarification[] = [], proposals: RemapProposal[] = []): WorkflowState {
  if (update.status !== 'pending') return 'Finalized';
  const round = rounds.find(c => c.field_update_id === update.id && ['open', 'responded'].includes(c.status));
  if (round) return round.status === 'responded' ? 'Response Received' : 'Awaiting Field Response';
  const proposal = activeProposal(proposals, update.id);
  if (proposal) {
    if (proposalReady(proposal, update)) return 'Ready to Confirm Remap';
    return proposal.status === 'blocked' ? 'Validation Blocked' : 'Validating Selected Activity';
  }
  if ((update.evidence_revision ?? 0) !== (update.validation_evidence_revision ?? 0)) return 'Reprocessing Evidence';
  if (!update.confidence_level || update.confidence_level === 'Pending') return 'Awaiting AI';
  if (update.validation_status === 'block' && !update.validation_overridden) return 'Validation Blocked';
  return update.validation_status ? 'Reviewable' : 'Reprocessing Evidence';
}
export function canAccept(update: FieldUpdate, rounds: Clarification[] = [], proposals: RemapProposal[] = []) {
  if (workflowState(update, rounds, proposals) !== 'Reviewable' || !update.matched_activity_id) return false;
  return ['pass', 'warn'].includes(update.validation_status ?? '') || (update.validation_status === 'block'
    && update.validation_overridden === true && update.override_evidence_revision === (update.evidence_revision ?? 0)
    && update.override_activity_id === update.matched_activity_id);
}
export function workflowPriority(state: WorkflowState) {
  return { 'Response Received': 0, 'Validation Blocked': 1, 'Ready to Confirm Remap': 3,
    Reviewable: 3, 'Awaiting Field Response': 4, 'Reprocessing Evidence': 5,
    'Validating Selected Activity': 5, 'Awaiting AI': 5, Finalized: 6 }[state];
}
export function addressedRequests(rounds: Clarification[], userId: string) {
  return rounds.filter(c => c.mode === 'request_response' && c.recipient_user_id === userId);
}
