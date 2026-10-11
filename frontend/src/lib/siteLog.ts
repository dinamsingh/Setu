import type { FieldUpdate } from '../types';
import type { Clarification } from '../types/workflow';
import { workflowState } from './workflow';

export type SiteLogTone = 'blue' | 'amber' | 'green' | 'neutral';

export function siteLogStatus(update: FieldUpdate, rounds: Clarification[] = []): { label: string; tone: SiteLogTone } {
  if (update.status === 'approved') return { label: 'Planner approved', tone: 'green' };
  if (update.status === 'remapped') return { label: 'Remapped & approved', tone: 'green' };
  if (update.status === 'rejected') return { label: 'Closed', tone: 'neutral' };
  const state = workflowState(update, rounds);
  if (state === 'Awaiting Field Response') return { label: 'Reply requested', tone: 'amber' };
  if (state === 'Response Received') return { label: 'Response sent', tone: 'blue' };
  if (state === 'Validation Blocked') return { label: 'Planner check needed', tone: 'amber' };
  if (state === 'Awaiting AI' || state === 'Reprocessing Evidence') return { label: 'AI linking', tone: 'blue' };
  if (state === 'Reviewable' && !update.matched_activity_id) return { label: 'Needs mapping', tone: 'amber' };
  if (state === 'Reviewable' || state === 'Ready to Confirm Remap') return { label: 'Ready for planner', tone: 'blue' };
  return { label: 'Under review', tone: 'blue' };
}

export function ownSiteUpdates(updates: FieldUpdate[], userId?: string): FieldUpdate[] {
  if (!userId) return [];
  return updates.filter((update) => update.submitted_by_user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

export function siteLogDate(raw: string | null | undefined): string {
  if (!raw) return 'Date not provided';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) return 'Date not provided';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  if (Number.isNaN(date.valueOf())) return 'Date not provided';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}
