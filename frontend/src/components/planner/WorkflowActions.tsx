import { useState } from 'react';
import type { FieldUpdate, ScheduleActivity } from '../../types';
import type { Clarification, ClarificationImpact, RemapProposal, WorkflowResult } from '../../types/workflow';
import { activeProposal, impactLabels, proposalReady, workflowState } from '../../lib/workflow';
import { parseValidationResults } from '../../lib/utils';
import { reviewStage } from '../../lib/guidedReview';
import type { ProgressEvent } from '../../types/progressEvents';

export type WorkflowAction = (name: string, params: Record<string, unknown>) => Promise<WorkflowResult>;
const inputClass = 'mt-1 w-full border border-setu-slate-300 bg-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-setu-blue/30';
const buttonClass = 'border border-setu-slate-300 rounded-lg px-4 py-2.5 text-[13px] font-bold hover:bg-setu-slate-50 focus:outline-none focus:ring-2 focus:ring-setu-blue/30 disabled:opacity-40';
const primaryClass = 'bg-setu-navy rounded-lg px-4 py-2.5 text-[13px] font-bold text-white hover:bg-setu-blue focus:outline-none focus:ring-2 focus:ring-setu-teal disabled:opacity-40';

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
  const [expanded, setExpanded] = useState(false);
  if (!rounds.length) return null;
  return <details open={expanded} onToggle={e => setExpanded(e.currentTarget.open)} className="mt-3 border border-setu-slate-200">
    <summary aria-expanded={expanded} className="cursor-pointer px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-inset focus:ring-setu-blue/30">Clarification history ({rounds.length})</summary>
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
  onRemap: (update: FieldUpdate) => void;
  progressEvents?: ProgressEvent[];
  progressEventsLoading?: boolean;
  progressEventsError?: string | null;
  onDecisionStart?: () => void;
}

