import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Filter,
  History,
  RefreshCw,
  Search,
  UserCircle,
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [remapTarget, setRemapTarget] = useState<FieldUpdate | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<FieldUpdate | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const requestedView = searchParams.get('view') as ReviewView | null;
  const view = requestedView && reviewViews.includes(requestedView) ? requestedView : 'unresolved';
  const confidence = searchParams.get('confidence') || 'All';
  const status = searchParams.get('status') || 'All';
  const discipline = searchParams.get('discipline') || 'All';
  const validation = searchParams.get('validation') || 'All';
  const search = searchParams.get('q') || '';

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    const isDefaultView = key === 'view' && value === 'unresolved';
    if (!value || value === 'All' || isDefaultView) next.delete(key);
    else next.set(key, value);
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
  const historyCount = updates.filter((update) => update.status !== 'pending').length;

  const effectiveSelectedId = filteredUpdates.some((update) => update.id === selectedId)
    ? selectedId
    : filteredUpdates[0]?.id || null;
  const selectedUpdate =
    filteredUpdates.find((update) => update.id === effectiveSelectedId) || null;
  const selectedActivity = selectedUpdate?.matched_activity_id
    ? activitiesMap.get(selectedUpdate.matched_activity_id)
    : undefined;

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
    const result = await requeueForRematching({ updateUuid: update.id, remarks });
    const error = actionErrorMessage(result, 'Failed to requeue report.');
    if (error) showToast(error, 'error');
    else showToast(`Report ${update.update_id} requeued for the matching worker.`);
  };

  const handleConfirmOverride = async (update: FieldUpdate, reason: string) => {
    const result = await overrideValidation({ updateUuid: update.id, reason });
    const error = actionErrorMessage(result, 'Failed to record validation override.');
    if (error) {
      showToast(error, 'error');
      return false;
    }
    showToast(`Validation override recorded for ${update.update_id}.`);
    return true;
  };

  const clearFilters = () => setSearchParams(new URLSearchParams());
  const loading = updatesLoading || scheduleLoading;
  const hasSecondaryFilters =
    confidence !== 'All' ||
    status !== 'All' ||
    discipline !== 'All' ||
    validation !== 'All' ||
    Boolean(search);

  const viewOptions: Array<{ value: ReviewView; label: string; count: number | null }> = [
    { value: 'unresolved', label: 'Unresolved', count: updates.filter((update) => update.status === 'pending').length },
    { value: 'blocked', label: 'Blocked', count: workflow.loading || workflow.error ? null : counts.blocked },
    { value: 'unmatched', label: 'Unmatched', count: counts.unmatched },
    { value: 'low', label: 'Low confidence', count: counts.lowConfidence },
    { value: 'awaiting', label: 'Awaiting AI', count: counts.awaitingAi },
    { value: 'triage', label: 'Response Received', count: workflow.loading || workflow.error ? null : counts.needsTriage },
    { value: 'response', label: 'Awaiting Field Response', count: workflow.loading || workflow.error ? null : counts.awaitingResponse },
    { value: 'reprocessing', label: 'Reprocessing Evidence', count: workflow.loading || workflow.error ? null : counts.reprocessing },
    { value: 'remap', label: 'Remap proposals', count: workflow.loading || workflow.error ? null : counts.remapPending + counts.readyToConfirm },
    { value: 'history', label: 'Finalized history', count: historyCount },
  ];

  return (
    <div className="min-h-screen bg-setu-slate-100 flex flex-col">
      <Header currentRole="planner" />
      <div className="flex-1 flex flex-col md:flex-row">
        <Sidebar />

        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 space-y-4 max-w-[100rem]">
          {toast && (
            <div
              role="alert"
              className={`fixed bottom-5 right-5 z-50 flex max-w-md items-start gap-2.5 border px-4 py-3 text-xs font-semibold shadow-xl ${
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

          <section className="border-l-4 border-setu-blue bg-white px-5 py-4 shadow-xs">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-setu-blue">Human-controlled linking</p>
                <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-setu-slate-900">Review Queue</h1>
                <p className="mt-1 text-xs text-setu-slate-500">
                  Field evidence → AI suggestion → project-controls validation → planner decision
                </p>
              </div>
              <div className="flex items-center gap-2 border border-setu-slate-200 bg-setu-slate-50 px-3 py-2 text-xs">
                <UserCircle className="h-4 w-4 text-setu-blue" />
                <span className="text-setu-slate-500">Acting role</span>
                <strong className="text-setu-navy">{plannerName}</strong>
              </div>
            </div>
          </section>

          {(updatesError || scheduleError || workflow.error) && (
            <div className="border-l-4 border-setu-red bg-rose-50 px-4 py-3 text-xs text-rose-900" role="alert">
              <strong>Queue data unavailable:</strong> {[updatesError, scheduleError, workflow.error].filter(Boolean).join(' ')}
            </div>
          )}

          <section className="border border-setu-slate-200 bg-white">
            <div className="flex flex-wrap items-center gap-1 border-b border-setu-slate-200 px-3 py-2">
              {viewOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter('view', option.value)}
                  className={`px-3 py-2 text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-setu-blue/30 ${
                    view === option.value
                      ? 'bg-setu-navy text-white'
                      : 'text-setu-slate-600 hover:bg-setu-slate-100 hover:text-setu-slate-900'
                  }`}
                >
                  {option.label} <span className="font-mono opacity-75">{option.count ?? '—'}</span>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 px-3 py-3 sm:grid-cols-2 xl:grid-cols-[minmax(15rem,1.5fr)_repeat(3,minmax(9rem,0.75fr))_auto]">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-setu-slate-400" />
                <input
                  type="search"
                  aria-label="Search field evidence"
                  placeholder="Search evidence, report, activity, reporter"
                  value={search}
                  onChange={(event) => setFilter('q', event.target.value)}
                  className="w-full border border-setu-slate-300 py-2 pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
                />
              </div>
              <select
                aria-label="Filter by discipline"
                value={discipline}
                onChange={(event) => setFilter('discipline', event.target.value)}
                className="border border-setu-slate-300 bg-white px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
              >
                <option value="All">All disciplines</option>
                {disciplines.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select
                aria-label="Filter by validation"
                value={validation}
                onChange={(event) => setFilter('validation', event.target.value)}
                className="border border-setu-slate-300 bg-white px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
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
                className="border border-setu-slate-300 bg-white px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
              >
                <option value="All">All confidence tiers</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
                <option value="Pending">Awaiting AI</option>
              </select>
              <div className="flex items-center justify-end gap-2">
                {hasSecondaryFilters && (
                  <button type="button" onClick={clearFilters} className="text-xs font-semibold text-setu-blue hover:underline focus:outline-none focus:ring-2 focus:ring-setu-blue/30">
                    Clear filters
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="inline-flex items-center gap-1.5 border border-setu-slate-300 px-3 py-2 text-xs font-semibold text-setu-slate-700 hover:bg-setu-slate-50 focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </button>
              </div>
            </div>
          </section>

          {loading ? (
            <LoadingSkeleton rows={4} />
          ) : filteredUpdates.length === 0 ? (
            <EmptyState
              title="No reports in this view"
              description="Change the work view or remove filters. Finalized reports remain available under Finalized history."
              actionButton={
                <button type="button" onClick={clearFilters} className="bg-setu-blue px-3 py-2 text-xs font-bold text-white">
                  Return to unresolved
                </button>
              }
            />
          ) : (
            <section className="grid min-h-[42rem] grid-cols-1 gap-4 lg:grid-cols-[minmax(19rem,0.85fr)_minmax(0,2fr)]">
              <aside className="border border-setu-slate-200 bg-white lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-setu-slate-200 bg-setu-slate-50 px-4 py-2.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-setu-slate-700">
                    {view === 'history' ? <History className="h-3.5 w-3.5" /> : <Filter className="h-3.5 w-3.5" />}
                    {view === 'history' ? 'Finalized history' : 'Prioritized queue'}
                  </div>
                  <span className="font-mono text-[11px] text-setu-slate-500">{filteredUpdates.length}</span>
                </div>
                <div className="divide-y divide-setu-slate-100">
                  {filteredUpdates.map((update) => (
                    <ReviewQueueItem
                      key={update.id}
                      update={update}
                      matchedActivity={update.matched_activity_id ? activitiesMap.get(update.matched_activity_id) : undefined}
                      selected={effectiveSelectedId === update.id}
                      onSelect={() => setSelectedId(update.id)}
                      workflowLabel={workflowState(update, workflow.rounds, workflow.proposals)}
                    />
                  ))}
                </div>
              </aside>

              <div className="min-w-0">
                {selectedUpdate && (
                  <ReviewCard
                    key={selectedUpdate.id}
                    update={selectedUpdate}
                    matchedActivity={selectedActivity}
                    plannerName={plannerName}
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
                      onAccept={handleAccept} onRemap={setRemapTarget} />}
                  />
                )}
              </div>
            </section>
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
