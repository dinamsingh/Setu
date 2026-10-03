import type { FieldUpdate, ScheduleActivity } from '../types';
import type { Clarification, RemapProposal } from '../types/workflow';
import { workflowPriority, workflowState } from './workflow';

export type ReviewView =
  | 'unresolved'
  | 'blocked'
  | 'unmatched'
  | 'low'
  | 'awaiting'
  | 'response'
  | 'triage'
  | 'reprocessing'
  | 'remap'
  | 'history'
  | 'all';

export interface OperationalCounts {
  pendingReview: number;
  blocked: number;
  lowConfidence: number;
  unmatched: number;
  awaitingAi: number;
  awaitingResponse: number;
  needsTriage: number;
  reprocessing: number;
  remapPending: number;
  readyToConfirm: number;
}

export interface QueueFilters {
  view: ReviewView;
  confidence: string;
  status: string;
  discipline: string;
  validation: string;
  search: string;
}

export const isMatchingPending = (update: FieldUpdate) =>
  !update.confidence_level || update.confidence_level.toLowerCase() === 'pending';

export const isValidationBlocked = (update: FieldUpdate) =>
  update.validation_status === 'block' && !update.validation_overridden;

export function hasValidMatchedActivity(
  update: FieldUpdate,
  activitiesMap: Map<string, ScheduleActivity>
) {
  return Boolean(
    update.matched_activity_id && activitiesMap.has(update.matched_activity_id)
  );
}

export function computeOperationalCounts(
  updates: FieldUpdate[],
  activitiesMap: Map<string, ScheduleActivity>,
  rounds: Clarification[] = [], proposals: RemapProposal[] = []
): OperationalCounts {
  const counts: OperationalCounts = {
    pendingReview: 0,
    blocked: 0,
    lowConfidence: 0,
    unmatched: 0,
    awaitingAi: 0,
    awaitingResponse: 0, needsTriage: 0, reprocessing: 0, remapPending: 0, readyToConfirm: 0,
  };

  for (const update of updates) {
    if (update.status !== 'pending') continue;
    const state = workflowState(update, rounds, proposals);
    if (state === 'Awaiting Field Response') counts.awaitingResponse++;
    if (state === 'Response Received') counts.needsTriage++;
    if (state === 'Reprocessing Evidence') counts.reprocessing++;
    if (state === 'Validating Selected Activity') counts.remapPending++;
    if (state === 'Ready to Confirm Remap') counts.readyToConfirm++;
    if (state === 'Validation Blocked') counts.blocked++;

    if (isMatchingPending(update)) {
      if (state === 'Awaiting AI') counts.awaitingAi += 1;
      continue;
    }

    counts.pendingReview += 1;
    if (update.confidence_level.toLowerCase() === 'low') counts.lowConfidence += 1;
    if (!hasValidMatchedActivity(update, activitiesMap)) counts.unmatched += 1;
  }

  return counts;
}

function matchesView(
  update: FieldUpdate,
  view: ReviewView,
  activitiesMap: Map<string, ScheduleActivity>,
  rounds: Clarification[], proposals: RemapProposal[]
) {
  switch (view) {
    case 'blocked':
      return workflowState(update, rounds, proposals) === 'Validation Blocked';
    case 'response': return workflowState(update, rounds, proposals) === 'Awaiting Field Response';
    case 'triage': return workflowState(update, rounds, proposals) === 'Response Received';
    case 'reprocessing': return workflowState(update, rounds, proposals) === 'Reprocessing Evidence';
    case 'remap': return ['Validating Selected Activity', 'Ready to Confirm Remap'].includes(workflowState(update, rounds, proposals));
    case 'unmatched':
      return (
        update.status === 'pending' &&
        !isMatchingPending(update) &&
        !hasValidMatchedActivity(update, activitiesMap)
      );
    case 'low':
      return update.status === 'pending' && update.confidence_level.toLowerCase() === 'low';
    case 'awaiting':
      return workflowState(update, rounds, proposals) === 'Awaiting AI';
    case 'history':
      return update.status !== 'pending';
    case 'all':
      return true;
    case 'unresolved':
    default:
      return update.status === 'pending';
  }
}

