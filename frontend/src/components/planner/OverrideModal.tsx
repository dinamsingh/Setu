import React, { useState } from 'react';
import { X, ShieldAlert, AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import type { FieldUpdate, ValidationCheckResult } from '../../types';

interface OverrideModalProps {
  isOpen: boolean;
  update: FieldUpdate | null;
  plannerName: string;
  onClose: () => void;
  onConfirmOverride: (update: FieldUpdate, reason: string) => Promise<void>;
}

export const OverrideModal: React.FC<OverrideModalProps> = ({
  isOpen,
  update,
  plannerName,
  onClose,
  onConfirmOverride,
}) => {
  if (!isOpen || !update) return null;

  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const rawResults = update.validation_results;
  const validationList: ValidationCheckResult[] = Array.isArray(rawResults)
    ? rawResults
    : typeof rawResults === 'string'
    ? JSON.parse(rawResults || '[]')
    : [];

  const failingChecks = validationList.filter((c) => c.outcome === 'fail');
  const warningChecks = validationList.filter((c) => c.outcome === 'warn');

  const handleConfirm = async () => {
    if (!reason.trim()) return;
    setIsSubmitting(true);
    try {
      await onConfirmOverride(update, reason.trim());
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-setu-navy-dark/60 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl border border-rose-200 shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-rose-100 flex items-center justify-between bg-rose-50/50">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-700 shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-rose-800">
                Project Controls Override
              </span>
              <h3 className="text-base font-bold text-setu-slate-900 mt-0.5">
                Override Validation Block for {update.update_id}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-setu-slate-400 hover:text-setu-slate-700 hover:bg-setu-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          {/* Target Activity & Narrative */}
          <div className="p-3 rounded-lg bg-setu-slate-50 border border-setu-slate-200 text-xs space-y-1.5">
            <div className="flex items-center justify-between font-mono">
              <span className="text-setu-slate-500">Target Activity:</span>
              <span className="font-bold text-setu-navy">{update.matched_activity_id || 'Unassigned'}</span>
            </div>
            <div className="italic text-setu-slate-600 border-t border-setu-slate-200 pt-1.5">
              "{update.field_text}"
            </div>
          </div>

          {/* Failing Checks Notice */}
          <div className="space-y-2">
            <span className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-rose-600" />
              Active Project Controls Blocks ({failingChecks.length}):
            </span>
            <div className="space-y-2">
              {failingChecks.map((c, i) => (
                <div key={i} className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs">
                  <div className="flex items-center justify-between font-bold text-rose-900">
                    <span>{c.name}</span>
                    <span className="px-1.5 py-0.5 rounded bg-rose-200 text-rose-800 text-[10px] uppercase">
                      FAIL
                    </span>
                  </div>
                  <p className="text-rose-700 mt-1 leading-relaxed">{c.message}</p>
                  {c.evidence && Object.keys(c.evidence).length > 0 && (
                    <div className="mt-2 p-2 rounded bg-white/80 border border-rose-200/60 font-mono text-[10px] text-setu-slate-600 space-y-0.5">
                      {Object.entries(c.evidence).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-setu-slate-400">{k}:</span>
                          <span className="font-semibold text-setu-slate-800">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {warningChecks.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Additional Warnings ({warningChecks.length}):
              </span>
              {warningChecks.map((c, i) => (
                <div key={i} className="p-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  <span className="font-bold">{c.name}:</span> {c.message}
                </div>
              ))}
            </div>
          )}

          {/* Mandatory Justification Input */}
          <div>
            <label className="text-xs font-bold text-setu-slate-800 block mb-1">
              Mandatory Engineering Justification / Override Rationale: <span className="text-rose-600">*</span>
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Schedule dates delayed by client change order CO-04; verbal confirmation from site engineer Ramesh Borah that Section B was mobilized early."
              className="w-full text-xs p-2.5 rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 placeholder:text-setu-slate-400"
            />
            <p className="text-[11px] text-setu-slate-500 mt-1">
              This justification will be permanently recorded under <strong>{plannerName}</strong> in the immutable audit log with action <code>'override'</code>.
            </p>
          </div>
        </div>

        {/* Footer */}
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
            disabled={!reason.trim() || isSubmitting}
            onClick={handleConfirm}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Authorize Override & Permit Approval</span>
          </button>
        </div>
      </div>
    </div>
  );
};
