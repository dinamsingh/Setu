import React, { useState } from 'react';
import { 
  ChevronDown, 
  ChevronUp, 
  CheckCircle2, 
  XCircle, 
  ArrowRightLeft, 
  MapPin, 
  Calendar, 
  User, 
  FileText, 
  Sparkles
} from 'lucide-react';
import type { FieldUpdate, ScheduleActivity } from '../../types';
import { ConfidenceBadge } from '../common/ConfidenceBadge';
import { StatusBadge } from '../common/StatusBadge';

interface ReviewCardProps {
  update: FieldUpdate;
  matchedActivity?: ScheduleActivity;
  plannerName: string;
  onAccept: (update: FieldUpdate, remarks: string) => Promise<void>;
  onReject: (update: FieldUpdate, remarks: string) => Promise<void>;
  onOpenRemap: (update: FieldUpdate) => void;
}

export const ReviewCard: React.FC<ReviewCardProps> = ({
  update,
  matchedActivity,
  plannerName,
  onAccept,
  onReject,
  onOpenRemap,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [remarks, setRemarks] = useState(update.planner_remarks || '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isAwaiting = !update.confidence_level || update.confidence_level.toLowerCase() === 'pending';
  const actId = update.matched_activity_id;
  const actName = isAwaiting
    ? 'Matching in progress — awaiting AI schedule analysis...'
    : matchedActivity
    ? matchedActivity.activity_name
    : 'No Auto-Matched Activity (Requires Manual Linking)';
  const discipline = isAwaiting ? 'Awaiting Worker' : matchedActivity ? matchedActivity.discipline : 'General / Unassigned';
  const wbs = matchedActivity?.wbs_code || '—';

  const candidates = Array.isArray(update.candidate_matches) ? update.candidate_matches : [];

  const handleAccept = async () => {
    setIsSubmitting(true);
    try {
      await onAccept(update, remarks || `Approved by ${plannerName}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    setIsSubmitting(true);
    try {
      await onReject(update, remarks || `Rejected by ${plannerName}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-setu-slate-200 shadow-xs hover:border-setu-slate-300 transition-all overflow-hidden">
      {/* Card Header */}
      <div className="p-4 sm:p-5 border-b border-setu-slate-100 bg-setu-slate-50/50">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center space-x-2.5">
            <span className="font-mono font-bold text-sm text-setu-navy bg-white px-2 py-1 rounded border border-setu-slate-200">
              {update.update_id}
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-setu-slate-100 text-setu-slate-600 font-medium capitalize border border-setu-slate-200 flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {update.source_type}
            </span>
            <span className="text-xs text-setu-slate-500 flex items-center gap-1">
              <Calendar className="w-3 h-3 text-setu-slate-400" />
              {update.reported_date || 'Today'}
            </span>
            {update.site_location && (
              <span className="text-xs text-setu-slate-500 hidden sm:flex items-center gap-1">
                <MapPin className="w-3 h-3 text-setu-slate-400" />
                {update.site_location}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <ConfidenceBadge level={update.confidence_level} score={update.confidence_score} />
            <StatusBadge status={update.status} />
          </div>
        </div>
      </div>

      {/* Card Body */}
      <div className="p-4 sm:p-5 space-y-4">
        {/* Raw Field Evidence Narrative */}
        <div className="rounded-lg bg-setu-slate-900 text-white p-3.5 sm:p-4 border border-setu-slate-800">
          <div className="flex items-center justify-between text-xs text-setu-slate-400 font-medium mb-1.5">
            <span className="uppercase tracking-wider text-[10px] font-bold text-setu-blue-light">
              Raw Field Evidence Narrative
            </span>
            {update.reported_by && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {update.reported_by}
              </span>
            )}
          </div>
          <p className="text-sm font-medium leading-relaxed text-setu-slate-100 italic">
            "{update.field_text}"
          </p>
        </div>

        {/* Suggested Target Activity Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-setu-slate-50 border border-setu-slate-200">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-setu-slate-500">
              <span>Target Schedule Activity:</span>
              {isAwaiting ? (
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[11px]">
                  AWAITING MATCHING
                </span>
              ) : actId ? (
                <span className="font-mono px-1.5 py-0.5 rounded bg-setu-blue text-white font-bold text-[11px]">
                  {actId}
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold text-[11px]">
                  UNLINKED
                </span>
              )}
              {!isAwaiting && (
                <>
                  <span className="text-setu-teal font-medium">[{discipline}]</span>
                  <span className="text-setu-slate-400 font-mono text-[11px]">WBS: {wbs}</span>
                </>
              )}
            </div>
            <p className="text-sm font-bold text-setu-slate-900 truncate mt-0.5">
              {actName}
            </p>
          </div>
        </div>

        {/* Explainability Accordion Button */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-between w-full py-1.5 px-2 rounded text-xs font-semibold text-setu-blue hover:text-setu-blue-dark hover:bg-blue-50/50 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-setu-amber" />
            <span>Why this match? (Explainable AI Audit)</span>
          </span>
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {/* Explainability Details */}
        {isExpanded && (
          <div className="p-4 rounded-lg bg-setu-slate-50 border border-setu-slate-200 space-y-3 text-xs animate-fadeIn">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pb-3 border-b border-setu-slate-200">
              <div>
                <span className="text-setu-slate-500 block text-[11px]">Match Confidence Score</span>
                <span className="text-base font-extrabold font-mono text-setu-navy">
                  {isAwaiting ? 'Awaiting matching' : update.confidence_score ? (Number(update.confidence_score) * 100).toFixed(1) + '%' : 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-setu-slate-500 block text-[11px]">Matched Pipeline Layer</span>
                <span className="text-sm font-bold capitalize text-setu-teal">
                  {isAwaiting ? 'Pending worker' : update.matched_layer || 'Unmatched'}
                </span>
              </div>
              <div>
                <span className="text-setu-slate-500 block text-[11px]">Routing Classification</span>
                <span className="text-sm font-bold text-setu-slate-800">
                  {isAwaiting ? 'Awaiting Matching' : `${update.confidence_level} Tier`}
                </span>
              </div>
            </div>

            {update.expanded_text && update.expanded_text !== update.field_text && (
              <div>
                <span className="font-semibold text-setu-slate-700 block mb-1">
                  Domain Jargon Normalization:
                </span>
                <p className="p-2 rounded bg-white border border-setu-slate-200 text-setu-slate-800 font-mono text-[11px]">
                  {update.expanded_text}
                </p>
              </div>
            )}

            {candidates.length > 0 && (
              <div>
                <span className="font-semibold text-setu-slate-700 block mb-1.5">
                  Top 3 Candidate Activities Evaluated:
                </span>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="border-b border-setu-slate-200 text-setu-slate-500">
                        <th className="py-1 px-2 font-bold">Rank</th>
                        <th className="py-1 px-2 font-bold">Activity ID</th>
                        <th className="py-1 px-2 font-bold">Activity Name</th>
                        <th className="py-1 px-2 font-bold">Discipline</th>
                        <th className="py-1 px-2 font-bold">Confidence</th>
                        <th className="py-1 px-2 font-bold">Matching Rationale</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-setu-slate-100">
                      {candidates.slice(0, 3).map((c, idx) => {
                        const candScore = c.combined_score ?? c.final_score ?? c.score ?? 0;
                        return (
                          <tr key={idx} className="hover:bg-white/60">
                            <td className="py-1.5 px-2 font-bold text-setu-slate-600">#{idx + 1}</td>
                            <td className="py-1.5 px-2 font-mono font-bold text-setu-navy">{c.activity_id}</td>
                            <td className="py-1.5 px-2 text-setu-slate-800 font-medium">{c.activity_name}</td>
                            <td className="py-1.5 px-2 text-setu-teal">{c.discipline || '—'}</td>
                            <td className="py-1.5 px-2 font-mono font-bold">{(Number(candScore) * 100).toFixed(1)}%</td>
                            <td className="py-1.5 px-2 text-setu-slate-500">{c.rationale || 'Score ensemble'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Planner Decision Control Strip */}
        <div className="pt-3 border-t border-setu-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Planner remarks or DPR validation notes..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="w-full text-xs px-3 py-2 rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-setu-blue focus:border-setu-blue placeholder:text-setu-slate-400"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isSubmitting || isAwaiting}
              onClick={handleAccept}
              title={isAwaiting ? 'Cannot approve before AI matching has run' : undefined}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-setu-green hover:bg-setu-green-dark text-white shadow-xs transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Approve Link</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => onOpenRemap(update)}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-colors disabled:opacity-50"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Remap Activity</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleReject}
              className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-setu-red hover:bg-setu-red-dark text-white shadow-xs transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Reject</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
