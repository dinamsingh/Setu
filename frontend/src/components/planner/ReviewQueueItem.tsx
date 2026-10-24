import React from 'react';
import { AlertOctagon, Calendar, ChevronRight, CircleDashed, Clock3, FileText, MapPin } from 'lucide-react';
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
    const label = update.status.charAt(0).toUpperCase() + update.status.slice(1);
    return {
      label,
      className: update.status === 'approved'
        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
        : update.status === 'remapped'
        ? 'bg-purple-100 text-purple-800 border border-purple-200'
        : update.status === 'rejected'
        ? 'bg-rose-100 text-rose-800 border border-rose-200'
        : 'bg-setu-slate-100 text-setu-slate-600',
      icon: FileText,
    };
  }
  if (isValidationBlocked(update)) {
    return { label: 'Blocked', className: 'bg-rose-50 text-rose-700 border border-rose-200', icon: AlertOctagon };
  }
  if (isMatchingPending(update)) {
    return { label: 'Awaiting AI', className: 'bg-blue-50 text-blue-700 border border-blue-200', icon: Clock3 };
  }
  if (!update.matched_activity_id || !matchedActivity) {
    return { label: 'Unmatched', className: 'bg-amber-50 text-amber-700 border border-amber-200', icon: CircleDashed };
  }
  if (update.confidence_level.toLowerCase() === 'low') {
    return { label: 'Low confidence', className: 'bg-amber-50 text-amber-700 border border-amber-200', icon: AlertOctagon };
  }
  return { label: 'Needs decision', className: 'bg-teal-50 text-teal-700 border border-teal-200', icon: FileText };
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
      className={`group w-full px-5 py-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-setu-blue/30 hover:bg-setu-slate-50 ${
        selected
          ? 'bg-blue-50/60'
          : 'bg-white'
      }`}
    >
      {/* Row 1: ID + Status badge */}
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-sm font-bold text-setu-navy">{update.update_id}</span>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded ${state.className}`}>
            <StateIcon className="h-3 w-3" />
            {workflowLabel === 'Finalized' || workflowLabel === 'Reviewable' ? state.label : (workflowLabel || state.label)}
          </span>
          <ChevronRight className="h-4 w-4 text-setu-slate-300 group-hover:text-setu-slate-500 transition-colors" />
        </div>
      </div>

      {/* Row 2: Two-line narrative */}
      <p className="mt-2 line-clamp-2 text-sm font-medium leading-6 text-setu-slate-700">
        {update.field_text}
      </p>

      {/* Row 3: Location + Date */}
      <div className="mt-2 flex items-center gap-4 text-xs text-setu-slate-500">
        <span className="inline-flex items-center gap-1 truncate">
          <MapPin className="h-3 w-3 shrink-0" />
          {update.site_location || 'Location not supplied'}
        </span>
        <span className="inline-flex items-center gap-1 shrink-0 font-mono">
          <Calendar className="h-3 w-3" />
          {update.reported_date || 'No date'}
        </span>
      </div>
    </button>
  );
};
