import './PlannerV2.css';
import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Header } from '../../components/common/Header';
import { Sidebar } from '../../components/common/Sidebar';
import { ReviewCard } from '../../components/planner/ReviewCard';
import { ReviewQueueItem } from '../../components/planner/ReviewQueueItem';
import { RemapModal } from '../../components/planner/RemapModal';
import { OverrideModal } from '../../components/planner/OverrideModal';
import { EmptyState } from '../../components/common/EmptyState';
import { LoadingSkeleton } from '../../components/common/LoadingSkeleton';
import { useFieldUpdates } from '../../hooks/useFieldUpdates';
import { useScheduleData } from '../../hooks/useScheduleData';
import { useWorkflow } from '../../hooks/useWorkflow';
import { useProgressEvents } from '../../hooks/useProgressEvents';
import { WorkflowActions, ClarificationHistory } from '../../components/planner/WorkflowActions';
import { canAccept, workflowState } from '../../lib/workflow';
import { useAuth } from '../../lib/AuthContext';
import {
  actionErrorMessage,
  computeOperationalCounts,
  filterAndSortPlannerUpdates,
  type ReviewView,
} from '../../lib/plannerWorkspace';
import type { FieldUpdate } from '../../types';

type Toast = { message: string; tone: 'success' | 'error' };

const reviewViews: ReviewView[] = [
  'unresolved',
  'blocked',
  'unmatched',
  'low',
  'awaiting',
  'response', 'triage', 'reprocessing', 'remap',
  'history',
  'all',
];

