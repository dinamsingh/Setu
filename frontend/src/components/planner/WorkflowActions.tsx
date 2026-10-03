import { useState } from 'react';
import type { FieldUpdate, ScheduleActivity } from '../../types';
import type { Clarification, ClarificationImpact, RemapProposal, WorkflowResult } from '../../types/workflow';
import { activeProposal, canAccept, impactLabels, proposalReady, workflowState } from '../../lib/workflow';
import { parseValidationResults } from '../../lib/utils';

export type WorkflowAction = (name: string, params: Record<string, unknown>) => Promise<WorkflowResult>;
const inputClass = 'mt-1 w-full border border-setu-slate-300 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-setu-blue/30';
const buttonClass = 'border border-setu-slate-300 px-3 py-2 text-xs font-bold hover:bg-setu-slate-50 focus:outline-none focus:ring-2 focus:ring-setu-blue/30 disabled:opacity-40';

export function ImpactSelect({ value, onChange }: { value: string; onChange: (value: ClarificationImpact) => void }) {
  return <label className="block text-xs font-bold">Impact (required)
    <select required aria-label="Clarification impact" className={inputClass} value={value} onChange={e => onChange(e.target.value as ClarificationImpact)}>
      <option value="">Choose impact explicitly</option>
      {Object.entries(impactLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
    <span className="mt-1 block text-[11px] font-normal text-setu-slate-500">Confirm only keeps current results. Validation changes keep the linked target. Mapping changes rerun AI linking.</span>
  </label>;
}

export function ClarificationHistory({ rounds }: { rounds: Clarification[] }) {
  if (!rounds.length) return null;
  return <details className="mt-3 border border-setu-slate-200">
    <summary className="cursor-pointer px-3 py-2 text-xs font-bold">Clarification history ({rounds.length})</summary>
    <ol className="divide-y divide-setu-slate-200 px-3 text-xs">{rounds.map(c => <li key={c.id} className="py-3 space-y-1">
      <p className="font-bold">{c.mode === 'resolve_now' ? 'Resolved directly' : 'Requested response'} · {c.status} · {c.created_at}</p>
      <p>Question: {c.question}</p><p>Response: {c.response || 'Not received'}</p>
      {c.communication_method && <p>Method: {c.communication_method} · Supplied by: {c.supplied_by || c.responded_by_user_id}</p>}
      {c.responded_at && <p>Responded: {c.responded_at} · Submitter: {c.responded_by_user_id}</p>}
      {c.triage_impact && <p>Impact: {impactLabels[c.triage_impact]} · Resolved: {c.resolved_at}</p>}
      {c.triage_note && <p>Planner note: {c.triage_note}</p>}
      {c.cancelled_at && <p>Cancelled: {c.cancelled_at}</p>}
    </li>)}</ol>
  </details>;
}

interface Props {
  update: FieldUpdate; rounds: Clarification[]; proposals: RemapProposal[];
  activities: ScheduleActivity[]; act: WorkflowAction; available: boolean;
  onAccept: (update: FieldUpdate, remarks: string) => Promise<void>;
  onRemap: (update: FieldUpdate) => void;
}

export function WorkflowActions({ update, rounds, proposals, activities, act, available, onAccept, onRemap }: Props) {
  const [mode, setMode] = useState('');
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState('');
  const [supplier, setSupplier] = useState('');
  const [method, setMethod] = useState('');
  const [impact, setImpact] = useState<ClarificationImpact | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const state = workflowState(update, rounds, proposals);
  const proposal = activeProposal(proposals, update.id);
  const round = rounds.find(c => c.field_update_id === update.id && ['open', 'responded'].includes(c.status));
  const base = { p_field_update_id: update.id, p_expected_workflow_revision: update.workflow_revision ?? 0 };
  const proposalBase = { p_proposal_id: proposal?.id, p_expected_workflow_revision: update.workflow_revision ?? 0 };
  const locked = !available || busy;

  async function run(name: string, params: Record<string, unknown>, nextMode = '') {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await act(name, params);
      if (!result.success) { setError(result.error || 'Action failed. Refresh and try again.'); return; }
      setMode(nextMode); setNote('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Action failed.'); }
    finally { setBusy(false); }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'resolve') void run('resolve_field_update_clarification_now', { ...base,
      p_question: question.trim(), p_communication_method: method.trim(), p_response: response.trim(),
      p_supplied_by: supplier.trim(), p_impact: impact });
    if (mode === 'request') void run('request_field_update_clarification', { ...base, p_question: question.trim() });
    if (mode === 'triage' && round) void run('triage_field_update_clarification', {
      p_clarification_id: round.id, p_impact: impact, p_note: note.trim() || null,
      p_expected_workflow_revision: update.workflow_revision ?? 0 });
    if (mode === 'close') void run('close_field_update_as_invalid', { ...base, p_reason: note.trim() });
    if (mode === 'overrideProposal') void run('override_field_update_remap_proposal', { ...proposalBase, p_reason: note.trim() });
    if (mode === 'override') void run('override_field_update_validation', { p_field_update_id: update.id, p_reason: note.trim() });
    if (mode === 'requeue') void run('requeue_field_update', { p_field_update_id: update.id, p_remarks: note.trim() || null });
    if (mode === 'accept') {
      setBusy(true); setError(null);
      void onAccept(update, note.trim()).catch(err => setError(String(err))).finally(() => setBusy(false));
    }
  }

  if (state === 'Finalized') return <p className="border-l-4 border-setu-slate-500 bg-setu-slate-50 px-4 py-3 text-xs">Finalized planner decision. This report is read-only. {update.planner_remarks}</p>;
  return <div className="space-y-3 text-xs">
    {!available && <p role="alert" className="text-rose-900">Workflow data unavailable. Decision controls are locked until it loads.</p>}
    {error && <p role="alert" className="border-l-4 border-rose-500 bg-rose-50 px-3 py-2 text-rose-900">{error}</p>}
    {state === 'Awaiting Field Response' && <p className="border-l-4 border-setu-blue bg-blue-50 px-3 py-3">Awaiting Field Response. The question is available to the original submitter in SETU. Accept and Remap are locked.</p>}
    {round?.status === 'responded' && <div className="border-l-4 border-setu-blue bg-blue-50 px-3 py-3 space-y-2">
      <p className="font-bold">Response Received — planner triage required</p>
      <p>Question: {round.question}</p><p className="font-medium">Response: {round.response}</p>
      <p className="text-[11px]">{round.responded_at} · Received from the original field submitter. Account attribution is retained in clarification history.</p>
      <button disabled={locked} className={buttonClass} onClick={() => { setImpact(''); setMode('triage'); }}>Classify response</button>
    </div>}
    {state === 'Reprocessing Evidence' && <p className="border-l-4 border-amber-500 bg-amber-50 px-3 py-3">Reprocessing Evidence. Current evidence must be validated before acceptance. The worker will process the recorded impact.</p>}
    {state === 'Awaiting AI' && <p className="bg-blue-50 px-3 py-3">Awaiting AI matching and validation.</p>}
    {proposal && <div className="border-l-4 border-setu-blue bg-setu-slate-50 px-3 py-3 space-y-2">
      <p className="font-bold">{state}</p>
      <p>Selected target: <strong>{proposal.target_activity_id}</strong> · {activities.find(a => a.activity_id === proposal.target_activity_id)?.activity_name}</p>
      <p className="text-[11px]">Manual target validation. AI ranking is diagnostic only; no target confidence is assigned.</p>
      {proposal.status === 'pending_validation' && <p>The worker is validating this selected activity. The current report mapping has not changed.</p>}
      {parseValidationResults(proposal.validation_results).map(check => <div key={check.check} className={`border px-2 py-2 ${check.outcome === 'fail' ? 'border-rose-300 bg-rose-50' : 'border-setu-slate-200 bg-white'}`}>
        <strong>{check.name} · {check.outcome}</strong><p>{check.message}</p>
      </div>)}
      {proposal.validation_overridden && <p className="text-rose-900">Exceptional proposal override: {proposal.override_reason}</p>}
      <div className="flex flex-wrap gap-2">
        <button disabled={locked || !proposalReady(proposal, update)} className={buttonClass} onClick={() => void run('finalize_field_update_remap', { ...proposalBase, p_remarks: note.trim() || null })}>Confirm Remap</button>
        <button disabled={locked} className={buttonClass} onClick={() => void run('cancel_field_update_remap_proposal', { ...proposalBase, p_reason: 'Planner cancelled to select another target' })}>Cancel proposal / choose another target</button>
        <button disabled={locked} className={buttonClass} onClick={() => void run('cancel_field_update_remap_proposal', { ...proposalBase, p_reason: 'Planner needs clarification' }, 'clarify')}>Cancel proposal &amp; Clarify</button>
        {proposal.status === 'blocked' && !proposal.validation_overridden && <button disabled={locked} className="text-rose-800 underline disabled:opacity-40" onClick={() => setMode('overrideProposal')}>Exceptional: override selected-target validation</button>}
      </div>
    </div>}
    {!round && !proposal && <div className="flex flex-wrap gap-2">
      <button disabled={locked || !canAccept(update, rounds, proposals)} className="border border-setu-green bg-setu-green px-3 py-2 text-xs font-bold text-white hover:bg-setu-green-dark focus:outline-none focus:ring-2 focus:ring-setu-green/30 disabled:opacity-40" onClick={() => setMode('accept')}>Accept</button>
      <button disabled={locked} className={buttonClass} onClick={() => onRemap(update)}>Remap</button>
      <button disabled={locked} className={buttonClass} onClick={() => setMode('clarify')}>Clarify</button>
    </div>}
    {mode === 'clarify' && <div className="border border-setu-slate-300 px-3 py-3 space-y-2">
      <p className="font-bold">Clarify field evidence</p><p>Record direct coordination now, or ask the original submitter to respond in SETU.</p>
      <div className="flex gap-2"><button disabled={locked} className={buttonClass} onClick={() => { setImpact(''); setMode('resolve'); }}>Resolve Now</button>
        <button disabled={locked || !update.submitted_by_user_id} className={buttonClass} onClick={() => setMode('request')}>Request Response</button></div>
      {!update.submitted_by_user_id && <p>Original submitter unavailable. Use Resolve Now.</p>}
      <button className={buttonClass} onClick={() => setMode('')}>Cancel</button>
    </div>}
    {mode && mode !== 'clarify' && <form onSubmit={submit} className="border border-setu-slate-300 px-3 py-3 space-y-3">
      <p className="font-bold">{{ resolve: 'Resolve Now', request: 'Request Response', triage: 'Classify response', close: 'Close as Invalid', overrideProposal: 'Exceptional selected-target override', override: 'Exceptional validation override', requeue: 'Technical requeue', accept: 'Accept mapping' }[mode]}</p>
      {['resolve', 'request'].includes(mode) && <label className="block">Why is clarification needed?<textarea required aria-label="Clarification question" value={question} onChange={e => setQuestion(e.target.value)} className={inputClass} /></label>}
      {mode === 'resolve' && <>
        <label className="block">Communication method<input required aria-label="Communication method" value={method} onChange={e => setMethod(e.target.value)} className={inputClass} placeholder="Phone, site visit, direct coordination" /></label>
        <label className="block">Clarification received<textarea required aria-label="Clarification received" value={response} onChange={e => setResponse(e.target.value)} className={inputClass} /></label>
        <label className="block">Supplied by<input required aria-label="Supplied by" value={supplier} onChange={e => setSupplier(e.target.value)} className={inputClass} /></label>
      </>}
      {['resolve', 'triage'].includes(mode) && <ImpactSelect value={impact} onChange={setImpact} />}
      {!['resolve', 'request'].includes(mode) && <label className="block">{['close', 'override', 'overrideProposal'].includes(mode) ? 'Reason (required)' : 'Planner note (optional)'}
        <textarea required={['close', 'override', 'overrideProposal'].includes(mode)} aria-label="Planner reason or note" value={note} onChange={e => setNote(e.target.value)} className={inputClass} /></label>}
      {mode.startsWith('override') && <p className="text-rose-900">Exceptional governed action. Failed checks remain recorded. The reason and scope are audited.</p>}
      {mode === 'close' && <p>Terminal decision for duplicate, test, wrong-context or unusable evidence. Stored as rejected; not a mapping correction.</p>}
      <div className="flex gap-2"><button disabled={locked || (['resolve', 'triage'].includes(mode) && !impact)
        || (['resolve', 'request'].includes(mode) && !question.trim())
        || (mode === 'resolve' && (!response.trim() || !method.trim() || !supplier.trim()))
        || (['close', 'override', 'overrideProposal'].includes(mode) && !note.trim())} className={buttonClass} type="submit">{busy ? 'Saving…' : 'Confirm'}</button>
        <button disabled={busy} className={buttonClass} type="button" onClick={() => setMode('')}>Cancel</button></div>
    </form>}
    <details open={more} onToggle={e => setMore(e.currentTarget.open)} className="border-t border-setu-slate-200 pt-3">
      <summary className="cursor-pointer font-bold">More Actions</summary>
      <div className="mt-2 flex flex-wrap gap-3">
        <button disabled={locked} className={buttonClass} onClick={() => setMode('close')}>Close as Invalid</button>
        {!round && !proposal && <button disabled={locked || state === 'Reprocessing Evidence'} className={buttonClass} onClick={() => setMode('requeue')}>Technical Requeue</button>}
        {!round && !proposal && state === 'Validation Blocked' && <button disabled={locked} className="text-rose-800 underline disabled:opacity-40" onClick={() => setMode('override')}>Exceptional: override validation</button>}
      </div>
    </details>
  </div>;
}
