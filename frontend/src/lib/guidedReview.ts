import type { FieldUpdate, ScheduleActivity } from '../types';
import type { Clarification, RemapProposal } from '../types/workflow';
import { activeProposal, canAccept, proposalReady, workflowState } from './workflow';

// Presentation only. The existing workflow helpers and RPCs remain authoritative.
export function reviewStage(update: FieldUpdate, rounds: Clarification[] = [], proposals: RemapProposal[] = [],
  activity?: ScheduleActivity, available = true) {
  const state = workflowState(update, rounds, proposals);
  const proposal = activeProposal(proposals, update.id);
  const revision = update.evidence_revision ?? 0;
  const currentOverride = update.validation_status === 'block' && update.validation_overridden === true
    && update.override_evidence_revision === revision && update.override_activity_id === update.matched_activity_id
    && (update.validation_evidence_revision ?? 0) === revision;
  const matched = update.status === 'remapped' || Boolean(update.confidence_level && update.confidence_level !== 'Pending');
  const validated = proposal ? proposalReady(proposal, update)
    : (update.validation_evidence_revision ?? 0) === revision
      && (['pass', 'warn'].includes(update.validation_status ?? '') || currentOverride);
  const terminal = update.status !== 'pending';
  const canApprove = available && Boolean(activity && activity.activity_id === update.matched_activity_id)
    && update.confidence_level !== 'Low' && canAccept(update, rounds, proposals);
  const current = terminal ? 5 : !update.field_text.trim() ? 1 : !available ? 3
    : ['Awaiting Field Response', 'Response Received'].includes(state) ? 4
    : proposal ? (validated ? 4 : 3) : !matched ? 2 : !validated ? 3 : 4;
  const guidance = terminal ? 'Planner decision recorded. This report is read-only.'
    : !available ? 'Workflow data must load before you can decide.'
    : state === 'Awaiting Field Response' ? 'Waiting for the original field submitter. You cannot approve while clarification is open.'
    : state === 'Response Received' ? 'Read the field response, then classify its impact before continuing.'
    : proposal ? (validated ? 'Review the validated selected activity, then confirm the remap.' : 'Resolve or wait for validation of the selected activity.')
    : current === 2 ? 'Field evidence received. SETU is processing the AI match.'
    : current === 3 ? 'Current validation must complete or its blocking issue must be resolved before approval.'
    : canApprove ? 'Review the suggestion, then record your planner decision. AI suggests; you decide.'
    : 'Choose a different activity or ask for clarification. This report is not ready for acceptance.';
  return { current, state, currentOverride, canApprove, guidance,
    completed: [Boolean(update.field_text.trim()), matched, validated, terminal, terminal] };
}
