import { useMemo, useState } from 'react';
import { canRemapToActivity } from '../../lib/plannerWorkspace';
import { extractCandidateTerms } from '../../lib/aliasProposer';
import { supabase } from '../../lib/supabase';
import type { FieldUpdate, ScheduleActivity } from '../../types';

interface Props {
  isOpen: boolean; update: FieldUpdate | null; activities: ScheduleActivity[];
  plannerName: string; onClose: () => void;
  onConfirmRemap: (update: FieldUpdate, activityId: string, remarks: string) => Promise<boolean>;
}
export function RemapModal({ isOpen, update, ...rest }: Props) {
  return isOpen && update ? <RemapSelection key={update.id} update={update} {...rest} /> : null;
}
function RemapSelection({ update, activities, plannerName, onClose, onConfirmRemap }: Omit<Props, 'isOpen' | 'update'> & { update: FieldUpdate }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposeAlias, setProposeAlias] = useState(false);
  const [fieldTerm, setFieldTerm] = useState('');
  const [standardTerm, setStandardTerm] = useState('');
  const [proposalSubmitted, setProposalSubmitted] = useState(false);
  const selectedActivity = activities.find(a => a.activity_id === selected);
  const filtered = useMemo(() => activities.filter(a =>
    [a.activity_id, a.activity_name, a.discipline, a.wbs_code].join(' ').toLowerCase().includes(search.toLowerCase())).slice(0, 80),
    [activities, search]);
  async function submit() {
    if (busy || !canRemapToActivity(update.matched_activity_id, selected)) return;
    setBusy(true); setError(null);
    try {
      if (!proposalSubmitted) {
        if (!await onConfirmRemap(update, selected, '')) {
          setError('Could not submit this target. See the action error and try again.'); return;
        }
        setProposalSubmitted(true);
      }
      // Preserve the existing optional, quarantined alias proposal. A failed
      // workflow never inserts an alias; retrying an alias never repeats remap.
      if (proposeAlias && fieldTerm.trim()) {
        const { error: aliasError } = await supabase.from('domain_aliases').insert([{
          field_term: fieldTerm.trim().toLowerCase(), standard_term: standardTerm.trim(),
          discipline: selectedActivity?.discipline || 'General', status: 'proposed',
          origin: 'planner_correction', source_update_id: update.update_id, proposed_by: plannerName,
        }]);
        if (aliasError) { setError(`Target submitted; optional alias failed: ${aliasError.message}`); return; }
      }
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Target submission failed.'); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-setu-navy-dark/60 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="remap-title" className="w-full max-w-2xl border border-setu-slate-300 bg-white shadow-xl">
      <header className="border-b border-setu-slate-200 bg-setu-slate-50 px-5 py-4">
        <h2 id="remap-title" className="font-bold">Select schedule activity · {update.update_id}</h2>
        <p className="mt-1 text-xs">Selection creates a proposal, not a final decision. The worker validates this exact target before you confirm Remap.</p>
      </header>
      <div className="space-y-3 px-5 py-4">
        <blockquote className="border-l-4 border-setu-slate-400 bg-setu-slate-50 p-3 text-xs">{update.field_text}</blockquote>
        {error && <p role="alert" className="text-xs text-rose-900">{error}</p>}
        <label className="block text-xs font-bold">Search baseline activities
          <input autoFocus disabled={proposalSubmitted} aria-label="Search baseline activities" className="mt-1 w-full border border-setu-slate-300 px-3 py-2" value={search} onChange={e => setSearch(e.target.value)} />
        </label>
        <div className="max-h-72 overflow-y-auto divide-y divide-setu-slate-200 border border-setu-slate-200">
          {filtered.map(a => <button key={a.activity_id} disabled={busy || proposalSubmitted || a.activity_id === update.matched_activity_id} onClick={() => { setSelected(a.activity_id); setProposeAlias(false); }}
            className={`block w-full px-3 py-3 text-left text-xs focus:outline-none focus:ring-2 focus:ring-inset focus:ring-setu-blue disabled:opacity-40 ${selected === a.activity_id ? 'bg-blue-50' : 'hover:bg-setu-slate-50'}`}>
            <strong>{a.activity_id}</strong> · {a.discipline} · WBS {a.wbs_code}{a.activity_id === update.matched_activity_id ? ' · Current activity' : ''}
            <p>{a.activity_name}</p>
          </button>)}
          {!filtered.length && <p className="p-3 text-xs">No baseline activities match.</p>}
        </div>
        {selectedActivity && <details className="border-t border-setu-slate-200 pt-2 text-xs">
          <summary className="cursor-pointer font-semibold">Secondary: optional domain alias proposal</summary>
          <label className="mt-2 block"><input type="checkbox" checked={proposeAlias} disabled={busy}
            onChange={e => {
              setProposeAlias(e.target.checked);
              const candidate = extractCandidateTerms(update.field_text, selectedActivity.activity_name, selectedActivity.discipline)[0];
              if (!fieldTerm) { setFieldTerm(candidate?.field_term || ''); setStandardTerm(candidate?.standard_term || selectedActivity.activity_name); }
            }} /> Propose alias for separate governance review</label>
          {proposeAlias && <div className="mt-2 space-y-2">
            <label className="block">Field term<input aria-label="Alias field term" className="mt-1 w-full border px-2 py-2" value={fieldTerm} onChange={e => setFieldTerm(e.target.value)} /></label>
            <label className="block">Standard term<input aria-label="Alias standard term" className="mt-1 w-full border px-2 py-2" value={standardTerm} onChange={e => setStandardTerm(e.target.value)} /></label>
            <p>Stored as proposed only. It never affects matching until separately approved in Alias Governance.</p>
          </div>}
        </details>}
      </div>
      <footer className="flex justify-between border-t border-setu-slate-200 px-5 py-3 text-xs">
        <button disabled={busy} className="border px-3 py-2" onClick={onClose}>Cancel</button>
        <button disabled={busy || !canRemapToActivity(update.matched_activity_id, selected) || (proposeAlias && (!fieldTerm.trim() || !standardTerm.trim()))} className="bg-setu-blue px-3 py-2 font-bold text-white disabled:opacity-40" onClick={() => void submit()}>
          {busy ? 'Submitting…' : proposalSubmitted ? 'Retry optional alias proposal' : 'Validate selected activity'}
        </button>
      </footer>
    </section>
  </div>;
}