function queuePriority(
  update: FieldUpdate,
  activitiesMap: Map<string, ScheduleActivity>,
  rounds: Clarification[], proposals: RemapProposal[]
) {
  const state = workflowState(update, rounds, proposals);
  if (state === 'Reviewable' && (!hasValidMatchedActivity(update, activitiesMap) || update.confidence_level === 'Low')) return 2;
  return workflowPriority(state);
}

function updateTimestamp(update: FieldUpdate) {
  const timestamp = Date.parse(
    update.updated_at || update.created_at || update.reported_date || ''
  );
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function filterAndSortPlannerUpdates(
  updates: FieldUpdate[],
  activitiesMap: Map<string, ScheduleActivity>,
  filters: QueueFilters,
  rounds: Clarification[] = [], proposals: RemapProposal[] = []
) {
  return updates
    .filter((update) => {
      if (!matchesView(update, filters.view, activitiesMap, rounds, proposals)) return false;

      if (
        filters.confidence !== 'All' &&
        (update.confidence_level || 'Pending').toLowerCase() !==
          filters.confidence.toLowerCase()
      ) {
        return false;
      }

      if (
        filters.status !== 'All' &&
        update.status.toLowerCase() !== filters.status.toLowerCase()
      ) {
        return false;
      }

      if (filters.discipline !== 'All') {
        const activity = update.matched_activity_id
          ? activitiesMap.get(update.matched_activity_id)
          : undefined;
        const discipline =
          activity?.discipline ||
          (Array.isArray(update.candidate_matches)
            ? update.candidate_matches[0]?.discipline
            : undefined) ||
          'Unassigned';
        if (discipline.toLowerCase() !== filters.discipline.toLowerCase()) return false;
      }

      if (filters.validation !== 'All') {
        if (filters.validation === 'overridden') {
          if (!update.validation_overridden) return false;
        } else if (filters.validation === 'unvalidated') {
          if (update.validation_status != null) return false;
        } else if (update.validation_status !== filters.validation) {
          return false;
        }
      }

      const query = filters.search.trim().toLowerCase();
      if (query) {
        const activity = update.matched_activity_id
          ? activitiesMap.get(update.matched_activity_id)
          : undefined;
        const haystack = [
          update.update_id,
          update.field_text,
          update.site_location,
          update.reported_by,
          update.matched_activity_id,
          activity?.activity_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    })
    .sort((left, right) => {
      const priorityDifference =
        queuePriority(left, activitiesMap, rounds, proposals) - queuePriority(right, activitiesMap, rounds, proposals);
      if (priorityDifference !== 0) return priorityDifference;

      const timeDifference = updateTimestamp(right) - updateTimestamp(left);
      if (timeDifference !== 0) return timeDifference;

      return right.update_id.localeCompare(left.update_id);
    });
}

export function canRemapToActivity(
  currentActivityId: string | null,
  selectedActivityId: string
) {
  return Boolean(
    selectedActivityId && selectedActivityId !== (currentActivityId || '')
  );
}

export function actionErrorMessage(
  result: { success: boolean; error?: string },
  fallback: string
) {
  return result.success ? null : result.error || fallback;
}

const auditActionLabels: Record<string, string> = {
  accept: 'Accepted',
  remap: 'Remapped',
  reject: 'Rejected',
  requeue: 'Requeued',
  override: 'Validation overridden',
  clarification_requested: 'Clarification requested',
  clarification_responded: 'Field response received',
  clarification_resolved: 'Clarification resolved',
  remap_proposed: 'Remap target proposed',
  remap_proposal_override: 'Selected-target validation overridden',
  remap_proposal_cancelled: 'Remap proposal cancelled',
};

export function humanizeAuditAction(action: string, metadata?: Record<string, unknown>) {
  if (action === 'reject' && metadata?.decision === 'close_as_invalid') return 'Closed as Invalid';
  const normalized = action.trim().toLowerCase();
  return (
    auditActionLabels[normalized] ||
    normalized
      .split('_')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

export function describeAuditActivityChange(
  previousActivityId: string | null,
  newActivityId: string | null
) {
  if (!previousActivityId && !newActivityId) return 'Unlinked report · no mapped activity';
  if (!previousActivityId) return `Mapped to ${newActivityId}`;
  if (!newActivityId) return `Previous activity ${previousActivityId} · no mapped activity`;
  if (previousActivityId === newActivityId) return `Mapped activity ${newActivityId} retained`;
  return `${previousActivityId} to ${newActivityId}`;
}
