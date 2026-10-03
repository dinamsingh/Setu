import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock,
  FileText,
  LockKeyhole,
  LoaderCircle,
  MapPin,
  MoreHorizontal,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  User,
  XCircle,
} from 'lucide-react';
import type { FieldUpdate, ScheduleActivity, ValidationCheckResult } from '../../types';
import { ConfidenceBadge } from '../common/ConfidenceBadge';
import { StatusBadge } from '../common/StatusBadge';
import { parseValidationResults } from '../../lib/utils';
import { isMatchingPending } from '../../lib/plannerWorkspace';

interface ReviewCardProps {
  update: FieldUpdate;
  matchedActivity?: ScheduleActivity;
  plannerName: string;
  onAccept: (update: FieldUpdate, remarks: string) => Promise<void>;
  onReject: (update: FieldUpdate, remarks: string) => Promise<void>;
  onOpenRemap: (update: FieldUpdate) => void;
  onOpenOverride?: (update: FieldUpdate) => void;
  onRequeue?: (update: FieldUpdate, remarks?: string) => Promise<void>;
  workflowLabel?: string;
  decisionContent?: React.ReactNode;
  evidenceHistory?: React.ReactNode;
  manualMapping?: boolean;
}

const supportedChecks = new Set([
  'date_plausibility',
  'candidate_ambiguity',
  'location_consistency',
  'duplicate_detection',
  'reporter_discipline',
  'sequence_plausibility',
]);

