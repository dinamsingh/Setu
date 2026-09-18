import React, { useState, useMemo, useEffect } from 'react';
import { X, Search, Check, Sparkles, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { extractCandidateTerms } from '../../lib/aliasProposer';
import type { FieldUpdate, ScheduleActivity } from '../../types';

interface RemapModalProps {
  isOpen: boolean;
  update: FieldUpdate | null;
  activities: ScheduleActivity[];
  plannerName: string;
  onClose: () => void;
  onConfirmRemap: (update: FieldUpdate, newActivityId: string, remarks: string) => Promise<void>;
}

export const RemapModal: React.FC<RemapModalProps> = ({
  isOpen,
  update,
  activities,
  plannerName,
  onClose,
  onConfirmRemap,
}) => {
  if (!isOpen || !update) return null;

  const [search, setSearch] = useState('');
  const [selectedActId, setSelectedActId] = useState<string>(
    update.matched_activity_id || activities[0]?.activity_id || ''
  );
  const [remarks, setRemarks] = useState(
    update.planner_remarks || `Remapped by ${plannerName}`
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Institutional Memory State
  const [proposeAlias, setProposeAlias] = useState(false);
  const [proposedFieldTerm, setProposedFieldTerm] = useState('');
  const [proposedStandardTerm, setProposedStandardTerm] = useState('');
  const [proposedDiscipline, setProposedDiscipline] = useState('');

  const selectedActivity = useMemo(() => {
    return activities.find((a) => a.activity_id === selectedActId) || null;
  }, [activities, selectedActId]);

  const candidateProposals = useMemo(() => {
    if (!update?.field_text || !selectedActivity?.activity_name) return [];
    return extractCandidateTerms(
      update.field_text,
      selectedActivity.activity_name,
      selectedActivity.discipline
    );
  }, [update?.field_text, selectedActivity]);

  useEffect(() => {
    if (proposeAlias && candidateProposals.length > 0 && !proposedFieldTerm) {
      setProposedFieldTerm(candidateProposals[0].field_term);
      setProposedStandardTerm(candidateProposals[0].standard_term);
      setProposedDiscipline(candidateProposals[0].discipline);
    } else if (selectedActivity && !proposedStandardTerm) {
      setProposedStandardTerm(selectedActivity.activity_name);
      setProposedDiscipline(selectedActivity.discipline || 'General');
    }
  }, [proposeAlias, candidateProposals, selectedActivity]);

  const filteredActivities = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activities.slice(0, 50); // initial 50
    return activities.filter(
      (a) =>
        a.activity_id.toLowerCase().includes(q) ||
        a.activity_name.toLowerCase().includes(q) ||
        a.discipline.toLowerCase().includes(q) ||
        a.wbs_code.toLowerCase().includes(q)
    );
  }, [activities, search]);

  const candidates = Array.isArray(update.candidate_matches) ? update.candidate_matches : [];

  const handleConfirm = async () => {
    if (!selectedActId) return;
    setIsSubmitting(true);
    try {
      if (proposeAlias && proposedFieldTerm.trim()) {
        await supabase.from('domain_aliases').insert([
          {
            field_term: proposedFieldTerm.trim().toLowerCase(),
            standard_term: (proposedStandardTerm || selectedActivity?.activity_name || '').trim(),
            discipline: proposedDiscipline || selectedActivity?.discipline || 'General',
            status: 'proposed',
            origin: 'planner_correction',
            source_update_id: update.update_id,
            proposed_by: plannerName || 'Lead Project Planner',
          },
        ]);
      }
      await onConfirmRemap(update, selectedActId, remarks);
      onClose();
    } catch (err: any) {
      console.error('Error confirming remap or proposing alias:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-setu-navy-dark/60 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl border border-setu-slate-200 shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-setu-slate-100 flex items-center justify-between bg-setu-slate-50">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-purple-700">
              Planner Control · Activity Reassignment
            </span>
            <h3 className="text-base font-bold text-setu-slate-900 mt-0.5">
              Remap Report {update.update_id}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-setu-slate-400 hover:text-setu-slate-700 hover:bg-setu-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Field Evidence Context */}
          <div className="p-3 rounded-lg bg-setu-slate-900 text-white text-xs">
            <span className="text-[10px] font-bold text-setu-blue-light uppercase tracking-wider block mb-1">
              Field Evidence Narrative:
            </span>
            <p className="italic text-setu-slate-200">"{update.field_text}"</p>
          </div>

          {/* Quick pick candidates if available */}
          {candidates.length > 0 && (
            <div>
              <span className="text-xs font-bold text-setu-slate-700 block mb-1.5">
                Suggested Candidates from Matching Engine:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {candidates.slice(0, 3).map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedActId(c.activity_id)}
                    className={`text-left p-2.5 rounded-lg border text-xs transition-all ${
                      selectedActId === c.activity_id
                        ? 'border-purple-600 bg-purple-50 text-purple-900 font-semibold ring-1 ring-purple-600'
                        : 'border-setu-slate-200 bg-setu-slate-50 hover:bg-white text-setu-slate-700'
                    }`}
                  >
                    <div className="font-mono text-[11px] font-bold text-setu-navy">{c.activity_id}</div>
                    <div className="truncate text-[11px] mt-0.5">{c.activity_name}</div>
                    <div className="text-[10px] text-setu-teal mt-0.5">
                      Score: {c.combined_score ? (Number(c.combined_score) * 100).toFixed(1) + '%' : '—'}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search All Activities */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-setu-slate-700">
                Or Search All 220 Baseline Activities:
              </span>
              <span className="text-[11px] text-setu-slate-400">
                {filteredActivities.length} matching
              </span>
            </div>
            <div className="relative mb-2">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-setu-slate-400" />
              <input
                type="text"
                placeholder="Search activity ID, discipline, or task name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-purple-600"
              />
            </div>

            {/* List of activities */}
            <div className="max-h-48 overflow-y-auto border border-setu-slate-200 rounded-lg divide-y divide-setu-slate-100">
              {filteredActivities.length === 0 ? (
                <div className="p-4 text-center text-xs text-setu-slate-500">
                  No Primavera activities match your search query.
                </div>
              ) : (
                filteredActivities.map((act) => {
                  const isSelected = selectedActId === act.activity_id;
                  return (
                    <div
                      key={act.activity_id}
                      onClick={() => setSelectedActId(act.activity_id)}
                      className={`p-2.5 text-xs flex items-center justify-between cursor-pointer transition-colors ${
                        isSelected ? 'bg-purple-50 text-purple-900 font-semibold' : 'hover:bg-setu-slate-50'
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-1.5 font-mono">
                          <span className="font-bold text-setu-navy">{act.activity_id}</span>
                          <span className="text-setu-teal font-sans text-[10px]">[{act.discipline}]</span>
                          <span className="text-setu-slate-400 text-[10px]">WBS: {act.wbs_code}</span>
                        </div>
                        <p className="truncate text-setu-slate-800 text-[11px] mt-0.5">{act.activity_name}</p>
                      </div>
                      {isSelected && (
                        <Check className="w-4 h-4 text-purple-600 shrink-0" />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Institutional Memory: Propose Domain Alias */}
          <div className="p-3.5 rounded-xl border border-purple-200 bg-purple-50/40 space-y-3">
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={proposeAlias}
                onChange={(e) => setProposeAlias(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-setu-slate-300 text-purple-600 focus:ring-purple-500"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                  <span className="text-xs font-bold text-setu-slate-900">
                    Propose New Domain Alias (Institutional Memory)
                  </span>
                </div>
                <span className="text-[11px] text-setu-slate-500 block mt-0.5">
                  Teach the engine this site jargon so future matching links to this activity automatically.
                </span>
              </div>
            </label>

            {proposeAlias && (
              <div className="space-y-3 pt-2.5 border-t border-purple-100 animate-fadeIn">
                {candidateProposals.length > 0 && (
                  <div>
                    <span className="text-[10px] font-bold text-setu-slate-500 uppercase tracking-wider block mb-1.5">
                      Suggested Candidate Jargon from Field Report:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {candidateProposals.map((cand, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setProposedFieldTerm(cand.field_term);
                            setProposedStandardTerm(cand.standard_term);
                            setProposedDiscipline(cand.discipline);
                          }}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${
                            proposedFieldTerm === cand.field_term
                              ? 'bg-purple-600 text-white border-purple-600 font-semibold shadow-xs'
                              : 'bg-white text-setu-slate-700 border-setu-slate-200 hover:border-purple-300'
                          }`}
                        >
                          "{cand.field_term}"
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] font-semibold text-setu-slate-700 block mb-1">
                      Field Term / Slang:
                    </label>
                    <input
                      type="text"
                      value={proposedFieldTerm}
                      onChange={(e) => setProposedFieldTerm(e.target.value)}
                      placeholder="e.g. box-up"
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-setu-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-purple-600"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-setu-slate-700 block mb-1">
                      Target Standard Term:
                    </label>
                    <input
                      type="text"
                      value={proposedStandardTerm}
                      onChange={(e) => setProposedStandardTerm(e.target.value)}
                      placeholder="Standard P6 activity term"
                      className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-setu-slate-300 bg-white focus:outline-none focus:ring-1 focus:ring-purple-600"
                    />
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-amber-50/80 border border-amber-200/80 flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-800 leading-tight">
                    <strong>Human Review Quarantine:</strong> Proposed aliases are stored as <em>'proposed'</em> and <strong>never affect matching</strong> until explicitly approved by a planner in the Domain Dictionary.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Remarks input */}
          <div>
            <label className="text-xs font-bold text-setu-slate-700 block mb-1">
              Remap Justification / Planner Remarks:
            </label>
            <input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Reassigned based on foreman shift log clarification"
              className="w-full text-xs px-3 py-2 rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-purple-600"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-setu-slate-100 flex items-center justify-between bg-setu-slate-50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold text-setu-slate-600 hover:bg-setu-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedActId || isSubmitting}
            onClick={handleConfirm}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-xs transition-colors disabled:opacity-50"
          >
            Confirm Remap to [{selectedActId}]
          </button>
        </div>
      </div>
    </div>
  );
};
