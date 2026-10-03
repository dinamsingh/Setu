import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertOctagon,
  ArrowRight,
  CalendarClock,
  CircleDashed,
  ClipboardCheck,
  FileQuestion,
  History,
  ListChecks,
  RefreshCw,
} from 'lucide-react';
import { Header } from '../../components/common/Header';
import { Sidebar } from '../../components/common/Sidebar';
import { LoadingSkeleton } from '../../components/common/LoadingSkeleton';
import { useFieldUpdates } from '../../hooks/useFieldUpdates';
import { useScheduleData } from '../../hooks/useScheduleData';
import { useAuditLogs } from '../../hooks/useAuditLogs';
import { useWorkflow } from '../../hooks/useWorkflow';
import {
  computeOperationalCounts,
  describeAuditActivityChange,
  humanizeAuditAction,
} from '../../lib/plannerWorkspace';

export const CommandCenter: React.FC = () => {
  const navigate = useNavigate();
  const {
    updates,
    loading: updatesLoading,
    error: updatesError,
    refetch,
  } = useFieldUpdates();
  const {
    activities,
    activitiesMap,
    disciplines,
    loading: scheduleLoading,
    error: scheduleError,
  } = useScheduleData();
  const { logs, error: auditError } = useAuditLogs();
  const workflow = useWorkflow(() => refetch(true));

  const loading = updatesLoading || scheduleLoading || workflow.loading;
  const counts = useMemo(
    () => computeOperationalCounts(updates, activitiesMap, workflow.rounds, workflow.proposals),
    [updates, activitiesMap, workflow.rounds, workflow.proposals]
  );

  const workflowMetrics = [
    { label: 'Response Received', value: counts.needsTriage, detail: 'Planner triage required', icon: FileQuestion, view: 'triage', tone: 'border-setu-blue bg-blue-50/50 text-setu-blue-dark' },
    { label: 'Awaiting Field Response', value: counts.awaitingResponse, detail: 'Requests available in SETU', icon: CalendarClock, view: 'response', tone: 'border-setu-slate-400 bg-setu-slate-50' },
    { label: 'Reprocessing Evidence', value: counts.reprocessing, detail: 'Current evidence awaiting validation', icon: RefreshCw, view: 'reprocessing', tone: 'border-setu-amber bg-amber-50/60' },
    { label: 'Validating Selected Activity', value: counts.remapPending, detail: 'Manual targets awaiting worker validation', icon: ClipboardCheck, view: 'remap', tone: 'border-setu-blue bg-blue-50/50' },
    { label: 'Ready to Confirm Remap', value: counts.readyToConfirm, detail: 'Validated targets awaiting planner decision', icon: ListChecks, view: 'remap', tone: 'border-setu-teal bg-teal-50/50' },
  ];
  const metrics = [
    {
      label: 'Pending review',
      value: counts.pendingReview,
      detail: 'Pending reports with matching complete',
      icon: ListChecks,
      view: 'unresolved',
      tone: 'border-setu-blue bg-blue-50/50 text-setu-blue-dark',
    },
    {
      label: 'Blocked',
      value: counts.blocked,
      detail: 'Report or selected-target validation block',
      icon: AlertOctagon,
      view: 'blocked',
      tone: 'border-setu-red bg-rose-50/60 text-setu-red-dark',
    },
    {
      label: 'Low confidence',
      value: counts.lowConfidence,
      detail: 'Pending reports in Low confidence tier',
      icon: FileQuestion,
      view: 'low',
      tone: 'border-setu-amber bg-amber-50/60 text-setu-amber-dark',
    },
    {
      label: 'Unmatched',
      value: counts.unmatched,
      detail: 'Matching complete, no valid activity',
      icon: CircleDashed,
      view: 'unmatched',
      tone: 'border-setu-slate-400 bg-setu-slate-50 text-setu-slate-800',
    },
    {
      label: 'Awaiting AI',
      value: counts.awaitingAi,
      detail: 'Submitted and waiting for matching worker',
      icon: RefreshCw,
      view: 'awaiting',
      tone: 'border-setu-teal bg-teal-50/60 text-setu-teal-dark',
    },
  ];

  return (
    <div className="min-h-screen bg-setu-slate-100 flex flex-col">
      <Header currentRole="planner" />

      <div className="flex-1 flex flex-col md:flex-row">
        <Sidebar />

        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 space-y-5 max-w-[90rem]">
          <section className="border-l-4 border-setu-blue bg-white px-5 py-5 sm:px-6 sm:py-6 shadow-xs">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-setu-blue uppercase">
                  Planner workspace
                </p>
                <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-setu-slate-900">
                  Control Room
                </h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-setu-slate-600">
                  Operational view of field evidence waiting for planner control.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="inline-flex items-center gap-2 border border-setu-slate-300 bg-white px-3 py-2 text-xs font-semibold text-setu-slate-700 transition-colors hover:bg-setu-slate-50 focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh data
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/planner/review')}
                  className="inline-flex items-center gap-2 bg-setu-blue px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-setu-blue-dark focus:outline-none focus:ring-2 focus:ring-setu-blue/40"
                >
                  Open review queue
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </section>

          {(updatesError || scheduleError || auditError || workflow.error) && (
            <div className="border-l-4 border-setu-red bg-rose-50 px-4 py-3 text-xs text-rose-900" role="alert">
              <strong>Data unavailable:</strong>{' '}
              {[updatesError, scheduleError, auditError, workflow.error].filter(Boolean).join(' ')}
            </div>
          )}

          {loading ? (
            <LoadingSkeleton rows={3} />
          ) : (
            <>
              <section aria-labelledby="attention-heading" className="space-y-3">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 id="attention-heading" className="text-sm font-bold text-setu-slate-900">
                      Work requiring attention
                    </h2>
                    <p className="text-xs text-setu-slate-500">
                      Counts come from currently visible Supabase records.
                    </p>
                  </div>
                  <p className="text-[11px] text-setu-slate-500">
                    Attention views overlap; do not add these counts together.
                  </p>
                </div>

                <div className="grid grid-cols-1 divide-y divide-setu-slate-200 border border-setu-slate-200 bg-white sm:grid-cols-2 xl:grid-cols-5 xl:divide-x xl:divide-y-0">
                  {workflowMetrics.map(metric => <button key={metric.label} type="button"
                    onClick={() => navigate(`/planner/review?view=${metric.view}`)}
                    className="px-3 py-3 text-left text-xs hover:bg-setu-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-setu-blue/30">
                    <p className="font-semibold text-setu-slate-700">{metric.label}</p>
                    <p className="mt-1 font-mono text-xl font-bold tabular-nums text-setu-navy">{workflow.error ? '—' : metric.value}</p>
                    <p className="mt-1 text-[10px] text-setu-slate-500">{metric.detail}</p>
                  </button>)}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
                  {metrics.map((metric) => {
                    const Icon = metric.icon;
                    return (
                      <button
                        key={metric.label}
                        type="button"
                        onClick={() => navigate(`/planner/review?view=${metric.view}`)}
                        className={`group min-h-36 border-l-4 border-y border-r border-y-setu-slate-200 border-r-setu-slate-200 p-4 text-left transition-colors hover:bg-white focus:outline-none focus:ring-2 focus:ring-setu-blue/30 ${metric.tone}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-xs font-bold text-setu-slate-700">{metric.label}</span>
                          <Icon className="h-4 w-4 shrink-0" />
                        </div>
                        <div className="mt-4 font-mono text-3xl font-extrabold tabular-nums">
                          {workflow.error ? '—' : metric.value}
                        </div>
                        <p className="mt-2 text-[11px] leading-4 text-setu-slate-600">
                          {metric.detail}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
                <div className="border border-setu-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-setu-slate-200 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <History className="h-4 w-4 text-setu-slate-500" />
                      <h2 className="text-sm font-bold text-setu-slate-900">Recent planner actions</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/planner/audit-export')}
                      className="text-xs font-semibold text-setu-blue hover:underline focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
                    >
                      Open audit trail
                    </button>
                  </div>

                  {logs.length === 0 ? (
                    <p className="px-4 py-8 text-center text-xs text-setu-slate-500">
                      No planner actions recorded.
                    </p>
                  ) : (
                    <div className="divide-y divide-setu-slate-100">
                      {logs.slice(0, 6).map((log) => (
                        <div key={log.id} className="grid gap-2 px-4 py-3 text-xs sm:grid-cols-[7rem_1fr_auto] sm:items-center">
                          <span className="font-bold text-setu-slate-700">
                            {humanizeAuditAction(log.action, log.metadata)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-setu-slate-700">
                              {describeAuditActivityChange(
                                log.previous_activity_id,
                                log.new_activity_id
                              )}
                            </p>
                            {log.remarks && (
                              <p className="mt-0.5 truncate text-[11px] text-setu-slate-500">{log.remarks}</p>
                            )}
                          </div>
                          <time className="font-mono text-[10px] text-setu-slate-400">
                            {log.created_at ? log.created_at.slice(0, 16).replace('T', ' ') : '—'}
                          </time>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <aside className="border border-setu-slate-200 bg-setu-navy px-5 py-5 text-white">
                  <p className="text-[11px] font-semibold tracking-[0.12em] text-setu-blue-light uppercase">
                    Schedule baseline
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-4 border-y border-setu-slate-700 py-4">
                    <div>
                      <div className="font-mono text-2xl font-bold tabular-nums">{activities.length}</div>
                      <div className="text-[11px] text-setu-slate-300">Indexed activities</div>
                    </div>
                    <div>
                      <div className="font-mono text-2xl font-bold tabular-nums">{disciplines.length}</div>
                      <div className="text-[11px] text-setu-slate-300">Disciplines</div>
                    </div>
                  </div>
                  <p className="mt-4 text-xs leading-5 text-setu-slate-300">
                    Baseline remains read-only. Review indexed activities or validate a local CSV structure in project setup.
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/planner/onboarding')}
                    className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-white hover:text-setu-blue-light focus:outline-none focus:ring-2 focus:ring-setu-blue-light/40"
                  >
                    <CalendarClock className="h-4 w-4" />
                    Baseline index / CSV preview
                  </button>
                </aside>
              </section>

              <div className="flex items-start gap-2 border border-setu-slate-200 bg-setu-slate-50 px-4 py-3 text-[11px] text-setu-slate-600">
                <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-setu-teal" />
                <p>
                  SETU does not write to Primavera. Only finalized planner mappings are available for controlled export.
                </p>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
};