function ValidationCheck({ check }: { check: ValidationCheckResult }) {
  const outcome = check.outcome || check.status;
  const Icon =
    outcome === 'fail' ? XCircle : outcome === 'warn' ? AlertTriangle : CheckCircle2;
  const tone =
    outcome === 'fail'
      ? 'border-rose-200 bg-rose-50 text-rose-900'
      : outcome === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-950'
      : 'border-emerald-200 bg-emerald-50 text-emerald-900';

  return (
    <div className={`border px-3 py-2.5 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="text-[11px] font-bold">{check.name}</p>
            <p className="mt-0.5 text-[11px] leading-4 opacity-85">
              {check.message || check.reason || 'No validation message was stored.'}
            </p>
          </div>
        </div>
        <span className="shrink-0 font-mono text-[10px] font-bold uppercase">
          {outcome === 'fail' ? 'BLOCK' : (outcome || 'Unknown').toUpperCase()}
        </span>
      </div>
      {check.evidence && Object.keys(check.evidence).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 border-t border-current/10 pt-2 font-mono text-[9px] opacity-75">
          {Object.entries(check.evidence).map(([key, value]) => (
            <span key={key}>
              {key}: {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const SectionLabel = ({ number, children }: { number: number; children: React.ReactNode }) => (
  <div className="mb-3 flex items-center gap-2 border-b border-setu-slate-200 pb-2">
    <span className="flex h-5 w-5 items-center justify-center bg-setu-navy font-mono text-[10px] font-bold text-white">
      {number}
    </span>
    <h2 className="text-xs font-extrabold uppercase tracking-[0.12em] text-setu-slate-700">
      {children}
    </h2>
  </div>
);

export const ReviewCard: React.FC<ReviewCardProps> = ({
  update,
  matchedActivity,
  plannerName,
  onAccept,
  onReject,
  onOpenRemap,
  onOpenOverride,
  onRequeue,
  workflowLabel,
  decisionContent,
  evidenceHistory,
  manualMapping,
}) => {
  const [pendingAction, setPendingAction] = useState<'accept' | 'reject' | 'requeue' | null>(null);
  const [actionNote, setActionNote] = useState(update.planner_remarks || '');
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const validationRef = useRef<HTMLElement>(null);
  const decisionRef = useRef<HTMLElement>(null);
  const actionNoteRef = useRef<HTMLTextAreaElement>(null);

  const awaiting = !manualMapping && isMatchingPending(update);
  const candidates = Array.isArray(update.candidate_matches) ? update.candidate_matches : [];
  const validationResults = parseValidationResults(update.validation_results).filter((check) =>
    supportedChecks.has(check.check)
  );
  const failedChecks = validationResults.filter(
    (check) => (check.outcome || check.status) === 'fail'
  );
  const remainingChecks = validationResults.filter(
    (check) => (check.outcome || check.status) !== 'fail'
  );
  const isReviewed = ['approved', 'rejected', 'remapped'].includes(
    (update.status || '').toLowerCase()
  );
  const isBlocked = update.validation_status === 'block' && !update.validation_overridden;
  const hasValidMatch = Boolean(update.matched_activity_id && matchedActivity);
  const failedControlCount = Math.max(failedChecks.length, isBlocked ? 1 : 0);

  const runAction = async (action: () => Promise<void>) => {
    setIsSubmitting(true);
    try {
      await action();
    } finally {
      setIsSubmitting(false);
    }
  };

  const activityName = awaiting
    ? 'Matching worker has not completed analysis.'
    : matchedActivity?.activity_name || 'No valid activity is linked.';

  const scrollToValidation = () => {
    validationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    validationRef.current?.focus({ preventScroll: true });
  };

  const openDecisionAction = (action: 'accept' | 'reject' | 'requeue') => {
    setPendingAction(action);
    if (action !== 'accept') setShowMoreActions(true);
    decisionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.requestAnimationFrame(() => actionNoteRef.current?.focus());
  };

  const openMoreActions = () => {
    setShowMoreActions(true);
    decisionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const submitPendingAction = async () => {
    if (pendingAction === 'accept') {
      await onAccept(update, actionNote.trim() || `Approved by ${plannerName}`);
    } else if (pendingAction === 'reject') {
      await onReject(update, actionNote.trim() || `Rejected by ${plannerName}`);
    } else if (pendingAction === 'requeue' && onRequeue) {
      await onRequeue(update, actionNote.trim() || `Re-queued for re-matching by ${plannerName}`);
    }
  };

  const pendingActionCopy =
    pendingAction === 'accept'
      ? {
          heading: 'Accept AI mapping',
          label: 'Acceptance note (optional)',
          placeholder: 'Add planner evidence or decision context',
          confirm: 'Confirm accept',
          tone: 'border-emerald-200 bg-emerald-50/50',
          button: 'bg-setu-green hover:bg-setu-green-dark',
        }
      : pendingAction === 'reject'
      ? {
          heading: 'Reject report',
          label: 'Rejection note (optional)',
          placeholder: 'Record why this report is being rejected',
          confirm: 'Confirm rejection',
          tone: 'border-rose-200 bg-rose-50/50',
          button: 'bg-setu-red hover:bg-setu-red-dark',
        }
      : pendingAction === 'requeue'
      ? {
          heading: 'Requeue matching',
          label: 'Requeue note (optional)',
          placeholder: 'Record why another matching attempt is needed',
          confirm: 'Confirm requeue',
          tone: 'border-amber-200 bg-amber-50/50',
          button: 'bg-setu-amber hover:bg-setu-amber-dark',
        }
      : null;

  const decisionState = isReviewed
    ? {
        label: 'Finalized / read-only',
        detail: 'Planner decision recorded. No further actions are available.',
        icon: LockKeyhole,
        tone: 'border-setu-slate-400 bg-setu-slate-100 text-setu-slate-800',
      }
    : awaiting
    ? {
        label: 'Awaiting AI',
        detail: 'Matching is in progress. Planner actions unlock when analysis completes.',
        icon: LoaderCircle,
        tone: 'border-setu-blue bg-blue-50 text-setu-blue-dark',
      }
    : isBlocked
    ? {
        label: 'Blocked by validation',
        detail: `${failedControlCount} validation control${failedControlCount === 1 ? '' : 's'} failed.`,
        icon: ShieldAlert,
        tone: 'border-setu-red bg-rose-50 text-rose-900',
      }
    : {
        label: 'Ready for decision',
        detail: hasValidMatch
          ? 'Review the evidence, suggestion, and controls before deciding.'
          : 'No valid activity is linked. Remap is required before acceptance.',
        icon: CheckCircle2,
        tone: 'border-setu-green bg-emerald-50 text-emerald-900',
      };
  const DecisionStateIcon = decisionState.icon;

  return (
    <article className="border border-setu-slate-200 bg-white">
      <header className="border-b border-setu-slate-200 bg-setu-slate-50 px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold text-setu-navy">{update.update_id}</span>
              <StatusBadge status={update.status} />
              {isReviewed && (
                <span className="text-[10px] font-bold uppercase text-setu-slate-500">Read-only</span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-setu-slate-500">
              <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{update.source_type}</span>
              <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{update.reported_date || 'No date'}</span>
              <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{update.site_location || 'No location'}</span>
              <span className="flex items-center gap-1"><User className="h-3 w-3" />{update.reported_by || 'Reporter not supplied'}</span>
            </div>
          </div>
          {update.validation_overridden && (
            <span className="inline-flex items-center gap-1.5 border border-purple-200 bg-purple-50 px-2 py-1 text-[11px] font-bold text-purple-800">
              <Unlock className="h-3.5 w-3.5" /> Governed override recorded
            </span>
          )}
        </div>
      </header>

      <div
        data-testid="decision-status-bar"
        className={`sticky top-16 z-20 border-b border-l-4 px-4 py-2.5 shadow-sm sm:px-5 ${decisionState.tone}`}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <DecisionStateIcon
              className={`mt-0.5 h-4 w-4 shrink-0 ${awaiting ? 'animate-spin' : ''}`}
            />
            <div className="min-w-0">
              <p data-testid="decision-state" className="text-xs font-extrabold">
                {workflowLabel || decisionState.label}
              </p>
              <p className="text-[10px] opacity-80">{decisionContent
                ? 'Review the current workflow below before recording a decision.' : decisionState.detail}</p>
            </div>
          </div>

          {!decisionContent && !isReviewed && !awaiting && (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {isBlocked ? (
                <button
                  type="button"
                  onClick={scrollToValidation}
                  className="border border-current/30 bg-white px-2.5 py-1.5 text-[11px] font-bold transition-colors hover:bg-white/70 focus:outline-none focus:ring-2 focus:ring-current/30"
                >
                  Review failed checks
                </button>
              ) : (
                <>
                  {hasValidMatch && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => openDecisionAction('accept')}
                      className="bg-setu-green px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-setu-green-dark focus:outline-none focus:ring-2 focus:ring-setu-green/40 disabled:opacity-50"
                    >
                      Accept
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => onOpenRemap(update)}
                    className="border border-setu-blue bg-white px-2.5 py-1.5 text-[11px] font-bold text-setu-blue hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-setu-blue/30 disabled:opacity-50"
                  >
                    Remap
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={openMoreActions}
                className="inline-flex items-center gap-1 border border-current/30 bg-white px-2.5 py-1.5 text-[11px] font-bold hover:bg-white/70 focus:outline-none focus:ring-2 focus:ring-current/30"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
                More actions
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="divide-y divide-setu-slate-200">
        <section className="px-4 py-5 sm:px-5" aria-labelledby={`evidence-${update.id}`}>
          <SectionLabel number={1}>Field evidence</SectionLabel>
          <blockquote className="border-l-4 border-setu-slate-500 bg-setu-slate-50 px-4 py-3 text-sm font-medium leading-6 text-setu-slate-900">
            “{update.field_text}”
          </blockquote>
          {evidenceHistory}
        </section>

        <section className="px-4 py-5 sm:px-5" aria-labelledby={`suggestion-${update.id}`}>
          <SectionLabel number={2}>AI suggestion</SectionLabel>
          {workflowLabel === 'Reprocessing Evidence' && <p className="mb-2 text-xs text-amber-900">Previous suggestion shown for context only. Current clarified evidence is being processed.</p>}
          <div className="flex flex-col gap-3 border border-setu-slate-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {awaiting ? (
                  <span className="bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-800">Awaiting matching</span>
                ) : update.matched_activity_id ? (
                  <span className="bg-setu-navy px-2 py-0.5 font-mono text-[10px] font-bold text-white">{update.matched_activity_id}</span>
                ) : (
                  <span className="bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-900">Unmatched</span>
                )}
                {matchedActivity && (
                  <span className="text-[11px] font-semibold text-setu-teal">
                    {matchedActivity.discipline} · WBS {matchedActivity.wbs_code}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-sm font-bold text-setu-slate-900">{activityName}</p>
            </div>
            <div className="shrink-0">
              {manualMapping || update.status === 'remapped' ? <p className="text-xs font-bold text-setu-slate-600">Planner-selected activity</p>
                : <ConfidenceBadge level={update.confidence_level} score={update.confidence_score} />}
            </div>
          </div>

          {!awaiting && (
            <details className="mt-3 border border-setu-slate-200 bg-setu-slate-50">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-bold text-setu-blue focus:outline-none focus:ring-2 focus:ring-inset focus:ring-setu-blue/30">
                <span>Why suggested?</span>
                <ChevronDown className="h-4 w-4" />
              </summary>
              <div className="space-y-3 border-t border-setu-slate-200 px-3 py-3 text-xs">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="border border-setu-slate-200 bg-white px-3 py-2">
                    <span className="text-[10px] text-setu-slate-500">Matching layer</span>
                    <p className="mt-0.5 font-mono font-bold text-setu-slate-800">{update.matched_layer || 'Unmatched'}</p>
                  </div>
                  <div className="border border-setu-slate-200 bg-white px-3 py-2">
                    <span className="text-[10px] text-setu-slate-500">Candidate count retained</span>
                    <p className="mt-0.5 font-mono font-bold text-setu-slate-800">{candidates.length}</p>
                  </div>
                </div>

                {update.expanded_text && update.expanded_text !== update.field_text && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-setu-slate-500">Normalized field text</p>
                    <p className="mt-1 border-l-2 border-setu-teal pl-3 font-mono text-[11px] leading-5 text-setu-slate-700">{update.expanded_text}</p>
                  </div>
                )}

                {candidates.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-left text-[11px]">
                      <thead className="border-b border-setu-slate-200 text-setu-slate-500">
                        <tr>
                          <th className="px-2 py-1.5 font-bold">Rank</th>
                          <th className="px-2 py-1.5 font-bold">Activity</th>
                          <th className="px-2 py-1.5 font-bold">Discipline</th>
                          <th className="px-2 py-1.5 font-bold">Score</th>
                          <th className="px-2 py-1.5 font-bold">Rationale</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-setu-slate-100">
                        {candidates.slice(0, 3).map((candidate, index) => {
                          const score = candidate.combined_score ?? candidate.final_score ?? candidate.score ?? 0;
                          return (
                            <tr key={`${candidate.activity_id}-${index}`}>
                              <td className="px-2 py-2 font-mono">#{index + 1}</td>
                              <td className="px-2 py-2">
                                <p className="font-mono font-bold text-setu-navy">{candidate.activity_id}</p>
                                <p className="max-w-xs truncate text-setu-slate-700">{candidate.activity_name}</p>
                              </td>
                              <td className="px-2 py-2 text-setu-teal">{candidate.discipline || '—'}</td>
                              <td className="px-2 py-2 font-mono font-bold">{(Number(score) * 100).toFixed(1)}%</td>
                              <td className="px-2 py-2 text-setu-slate-500">{candidate.rationale || 'Ensemble score'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </details>
          )}
        </section>

        <section
          ref={validationRef}
          tabIndex={-1}
          className="scroll-mt-32 px-4 py-5 focus:outline-none sm:px-5"
          aria-labelledby={`validation-${update.id}`}
        >
          <SectionLabel number={3}>Project-controls validation</SectionLabel>

          {isBlocked ? (
            <div className="space-y-3">
              <div className="border-l-4 border-setu-red bg-rose-50 px-4 py-3 text-xs text-rose-900">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-bold">Blocked by project-controls validation</p>
                    <p className="mt-1 leading-5 text-rose-800">
                      {failedControlCount} validation control{failedControlCount === 1 ? '' : 's'} failed. Review failed checks before taking an exceptional action.
                    </p>
                  </div>
                </div>
              </div>
              {failedChecks.length > 0 ? (
                <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                  {failedChecks.map((check) => <ValidationCheck key={check.check} check={check} />)}
                </div>
              ) : (
                <p className="border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                  Validation is blocked, but detailed failed checks were not stored.
                </p>
              )}
              {remainingChecks.length > 0 && (
                <details className="border border-setu-slate-200">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-setu-slate-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-setu-blue/30">
                    Review remaining checks ({remainingChecks.length})
                  </summary>
                  <div className="grid grid-cols-1 gap-2 border-t border-setu-slate-200 p-3 xl:grid-cols-2">
                    {remainingChecks.map((check) => <ValidationCheck key={check.check} check={check} />)}
                  </div>
                </details>
              )}
            </div>
          ) : update.validation_status ? (
            <div>
              <div className={`flex items-start gap-2 border-l-4 px-4 py-3 text-xs ${
                update.validation_overridden
                  ? 'border-purple-500 bg-purple-50 text-purple-900'
                  : update.validation_status === 'warn'
                  ? 'border-setu-amber bg-amber-50 text-amber-950'
                  : 'border-setu-green bg-emerald-50 text-emerald-900'
              }`}>
                {update.validation_overridden ? <Unlock className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />}
                <div>
                  <p className="font-bold">
                    {update.validation_overridden
                      ? 'Validation block overridden under planner governance'
                      : update.validation_status === 'warn'
                      ? 'Validation completed with warnings'
                      : 'Validation checks passed'}
                  </p>
                  {update.validation_overridden && update.override_reason && (
                    <p className="mt-1 leading-5">{update.override_reason}</p>
                  )}
                </div>
              </div>
              {validationResults.length > 0 && (
                <details className="mt-3 border border-setu-slate-200">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-setu-slate-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-setu-blue/30">
                    Review all validation checks ({validationResults.length})
                  </summary>
                  <div className="grid grid-cols-1 gap-2 border-t border-setu-slate-200 p-3 xl:grid-cols-2">
                    {validationResults.map((check) => <ValidationCheck key={check.check} check={check} />)}
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 border border-setu-slate-200 bg-setu-slate-50 px-3 py-3 text-xs text-setu-slate-600">
              <Clock className="h-4 w-4" />
              Validation results are not available yet.
            </div>
          )}
        </section>

        <section
          ref={decisionRef}
          className="scroll-mt-32 px-4 py-5 sm:px-5"
          aria-labelledby={`decision-${update.id}`}
        >
          <SectionLabel number={4}>Planner decision</SectionLabel>

          {decisionContent || (isReviewed ? (
            <div className="border-l-4 border-setu-slate-500 bg-setu-slate-50 px-4 py-3 text-xs text-setu-slate-700">
              <p className="font-bold">Finalized planner decision. This report is read-only.</p>
              {update.planner_remarks && <p className="mt-1 leading-5">{update.planner_remarks}</p>}
            </div>
          ) : awaiting ? (
            <div className="flex items-start gap-3 border-l-4 border-setu-blue bg-blue-50 px-4 py-3 text-xs text-setu-blue-dark">
              <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              <div>
                <p className="font-bold">Matching in progress</p>
                <p className="mt-1 leading-5">
                  Planner decision controls are unavailable until AI matching and validation complete.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {!hasValidMatch && !awaiting && !isBlocked && (
                <div className="flex items-start gap-2 border-l-4 border-setu-amber bg-amber-50 px-4 py-3 text-xs text-amber-950">
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>No valid schedule activity is linked. Remap this report or use an existing terminal action.</p>
                </div>
              )}

              {isBlocked ? (
                <div className="border border-rose-200 bg-rose-50/50 px-4 py-4">
                  <p className="text-xs font-bold text-rose-900">Normal decision controls are locked</p>
                  <p className="mt-1 text-[11px] leading-5 text-rose-800">
                    {failedControlCount} validation control{failedControlCount === 1 ? '' : 's'} failed. Review failed checks before taking an exceptional action.
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={scrollToValidation}
                      className="border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-900 transition-colors hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-400/40"
                    >
                      Review failed checks
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => onOpenOverride?.(update)}
                      className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold text-rose-800 underline decoration-rose-300 underline-offset-4 hover:text-rose-950 focus:outline-none focus:ring-2 focus:ring-rose-400/40 disabled:opacity-50"
                    >
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Exceptional: override validation
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {hasValidMatch && !awaiting && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => openDecisionAction('accept')}
                      className="inline-flex items-center gap-2 bg-setu-green px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-setu-green-dark focus:outline-none focus:ring-2 focus:ring-setu-green/40 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Accept mapping
                    </button>
                  )}
                  {!awaiting && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => onOpenRemap(update)}
                      className="inline-flex items-center gap-2 border border-setu-blue bg-white px-4 py-2.5 text-xs font-bold text-setu-blue transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-setu-blue/30 disabled:opacity-50"
                    >
                      <ArrowRightLeft className="h-4 w-4" />
                      Remap activity
                    </button>
                  )}
                </div>
              )}

              {pendingActionCopy && (
                <div className={`border px-4 py-3 ${pendingActionCopy.tone}`}>
                  <p className="text-xs font-bold text-setu-slate-900">{pendingActionCopy.heading}</p>
                  <label
                    htmlFor={`action-note-${update.id}`}
                    className="mt-2 block text-[11px] font-bold text-setu-slate-700"
                  >
                    {pendingActionCopy.label}
                  </label>
                  <textarea
                    ref={actionNoteRef}
                    id={`action-note-${update.id}`}
                    rows={2}
                    value={actionNote}
                    onChange={(event) => setActionNote(event.target.value)}
                    placeholder={pendingActionCopy.placeholder}
                    className="mt-1 w-full border border-setu-slate-300 bg-white px-3 py-2 text-xs leading-5 focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
                  />
                  <p className="mt-1 text-[10px] text-setu-slate-500">
                    The note is saved as the existing planner remarks when this action completes.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => runAction(submitPendingAction)}
                      className={`px-3 py-2 text-xs font-bold text-white focus:outline-none focus:ring-2 focus:ring-setu-blue/30 disabled:opacity-50 ${pendingActionCopy.button}`}
                    >
                      {isSubmitting ? 'Submitting…' : pendingActionCopy.confirm}
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setPendingAction(null)}
                      className="border border-setu-slate-300 bg-white px-3 py-2 text-xs font-bold text-setu-slate-700 hover:bg-setu-slate-50 focus:outline-none focus:ring-2 focus:ring-setu-blue/30 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="border-t border-setu-slate-200 pt-3">
                <button
                  type="button"
                  aria-expanded={showMoreActions}
                  onClick={() => setShowMoreActions((current) => !current)}
                  className="inline-flex items-center gap-2 border border-setu-slate-300 bg-white px-3 py-2 text-xs font-bold text-setu-slate-700 hover:border-setu-slate-400 hover:bg-setu-slate-50 focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
                >
                  <MoreHorizontal className="h-4 w-4" />
                  More actions
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMoreActions ? 'rotate-180' : ''}`} />
                </button>
                {showMoreActions && (
                  <div className="mt-3 border-l-2 border-setu-slate-300 bg-setu-slate-50 px-3 py-3">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-setu-slate-500">
                      Technical or terminal options
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                    {onRequeue && (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => openDecisionAction('requeue')}
                        className="inline-flex items-center gap-1.5 border border-setu-amber bg-white px-3 py-2 text-xs font-bold text-setu-amber-dark hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-setu-amber/30 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Requeue matching
                    </button>
                  )}
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => openDecisionAction('reject')}
                      className="inline-flex items-center gap-1.5 border border-setu-red bg-white px-3 py-2 text-xs font-bold text-setu-red-dark hover:bg-rose-50 focus:outline-none focus:ring-2 focus:ring-setu-red/30 disabled:opacity-50"
                    title="Uses the existing terminal rejected status"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                      Reject report (terminal)
                    </button>
                    </div>
                    <p className="mt-2 text-[10px] leading-4 text-setu-slate-500">
                      Requeue restarts matching. Reject records the existing terminal rejected status.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>
      </div>
    </article>
  );
};
