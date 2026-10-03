import { useState } from 'react';
import type { FieldUpdate } from '../../types';
import type { Clarification } from '../../types/workflow';
import { addressedRequests } from '../../lib/workflow';
import type { WorkflowAction } from '../planner/WorkflowActions';

export function NeedsClarification({ rounds, updates, userId, act, available }: {
  rounds: Clarification[]; updates: FieldUpdate[]; userId: string; act: WorkflowAction; available: boolean;
}) {
  const addressed = addressedRequests(rounds, userId);
  return <section className="mb-6 border border-setu-slate-300 bg-white">
    <header className="border-l-4 border-setu-teal bg-setu-slate-50 px-4 py-3">
      <h2 className="text-sm font-bold text-setu-navy">Needs Clarification</h2>
      <p className="mt-1 text-xs text-setu-slate-600">Planner questions about your reports. Original submissions stay unchanged.</p>
    </header>
    {!available && <p role="alert" className="p-4 text-xs text-rose-900">Clarification data unavailable. Refresh to try again.</p>}
    {available && !addressed.length && <p className="p-4 text-xs text-setu-slate-500">No clarification requests addressed to you.</p>}
    <div className="divide-y divide-setu-slate-200">{addressed.map(c => <FieldResponse key={c.id} clarification={c}
      update={updates.find(u => u.id === c.field_update_id)} act={act} available={available} />)}</div>
  </section>;
}

function FieldResponse({ clarification: c, update, act, available }: {
  clarification: Clarification; update?: FieldUpdate; act: WorkflowAction; available: boolean;
}) {
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!response.trim() || busy || c.status !== 'open' || sent || !update) return;
    setBusy(true); setError(null);
    try {
      const result = await act('respond_to_field_update_clarification', { p_clarification_id: c.id,
        p_response: response.trim(), p_expected_workflow_revision: update.workflow_revision ?? 0 });
      if (result.success) setSent(true);
      else setError(result.error || 'Response failed. Try again.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Response failed.'); }
    finally { setBusy(false); }
  }
  return <article className="space-y-2 px-4 py-4 text-xs">
    <p className="font-bold">{update?.update_id || 'Original report'} · {c.created_at} · {c.status}</p>
    <blockquote className="border-l-2 border-setu-slate-300 pl-3 text-setu-slate-600">{update?.field_text || 'Original evidence unavailable'}</blockquote>
    <p className="font-semibold">Planner question: {c.question}</p>
    {error && <p role="alert" className="bg-rose-50 px-3 py-2 text-rose-900">{error}</p>}
    {c.status === 'open' && !sent ? <form onSubmit={submit} className="space-y-2">
      <label className="block font-bold">Your response<textarea required aria-label={`Response for ${update?.update_id || c.id}`}
        value={response} onChange={e => setResponse(e.target.value)} rows={3}
        className="mt-1 w-full border border-setu-slate-300 px-3 py-2 font-normal focus:outline-none focus:ring-2 focus:ring-setu-teal/30" /></label>
      <button disabled={busy || !available || !update || update.status !== 'pending' || !response.trim()} type="submit"
        className="bg-setu-teal px-3 py-2 font-bold text-white focus:outline-none focus:ring-2 focus:ring-setu-teal/30 disabled:opacity-40">{busy ? 'Sending response…' : 'Submit Response'}</button>
    </form> : <div className="bg-setu-slate-50 px-3 py-2">
      <p>{c.response || response}</p><p className="mt-1 font-bold">{c.status === 'responded' || sent ? 'Response sent / awaiting planner review' : `Read-only · ${c.status}`}</p>
    </div>}
  </article>;
}