export function WorkflowActions({ update, rounds, proposals, activities, act, available, onRemap,
  progressEvents = [], progressEventsLoading = false, progressEventsError = null, onDecisionStart }: Props) {
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
  const processing = state === 'Awaiting AI' || state === 'Reprocessing Evidence';
  const activity = activities.find(a => a.activity_id === update.matched_activity_id);
  const stage = reviewStage(update, rounds, proposals, activity, available);
  const blocked = update.validation_status === 'block' && !stage.currentOverride;
  const currentEvents = !progressEventsLoading && !progressEventsError
    && update.progress_extraction_revision === (update.evidence_revision ?? 0)
    ? progressEvents.filter(e => e.field_update_id === update.id && e.evidence_revision === (update.evidence_revision ?? 0)) : [];

  async function run(name: string, params: Record<string, unknown>, nextMode = '') {
    if (busy) return;
    setBusy(true); setError(null);
    // Pin selection before the existing refresh removes this row from the queue.
    // Completion still derives only from the refreshed terminal report.
    if (['accept_current_field_update', 'finalize_field_update_remap', 'close_field_update_as_invalid'].includes(name)) onDecisionStart?.();
    try {
      const result = await act(name, params);
      if (!result.success) { setError(result.error || 'Action failed. Refresh and try again.'); return; }
      setMode(nextMode); setNote('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Action failed.'); }
    finally { setBusy(false); }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked || (processing && mode !== 'close')) return;
    if (mode === 'resolve') void run('resolve_field_update_clarification_now', { ...base,
      p_question: question.trim(), p_communication_method: method.trim(), p_response: response.trim(),
      p_supplied_by: supplier.trim(), p_impact: impact });
    if (mode === 'request') void run('request_field_update_clarification', { ...base, p_question: question.trim() });
    if (mode === 'triage' && round) void run('triage_field_update_clarification', {
      p_clarification_id: round.id, p_impact: impact, p_note: note.trim() || null,
      p_expected_workflow_revision: update.workflow_revision ?? 0 });
    if (mode === 'close') void run('close_field_update_as_invalid', { ...base, p_reason: note.trim() });
    if (mode === 'overrideProposal') void run('override_field_update_remap_proposal', { ...proposalBase, p_reason: note.trim() });
    // Polling may advance the report while a form is open. Do not submit normal
    // actions during processing; the server also checks the displayed revision.
    if (mode === 'override') void run('override_current_field_update_validation', { ...base, p_reason: note.trim() });
    if (mode === 'requeue') void run('requeue_current_field_update', { ...base, p_remarks: note.trim() || null });
    if (mode === 'accept' && stage.canApprove) void run('accept_current_field_update', { ...base, p_remarks: note.trim() || null });
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
      {!mode && <button disabled={locked} className={primaryClass} onClick={() => { setImpact(''); setMode('triage'); }}>Classify response</button>}
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
        {!mode && <button disabled={locked || !proposalReady(proposal, update)} className={proposalReady(proposal, update) ? primaryClass : buttonClass} onClick={() => void run('finalize_field_update_remap', { ...proposalBase, p_remarks: null })}>Confirm Remap</button>}
        <button disabled={locked} className={buttonClass} onClick={() => void run('cancel_field_update_remap_proposal', { ...proposalBase, p_reason: 'Planner cancelled to select another target' })}>Cancel proposal / choose another target</button>
        <button disabled={locked} className={buttonClass} onClick={() => void run('cancel_field_update_remap_proposal', { ...proposalBase, p_reason: 'Planner needs clarification' }, 'clarify')}>Cancel proposal &amp; Clarify</button>
        {proposal.status === 'blocked' && !proposalReady(proposal, update) && !mode && <button disabled={locked} className={primaryClass} onClick={() => { setNote(''); setMode('overrideProposal'); }}>Resolve selected-target validation</button>}
      </div>
    </div>}
    {!round && !proposal && !processing && !mode && <div className="space-y-2">
      {!stage.canApprove && !blocked && <p className="text-setu-slate-600">No reviewable mapping is ready for acceptance. Choose an activity or clarify the evidence.</p>}
      <div className="flex flex-wrap gap-2">
      {blocked ? <button disabled={locked} className={primaryClass} onClick={() => { setNote(''); setMode('override'); }}>Resolve validation issue</button>
        : stage.canApprove && <button disabled={locked} className={primaryClass} onClick={() => { setNote(''); setMode('accept'); }}>Accept suggested mapping</button>}
      <button disabled={locked} className={!blocked && !stage.canApprove ? primaryClass : buttonClass} onClick={() => onRemap(update)}>Choose different activity</button>
      <button disabled={locked} className="px-3 py-2 font-semibold text-setu-blue hover:underline focus:outline-none focus:ring-2 focus:ring-setu-blue/30 disabled:opacity-40" onClick={() => setMode('clarify')}>Ask for clarification</button>
      </div>
    </div>}
    {mode === 'clarify' && !processing && <div className="border border-setu-slate-300 px-3 py-3 space-y-2">
      <p className="font-bold">Clarify field evidence</p><p>Record direct coordination now, or ask the original submitter to respond in SETU.</p>
      <div className="flex gap-2"><button disabled={locked} className={primaryClass} onClick={() => { setImpact(''); setMode('resolve'); }}>Resolve Now</button>
        <button disabled={locked || !update.submitted_by_user_id} className={buttonClass} onClick={() => setMode('request')}>Request Response</button></div>
      {!update.submitted_by_user_id && <p>Original submitter unavailable. Use Resolve Now.</p>}
      <button className={buttonClass} onClick={() => setMode('')}>Cancel</button>
    </div>}
    {mode && mode !== 'clarify' && (!processing || mode === 'close') && <form onSubmit={submit} className="border border-setu-slate-300 px-3 py-3 space-y-3">
      <p className="font-bold">{{ resolve: 'Resolve Now', request: 'Request Response', triage: 'Classify response', close: 'Close as invalid', overrideProposal: 'Exceptional selected-target override', override: 'Exceptional validation override', requeue: 'Technical requeue', accept: 'Accept mapping' }[mode]}</p>
      {mode === 'accept' && <div className="border-l-2 border-setu-teal bg-setu-slate-50 px-3 py-3 space-y-2">
        <p className="font-bold">{activity?.activity_id} · {activity?.activity_name}</p>
        <p>Extracted evidence for this report:</p>
        {currentEvents.length ? <ul className="space-y-1">{currentEvents.map(event => <li key={event.id}>
          <strong>{event.event_type}</strong>{event.event_type === 'PROGRESS' ? ` · ${event.progress_percent}%` : ''}
          {' · '}{event.event_date || (event.event_type === 'UNKNOWN' ? 'Needs planner interpretation' : 'Date not resolved')}
        </li>)}</ul> : <p>Current structured events are not available. No actual date or percentage is inferred.</p>}
        {stage.currentOverride && <p className="font-semibold">Governed validation exception: {update.override_reason}</p>}
        <p>This records the planner decision. Approved evidence can contribute to SETU Schedule Actuals.</p>
      </div>}
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
        || (['close', 'override', 'overrideProposal'].includes(mode) && !note.trim())
        || (mode === 'accept' && !stage.canApprove)} className={primaryClass} type="submit">{busy ? 'Saving…' : mode === 'accept' ? 'Approve field update' : 'Confirm'}</button>
        <button disabled={busy} className={buttonClass} type="button" onClick={() => setMode('')}>Cancel</button></div>
    </form>}
    <details open={more} onToggle={e => setMore(e.currentTarget.open)} className="border-t border-setu-slate-200 pt-3">
      <summary aria-expanded={more} className="cursor-pointer font-bold focus:outline-none focus:ring-2 focus:ring-setu-blue/30">More Actions</summary>
      <div className="mt-2 flex flex-wrap gap-3">
        <button disabled={locked} className={buttonClass} onClick={() => setMode('close')}>Close as invalid</button>
        {!round && !proposal && !processing && <button disabled={locked} className={buttonClass} onClick={() => setMode('requeue')}>Technical requeue</button>}
      </div>
    </details>
  </div>;
}
