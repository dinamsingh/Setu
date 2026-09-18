import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Filter, 
  Search, 
  CheckSquare, 
  UserCircle, 
  RefreshCw, 
  CheckCircle2
} from 'lucide-react';
import { Header } from '../../components/common/Header';
import { Sidebar } from '../../components/common/Sidebar';
import { ReviewCard } from '../../components/planner/ReviewCard';
import { RemapModal } from '../../components/planner/RemapModal';
import { EmptyState } from '../../components/common/EmptyState';
import { LoadingSkeleton } from '../../components/common/LoadingSkeleton';
import { useFieldUpdates } from '../../hooks/useFieldUpdates';
import { useScheduleData } from '../../hooks/useScheduleData';
import type { FieldUpdate } from '../../types';

export const ReviewQueue: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { updates, loading: updatesLoading, refetch, updateStatusAndAudit } = useFieldUpdates();
  const { activities, activitiesMap, disciplines, loading: scheduleLoading } = useScheduleData();

  const [plannerName, setPlannerName] = useState('Lead Project Planner');
  const [remapTarget, setRemapTarget] = useState<FieldUpdate | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Read filter params from URL
  const confidenceFilter = searchParams.get('confidence') || 'All';
  const statusFilter = searchParams.get('status') || 'All';
  const disciplineFilter = searchParams.get('discipline') || 'All';
  const searchQuery = searchParams.get('q') || '';

  const setFilter = (key: string, val: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (val === 'All' || !val) {
      newParams.delete(key);
    } else {
      newParams.set(key, val);
    }
    setSearchParams(newParams);
  };

  const filteredUpdates = useMemo(() => {
    return updates.filter((u) => {
      // 1. Confidence filter
      if (confidenceFilter !== 'All' && u.confidence_level.toLowerCase() !== confidenceFilter.toLowerCase()) {
        return false;
      }

      // 2. Status filter
      if (statusFilter !== 'All' && u.status.toLowerCase() !== statusFilter.toLowerCase()) {
        return false;
      }

      // 3. Discipline filter
      if (disciplineFilter !== 'All') {
        const act = u.matched_activity_id ? activitiesMap.get(u.matched_activity_id) : undefined;
        const disc = act?.discipline || (Array.isArray(u.candidate_matches) && u.candidate_matches[0]?.discipline) || 'Unassigned';
        if (disc.toLowerCase() !== disciplineFilter.toLowerCase()) {
          return false;
        }
      }

      // 4. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const act = u.matched_activity_id ? activitiesMap.get(u.matched_activity_id) : undefined;
        const haystack = `${u.update_id} ${u.field_text} ${u.site_location || ''} ${u.reported_by || ''} ${u.matched_activity_id || ''} ${act?.activity_name || ''}`.toLowerCase();
        if (!haystack.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [updates, confidenceFilter, statusFilter, disciplineFilter, searchQuery, activitiesMap]);

  const handleAccept = async (update: FieldUpdate, remarks: string) => {
    const res = await updateStatusAndAudit({
      updateUuid: update.id,
      action: 'accept',
      previousActId: update.matched_activity_id,
      newActId: update.matched_activity_id,
      plannerName,
      remarks,
    });
    if (res.success) {
      showToast(`Update ${update.update_id} approved and logged in audit trail.`);
    }
  };

  const handleReject = async (update: FieldUpdate, remarks: string) => {
    const res = await updateStatusAndAudit({
      updateUuid: update.id,
      action: 'reject',
      previousActId: update.matched_activity_id,
      newActId: null,
      plannerName,
      remarks,
    });
    if (res.success) {
      showToast(`Update ${update.update_id} marked as rejected.`);
    }
  };

  const handleConfirmRemap = async (update: FieldUpdate, newActivityId: string, remarks: string) => {
    const res = await updateStatusAndAudit({
      updateUuid: update.id,
      action: 'remap',
      previousActId: update.matched_activity_id,
      newActId: newActivityId,
      plannerName,
      remarks,
    });
    if (res.success) {
      showToast(`Update ${update.update_id} successfully remapped to [${newActivityId}].`);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const loading = updatesLoading || scheduleLoading;

  return (
    <div className="min-h-screen bg-setu-slate-100 flex flex-col">
      <Header currentRole="planner" />

      <div className="flex-1 flex flex-col md:flex-row">
        <Sidebar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl">
          {/* Toast Alert */}
          {toastMessage && (
            <div className="fixed bottom-5 right-5 z-50 p-4 rounded-xl bg-setu-navy text-white shadow-xl border border-setu-slate-700 flex items-center space-x-2.5 animate-fadeIn">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
              <span className="text-xs font-semibold">{toastMessage}</span>
            </div>
          )}

          {/* Header & Planner Info Strip */}
          <div className="bg-white rounded-2xl border border-setu-slate-200 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 text-xs font-bold text-setu-teal uppercase tracking-wider">
                <CheckSquare className="w-4 h-4" />
                <span>Planner Review Queue &middot; Human-in-the-Loop</span>
              </div>
              <h1 className="text-2xl font-extrabold text-setu-slate-900 mt-1">
                Progress Linking Review Queue
              </h1>
              <p className="text-xs text-setu-slate-500 mt-1">
                Validate AI-suggested links between unstructured site evidence and formal Primavera activities.
              </p>
            </div>

            {/* Editable Planner Name Input */}
            <div className="flex items-center space-x-2 bg-setu-slate-50 px-3 py-1.5 rounded-xl border border-setu-slate-200 text-xs self-start sm:self-center">
              <UserCircle className="w-4 h-4 text-setu-blue shrink-0" />
              <div className="flex flex-col">
                <span className="text-[10px] text-setu-slate-400 font-bold uppercase">Acting Planner:</span>
                <input
                  type="text"
                  value={plannerName}
                  onChange={(e) => setPlannerName(e.target.value)}
                  className="font-bold text-setu-navy bg-transparent focus:outline-none text-xs"
                />
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="bg-white rounded-xl border border-setu-slate-200 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs font-bold text-setu-slate-700">
                <Filter className="w-3.5 h-3.5 text-setu-blue" />
                <span>Filter & Search Queue</span>
              </div>
              <button
                onClick={() => refetch()}
                className="inline-flex items-center space-x-1 text-xs text-setu-blue hover:text-setu-blue-dark font-semibold"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Confidence Filter */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-setu-slate-500 mb-1">
                  Confidence Tier
                </label>
                <select
                  value={confidenceFilter}
                  onChange={(e) => setFilter('confidence', e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-setu-blue bg-white font-medium"
                >
                  <option value="All">All Tiers (40)</option>
                  <option value="High">High Confidence (&ge;82%)</option>
                  <option value="Medium">Medium Review (55-81%)</option>
                  <option value="Low">Low / Flagged (&lt;55%)</option>
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-setu-slate-500 mb-1">
                  Review Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setFilter('status', e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-setu-blue bg-white font-medium"
                >
                  <option value="All">All Statuses</option>
                  <option value="pending">Pending Review</option>
                  <option value="approved">Approved</option>
                  <option value="remapped">Remapped</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>

              {/* Discipline Filter */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-setu-slate-500 mb-1">
                  Discipline
                </label>
                <select
                  value={disciplineFilter}
                  onChange={(e) => setFilter('discipline', e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-setu-blue bg-white font-medium"
                >
                  <option value="All">All Disciplines</option>
                  {disciplines.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              {/* Free-text Search */}
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-setu-slate-500 mb-1">
                  Search Narrative
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-setu-slate-400" />
                  <input
                    type="text"
                    placeholder="Search text, task ID, foreman..."
                    value={searchQuery}
                    onChange={(e) => setFilter('q', e.target.value)}
                    className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-setu-blue"
                  />
                </div>
              </div>
            </div>

            {/* Filter Summary */}
            <div className="text-[11px] text-setu-slate-500 flex items-center justify-between pt-1">
              <span>
                Showing <strong>{filteredUpdates.length}</strong> of {updates.length} total field reports
              </span>
              {(confidenceFilter !== 'All' || statusFilter !== 'All' || disciplineFilter !== 'All' || searchQuery) && (
                <button
                  onClick={() => setSearchParams(new URLSearchParams())}
                  className="text-setu-blue hover:underline font-semibold"
                >
                  Clear All Filters
                </button>
              )}
            </div>
          </div>

          {/* Cards List */}
          {loading ? (
            <LoadingSkeleton rows={4} />
          ) : filteredUpdates.length === 0 ? (
            <EmptyState
              title="No field reports match this filter criteria"
              description="Adjust the confidence tier, status, or search query above to view pending items."
              actionButton={
                <button
                  onClick={() => setSearchParams(new URLSearchParams())}
                  className="px-3 py-1.5 rounded-lg bg-setu-blue text-white text-xs font-bold"
                >
                  Reset Filters
                </button>
              }
            />
          ) : (
            <div className="space-y-4">
              {filteredUpdates.map((item) => {
                const matchedAct = item.matched_activity_id
                  ? activitiesMap.get(item.matched_activity_id)
                  : undefined;

                return (
                  <ReviewCard
                    key={item.id}
                    update={item}
                    matchedActivity={matchedAct}
                    plannerName={plannerName}
                    onAccept={handleAccept}
                    onReject={handleReject}
                    onOpenRemap={(u) => setRemapTarget(u)}
                  />
                );
              })}
            </div>
          )}

          {/* Remap Activity Modal */}
          <RemapModal
            isOpen={remapTarget !== null}
            update={remapTarget}
            activities={activities}
            plannerName={plannerName}
            onClose={() => setRemapTarget(null)}
            onConfirmRemap={handleConfirmRemap}
          />
        </main>
      </div>
    </div>
  );
};