export const ReviewQueue: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    updates,
    loading: updatesLoading,
    error: updatesError,
    refetch,
    submitPlannerDecision,
    requeueForRematching,
    overrideValidation,
  } = useFieldUpdates();
  const {
    activities,
    activitiesMap,
    disciplines,
    loading: scheduleLoading,
    error: scheduleError,
  } = useScheduleData();
  const { role } = useAuth();
  const workflow = useWorkflow(() => refetch(true));

  const plannerName = role === 'admin' ? 'Authenticated Administrator' : 'Authenticated Planner';
  /* URL-backed selection: ?selected=<uuid> */
  const selectedId = searchParams.get('selected') || null;
  const [completedId, setCompletedId] = useState<string | null>(null);
  const [remapTarget, setRemapTarget] = useState<FieldUpdate | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<FieldUpdate | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const requestedView = searchParams.get('view') as ReviewView | null;
  const view = requestedView && reviewViews.includes(requestedView) ? requestedView : 'unresolved';
  const confidence = searchParams.get('confidence') || 'All';
  const status = searchParams.get('status') || 'All';
  const discipline = searchParams.get('discipline') || 'All';
  const validation = searchParams.get('validation') || 'All';
  const search = searchParams.get('q') || '';

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete('selected');
    const isDefaultView = key === 'view' && value === 'unresolved';
    if (!value || value === 'All' || isDefaultView) next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  };

  const selectReport = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('selected', id);
    setSearchParams(next);
  };

  const backToQueue = () => {
    setCompletedId(null);
    const next = new URLSearchParams(searchParams);
    next.delete('selected');
    setSearchParams(next);
  };

  const filteredUpdates = useMemo(
    () =>
      filterAndSortPlannerUpdates(updates, activitiesMap, {
        view,
        confidence,
        status,
        discipline,
        validation,
        search,
      }, workflow.rounds, workflow.proposals),
    [updates, activitiesMap, view, confidence, status, discipline, validation, search, workflow.rounds, workflow.proposals]
  );

  const counts = useMemo(
    () => computeOperationalCounts(updates, activitiesMap, workflow.rounds, workflow.proposals),
    [updates, activitiesMap, workflow.rounds, workflow.proposals]
  );
  const pendingCount = updates.filter((update) => update.status === 'pending').length;
  const historyCount = updates.filter((update) => update.status !== 'pending').length;

  /* Resolve selected update — support completed decisions that leave the queue */
  const completedSelection = updates.find(update => update.id === (completedId || selectedId) && update.status !== 'pending');
  const selectedUpdate =
    completedSelection || filteredUpdates.find((update) => update.id === selectedId) || null;
  const selectedActivity = selectedUpdate?.matched_activity_id
    ? activitiesMap.get(selectedUpdate.matched_activity_id)
    : undefined;
  const progress = useProgressEvents(selectedUpdate, refetch);

  /* Navigation: previous / next in filtered queue */
  const selectedIndex = selectedUpdate ? filteredUpdates.findIndex(u => u.id === selectedUpdate.id) : -1;
  const prevUpdate = selectedIndex > 0 ? filteredUpdates[selectedIndex - 1] : null;
  const nextUpdate = selectedIndex >= 0 && selectedIndex < filteredUpdates.length - 1 ? filteredUpdates[selectedIndex + 1] : null;

  const showToast = (message: string, tone: Toast['tone'] = 'success') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 5000);
  };

  const handleAccept = async (update: FieldUpdate, remarks: string) => {
    if (!canAccept(update, workflow.rounds, workflow.proposals)) {
      showToast('Current validation and an idle workflow are required before acceptance.', 'error');
      return;
    }
    if (update.status !== 'pending') {
      showToast(`Update ${update.update_id} is finalized and read-only.`, 'error');
      return;
    }
    if (update.validation_status === 'block' && !update.validation_overridden) {
      showToast('A documented validation override is required before approval.', 'error');
      return;
    }
    if (!update.matched_activity_id || !activitiesMap.has(update.matched_activity_id)) {
      showToast('Select a valid schedule activity through Remap before approval.', 'error');
      return;
    }

    const result = await submitPlannerDecision({
      updateUuid: update.id,
      action: 'accept',
      expectedWorkflowRevision: update.workflow_revision ?? 0,
      targetActivityId: null,
      remarks,
    });
    const error = actionErrorMessage(result, 'Failed to approve mapping.');
    if (error) showToast(error, 'error');
    else showToast(`Update ${update.update_id} approved and recorded in the audit trail.`);
  };

  const handleReject = async (update: FieldUpdate, remarks: string) => {
    if (update.status !== 'pending') {
      showToast(`Update ${update.update_id} is finalized and read-only.`, 'error');
      return;
    }
    const result = await submitPlannerDecision({
      updateUuid: update.id,
      action: 'reject',
      targetActivityId: null,
      remarks,
    });
    const error = actionErrorMessage(result, 'Failed to reject report.');
    if (error) showToast(error, 'error');
    else showToast(`Update ${update.update_id} moved to terminal rejected status.`);
  };

  const handleConfirmRemap = async (
    update: FieldUpdate,
    newActivityId: string,
    _remarks: string
  ) => {
    if (update.status !== 'pending') {
      showToast(`Update ${update.update_id} is finalized and read-only.`, 'error');
      return false;
    }
    if (!activitiesMap.has(newActivityId)) {
      showToast('Choose a valid schedule activity before confirming the remap.', 'error');
      return false;
    }
    if (newActivityId === update.matched_activity_id) {
      showToast('Choose a different activity. The current activity is not a remap.', 'error');
      return false;
    }

    const result = await workflow.act('propose_field_update_remap', {
      p_field_update_id: update.id,
      p_target_activity_id: newActivityId,
      p_expected_workflow_revision: update.workflow_revision ?? 0,
    });
    const error = actionErrorMessage(result, 'Failed to remap report.');
    if (error) {
      showToast(error, 'error');
      return false;
    }
    showToast(`Selected target ${newActivityId} submitted for validation. Confirm Remap after review.`);
    return true;
  };

  const handleRequeue = async (update: FieldUpdate, remarks?: string) => {
    const result = await requeueForRematching({ updateUuid: update.id, remarks, expectedWorkflowRevision: update.workflow_revision ?? 0 });
    const error = actionErrorMessage(result, 'Failed to requeue report.');
    if (error) showToast(error, 'error');
    else showToast(`Report ${update.update_id} requeued for the matching worker.`);
  };

  const handleConfirmOverride = async (update: FieldUpdate, reason: string) => {
    const result = await overrideValidation({ updateUuid: update.id, reason, expectedWorkflowRevision: update.workflow_revision ?? 0 });
    const error = actionErrorMessage(result, 'Failed to record validation override.');
    if (error) {
      showToast(error, 'error');
      return false;
    }
    showToast(`Validation override recorded for ${update.update_id}.`);
    return true;
  };

  const clearFilters = () => { setSearchParams(new URLSearchParams()); };
  const reviewNext = () => {
    setCompletedId(null);
    if (nextUpdate) {
      selectReport(nextUpdate.id);
    } else {
      backToQueue();
    }
  };
  const loading = updatesLoading || scheduleLoading;
  const hasSecondaryFilters =
    confidence !== 'All' ||
    status !== 'All' ||
    discipline !== 'All' ||
    validation !== 'All' ||
    Boolean(search);

  /* Determine mode: Detail if we have a selected report */
  const isDetailMode = Boolean(selectedId) && (Boolean(selectedUpdate) || Boolean(completedSelection));

  /* Advanced filter view counts for compact filter disclosure */
  const advancedViews: Array<{ value: ReviewView; label: string; count: number | null }> = [
    { value: 'blocked', label: 'Blocked', count: workflow.loading || workflow.error ? null : counts.blocked },
    { value: 'unmatched', label: 'Unmatched', count: counts.unmatched },
    { value: 'low', label: 'Low confidence', count: counts.lowConfidence },
    { value: 'awaiting', label: 'Awaiting AI', count: counts.awaitingAi },
    { value: 'triage', label: 'Response received', count: workflow.loading || workflow.error ? null : counts.needsTriage },
    { value: 'response', label: 'Awaiting field response', count: workflow.loading || workflow.error ? null : counts.awaitingResponse },
    { value: 'reprocessing', label: 'Reprocessing', count: workflow.loading || workflow.error ? null : counts.reprocessing },
    { value: 'remap', label: 'Remap proposals', count: workflow.loading || workflow.error ? null : counts.remapPending + counts.readyToConfirm },
  ];

  return (
    <div className="setu-planner-v2 setu-planner-v2--review min-h-screen bg-setu-slate-100 flex flex-col">
      <Header currentRole="planner" />
      <div className="flex-1 flex flex-col md:flex-row">
        <Sidebar />

        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 space-y-5 max-w-[100rem]">
          {toast && (
            <div
              role="alert"
              className={`fixed bottom-5 right-5 z-50 flex max-w-md items-start gap-2.5 border px-4 py-3 text-xs font-semibold shadow-xl rounded ${
                toast.tone === 'error'
                  ? 'border-rose-300 bg-rose-950 text-white'
                  : 'border-setu-slate-700 bg-setu-navy text-white'
              }`}
            >
              {toast.tone === 'error' ? (
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-300" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              )}
              <span>{toast.message}</span>
            </div>
          )}

          {(updatesError || scheduleError || workflow.error) && (
            <div className="border-l-4 border-setu-red bg-rose-50 px-4 py-3 text-xs text-rose-900 rounded" role="alert">
              <strong>Queue data unavailable:</strong> {[updatesError, scheduleError, workflow.error].filter(Boolean).join(' ')}
            </div>
          )}

          {/* ═══════════════════════════════════════════════
              MODE 2 — DETAIL MODE
              ═══════════════════════════════════════════════ */}
          {isDetailMode && selectedUpdate ? (
            <div data-testid="detail-mode">
              {/* Detail header */}
              <div className="flex items-center justify-between mb-5">
                <button
                  type="button"
                  onClick={backToQueue}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-setu-blue hover:text-setu-navy transition-colors focus:outline-none focus:ring-2 focus:ring-setu-blue/30 rounded"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Review Queue
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={!prevUpdate}
                    onClick={() => prevUpdate && selectReport(prevUpdate.id)}
                    aria-label="Previous report"
                    className="p-1.5 border border-setu-slate-200 bg-white text-setu-slate-600 hover:bg-setu-slate-50 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-setu-blue/30 rounded"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={!nextUpdate}
                    onClick={() => nextUpdate && selectReport(nextUpdate.id)}
                    aria-label="Next report"
                    className="p-1.5 border border-setu-slate-200 bg-white text-setu-slate-600 hover:bg-setu-slate-50 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-setu-blue/30 rounded"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Full-width ReviewCard */}
              <ReviewCard
                key={selectedUpdate.id}
                update={selectedUpdate}
                matchedActivity={selectedActivity}
                plannerName={plannerName}
                progressEvents={progress.events}
                progressEventsLoading={progress.loading}
                progressEventsError={progress.error}
                onRetryProgressEvents={progress.refetch}
                rounds={workflow.rounds}
                proposals={workflow.proposals}
                workflowAvailable={!workflow.loading && !workflow.error}
                onReviewNext={reviewNext}
                onBackToQueue={backToQueue}
                onAccept={handleAccept}
                onReject={handleReject}
                onOpenRemap={setRemapTarget}
                onOpenOverride={setOverrideTarget}
                onRequeue={handleRequeue}
                workflowLabel={workflowState(selectedUpdate, workflow.rounds, workflow.proposals)}
                manualMapping={workflow.proposals.some(p => p.field_update_id === selectedUpdate.id && p.status === 'finalized')}
                evidenceHistory={<ClarificationHistory rounds={workflow.rounds.filter(c => c.field_update_id === selectedUpdate.id)} />}
                decisionContent={<WorkflowActions update={selectedUpdate} rounds={workflow.rounds} proposals={workflow.proposals}
                  activities={activities} act={workflow.act} available={!workflow.loading && !workflow.error}
                  progressEvents={progress.events} progressEventsLoading={progress.loading} progressEventsError={progress.error}
                  onDecisionStart={() => setCompletedId(selectedUpdate.id)}
                  onRemap={setRemapTarget} />}
              />
            </div>
          ) : (
            /* ═══════════════════════════════════════════════
               MODE 1 — QUEUE MODE
               ═══════════════════════════════════════════════ */
            <div data-testid="queue-mode">
              {/* Queue header */}
              <section className="bg-white px-6 py-5 shadow-sm rounded border border-setu-slate-200">
                <h1 className="text-2xl font-extrabold tracking-tight text-setu-navy">Review Queue</h1>
                <p className="mt-1 text-sm text-setu-slate-500 leading-relaxed">
                  Review field evidence that needs planner action.
                </p>
              </section>

              {/* Primary scope tabs + search + filters */}
              <section className="bg-white border border-setu-slate-200 rounded shadow-sm">
                {/* Scope row */}
                <div className="flex items-center justify-between border-b border-setu-slate-200 px-4 py-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setFilter('view', 'unresolved')}
                      className={`px-4 py-2.5 text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-setu-blue/30 rounded-sm ${
                        view !== 'history'
                          ? 'text-setu-navy border-b-2 border-setu-navy'
                          : 'text-setu-slate-500 hover:text-setu-slate-700'
                      }`}
                    >
                      Pending <span className="ml-1 font-mono text-xs opacity-70">{pendingCount}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilter('view', 'history')}
                      className={`px-4 py-2.5 text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-setu-blue/30 rounded-sm ${
                        view === 'history'
                          ? 'text-setu-navy border-b-2 border-setu-navy'
                          : 'text-setu-slate-500 hover:text-setu-slate-700'
                      }`}
                    >
                      History <span className="ml-1 font-mono text-xs opacity-70">{historyCount}</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasSecondaryFilters && (
                      <button type="button" onClick={clearFilters} className="text-xs font-semibold text-setu-blue hover:underline focus:outline-none focus:ring-2 focus:ring-setu-blue/30">
                        Clear filters
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => refetch()}
                      aria-label="Refresh queue"
                      className="inline-flex items-center gap-1.5 border border-setu-slate-200 px-3 py-2 text-xs font-semibold text-setu-slate-600 hover:bg-setu-slate-50 focus:outline-none focus:ring-2 focus:ring-setu-blue/30 rounded"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Refresh
                    </button>
                  </div>
                </div>

                {/* Search + compact filters row */}
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="relative flex-1 min-w-[16rem]">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-setu-slate-400" />
                    <input
                      type="search"
                      aria-label="Search field evidence"
                      placeholder="Search reports, activity, location…"
                      value={search}
                      onChange={(event) => setFilter('q', event.target.value)}
                      className="w-full border border-setu-slate-200 bg-setu-slate-50 py-2.5 pl-10 pr-3 text-sm rounded focus:outline-none focus:ring-2 focus:ring-setu-blue/30 focus:border-setu-blue"
                    />
                  </div>
                  <button
                    type="button"
                    aria-expanded={filtersOpen}
                    onClick={() => setFiltersOpen(v => !v)}
                    className="inline-flex items-center gap-2 border border-setu-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-setu-slate-600 hover:bg-setu-slate-50 focus:outline-none focus:ring-2 focus:ring-setu-blue/30 rounded"
                  >
                    <Filter className="h-4 w-4" />
                    Filters
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>

                {/* Compact filter disclosure */}
                {filtersOpen && (
                  <div className="border-t border-setu-slate-200 px-4 py-3 bg-setu-slate-50 space-y-3">
                    {/* Advanced category buttons */}
                    <div className="flex flex-wrap gap-1.5">
                      {advancedViews.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setFilter('view', option.value)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors focus:outline-none focus:ring-2 focus:ring-setu-blue/30 ${
                            view === option.value
                              ? 'bg-setu-navy text-white'
                              : 'bg-white border border-setu-slate-200 text-setu-slate-600 hover:bg-setu-slate-100'
                          }`}
                        >
                          {option.label} <span className="font-mono opacity-70">{option.count ?? '—'}</span>
                        </button>
                      ))}
                    </div>
                    {/* Detail selects */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <select
                        aria-label="Filter by discipline"
                        value={discipline}
                        onChange={(event) => setFilter('discipline', event.target.value)}
                        className="border border-setu-slate-200 bg-white px-3 py-2 text-sm rounded focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
                      >
                        <option value="All">All disciplines</option>
                        {disciplines.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                      <select
                        aria-label="Filter by validation"
                        value={validation}
                        onChange={(event) => setFilter('validation', event.target.value)}
                        className="border border-setu-slate-200 bg-white px-3 py-2 text-sm rounded focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
                      >
                        <option value="All">All validation states</option>
                        <option value="pass">Passed</option>
                        <option value="warn">Warning</option>
                        <option value="block">Blocked</option>
                        <option value="overridden">Overridden</option>
                        <option value="unvalidated">Not yet validated</option>
                      </select>
                      <select
                        aria-label="Filter by confidence"
                        value={confidence}
                        onChange={(event) => setFilter('confidence', event.target.value)}
                        className="border border-setu-slate-200 bg-white px-3 py-2 text-sm rounded focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
                      >
                        <option value="All">All confidence tiers</option>
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                        <option value="Pending">Awaiting AI</option>
                      </select>
                    </div>
                  </div>
                )}
              </section>

              {/* Queue list */}
              {loading ? (
                <LoadingSkeleton rows={4} />
              ) : filteredUpdates.length === 0 ? (
                <EmptyState
                  title="No reports in this view"
                  description="Change the scope or remove filters. Finalized reports remain available under History."
                  actionButton={
                    <button type="button" onClick={clearFilters} className="bg-setu-blue px-4 py-2.5 text-sm font-bold text-white rounded hover:bg-setu-blue-dark focus:outline-none focus:ring-2 focus:ring-setu-teal">
                      Return to pending
                    </button>
                  }
                />
              ) : (
                <section className="bg-white border border-setu-slate-200 rounded shadow-sm divide-y divide-setu-slate-100" data-testid="queue-list">
                  <div className="flex items-center justify-between px-5 py-3 border-b border-setu-slate-200">
                    <span className="text-sm font-bold text-setu-slate-700">
                      {view === 'history' ? 'Finalized history' : 'Pending reviews'}
                    </span>
                    <span className="font-mono text-xs text-setu-slate-500">
                      {filteredUpdates.length} {filteredUpdates.length === 1 ? 'report' : 'reports'}
                    </span>
                  </div>
                  {filteredUpdates.map((update) => (
                    <ReviewQueueItem
                      key={update.id}
                      update={update}
                      matchedActivity={update.matched_activity_id ? activitiesMap.get(update.matched_activity_id) : undefined}
                      selected={false}
                      onSelect={() => selectReport(update.id)}
                      workflowLabel={workflowState(update, workflow.rounds, workflow.proposals)}
                    />
                  ))}
                </section>
              )}
            </div>
          )}

          <RemapModal
            isOpen={remapTarget !== null}
            update={remapTarget}
            activities={activities}
            plannerName={plannerName}
            onClose={() => setRemapTarget(null)}
            onConfirmRemap={handleConfirmRemap}
          />

          <OverrideModal
            isOpen={overrideTarget !== null}
            update={overrideTarget}
            plannerName={plannerName}
            onClose={() => setOverrideTarget(null)}
            onConfirmOverride={handleConfirmOverride}
          />
        </main>
      </div>
    </div>
  );
};
