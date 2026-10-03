import React from 'react';
import { AlertOctagon, Calendar, CircleDashed, Clock3, FileText } from 'lucide-react';
import type { FieldUpdate, ScheduleActivity } from '../../types';
import {
  isMatchingPending,
  isValidationBlocked,
} from '../../lib/plannerWorkspace';

interface ReviewQueueItemProps {
  update: FieldUpdate;
  matchedActivity?: ScheduleActivity;
  selected: boolean;
  onSelect: () => void;
  workflowLabel?: string;
}

function queueState(update: FieldUpdate, matchedActivity?: ScheduleActivity) {
  if (update.status !== 'pending') {
    return {
      label: update.status,
      className: 'bg-setu-slate-200 text-setu-slate-700',
      icon: FileText,
    };
  }
  if (isValidationBlocked(update)) {
    return { label: 'Blocked', className: 'bg-rose-100 text-rose-800', icon: AlertOctagon };
  }
  if (isMatchingPending(update)) {
    return { label: 'Awaiting AI', className: 'bg-blue-100 text-blue-800', icon: Clock3 };
  }
  if (!update.matched_activity_id || !matchedActivity) {
    return { label: 'Unmatched', className: 'bg-amber-100 text-amber-900', icon: CircleDashed };
  }
  if (update.confidence_level.toLowerCase() === 'low') {
    return { label: 'Low confidence', className: 'bg-amber-100 text-amber-900', icon: AlertOctagon };
  }
  return { label: 'Needs decision', className: 'bg-teal-100 text-teal-800', icon: FileText };
}

export const ReviewQueueItem: React.FC<ReviewQueueItemProps> = ({
  update,
  matchedActivity,
  selected,
  onSelect,
  workflowLabel,
}) => {
  const state = queueState(update, matchedActivity);
  const StateIcon = state.icon;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`w-full border-l-4 px-4 py-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-setu-blue/30 ${
        selected
          ? 'border-setu-blue bg-blue-50/70'
          : 'border-transparent bg-white hover:border-setu-slate-300 hover:bg-setu-slate-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-xs font-bold text-setu-navy">{update.update_id}</span>
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase ${state.className}`}>
          <StateIcon className="h-3 w-3" />
          {workflowLabel || state.label}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-xs font-medium leading-5 text-setu-slate-800">
        {update.field_text}
      </p>

      <div className="mt-2 border-t border-setu-slate-100 pt-2">
        <p className="truncate text-[11px] font-semibold text-setu-slate-700">
          {isMatchingPending(update)
            ? 'Matching worker pending'
            : matchedActivity
            ? `${matchedActivity.activity_id} · ${matchedActivity.activity_name}`
            : 'No valid linked activity'}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-setu-slate-500">
          <span className="truncate">{update.site_location || 'Location not supplied'}</span>
          <span className="flex shrink-0 items-center gap-1 font-mono">
            <Calendar className="h-3 w-3" />
            {update.reported_date || 'No date'}
          </span>
        </div>
      </div>
    </button>
  );
};
