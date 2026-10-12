import { useEffect, useRef, useState } from 'react';
import { isFieldReportImportEnabled } from '../../lib/fieldReportImportDeployment';
import { prepareFieldReportImport, submitFieldReportImport, type ImportRequest, type ImportResult } from '../../lib/fieldReportImport';
import type { IntakeResult } from '../../lib/fieldReportIntake';

const button = 'min-h-11 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40';
export interface ImportSubmitter { id: string; role: string | null }
export function ReportImportConfirmation({ preview, submitter, onLockChange, onCompleted }: {
  preview: IntakeResult; submitter?: ImportSubmitter; onLockChange: (locked: boolean) => void; onCompleted?: () => void;
}) {
  const [request, setRequest] = useState<ImportRequest | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [sending, setSending] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [prepareError, setPrepareError] = useState('');
  const [requestActorId, setRequestActorId] = useState<string | null>(null);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const enabled = isFieldReportImportEnabled();
  const authorized = !!submitter?.id && ['site', 'engineer'].includes(submitter.role ?? '');
  const uncertain = result?.kind === 'uncertain';
  const completed = result?.kind === 'completed';
  // Freeze the preview from confirmation until the request has a definitive result.
  useEffect(() => { onLockChange(!!request); return () => onLockChange(false); }, [request, onLockChange]);
  useEffect(() => { if (request) heading.current?.focus(); }, [request, result]);
  useEffect(() => {
    if (!sending && !uncertain) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [sending, uncertain]);
  function reviewConfirmation() {
    try {
      const next = prepareFieldReportImport(preview);
      setRequestActorId(submitter?.id ?? null); setRequest(next); setResult(null); setAcknowledged(false); setPrepareError('');
    } catch (error) { setPrepareError(error instanceof Error ? error.message : 'Return to review and check every row.'); }
  }
  async function send() {
    if (!request || !acknowledged || !enabled || !authorized || requestActorId !== submitter?.id || inFlight.current || completed) return;
    inFlight.current = true; setSending(true);
    const response = await submitFieldReportImport(request);
    setResult(response); setSending(false); inFlight.current = false;
    if (response.kind === 'completed') onCompleted?.();
  }
  function returnToReview() { if (sending || uncertain) return; setRequest(null); setResult(null); setAcknowledged(false); }
  return <section aria-label="Import confirmation" className="mt-6 rounded-2xl border border-blue-200 bg-[#EAF2FC] p-5 sm:p-7">
    <h2 ref={heading} tabIndex={-1} className="text-lg font-bold text-[#123F77] outline-none">{completed ? 'Import verified by SETU' : request ? 'Confirm these field reports' : 'Ready for secure import'}</h2>
    {!enabled && <p role="status" className="mt-2 text-sm leading-6 text-slate-600">Submission locked. Migrations 012 and 013 must be independently verified and explicitly enabled. {request ? 'This request may already have been sent; the gate does not cancel it.' : 'Nothing has been uploaded, saved or sent for matching.'}</p>}
    {enabled && !authorized && <p role="alert" className="mt-2 text-sm text-amber-900">Sign in as a site supervisor or field engineer to import.</p>}
    <p className="mt-2 text-sm leading-6 text-slate-600">{request ? request.rows.length : preview.rows.length} reports. Every row is checked again by the server. Existing identical reports are counted as duplicates, not overwritten. Import does not approve progress or change the baseline schedule.</p>
    {!request && <>
      {!preview.valid && <p className="mt-2 text-sm font-semibold text-amber-900">Correct all invalid and duplicate rows first. No rows will be silently skipped.</p>}
      {prepareError && <p role="alert" className="mt-2 text-sm text-rose-800">{prepareError}</p>}
      <button type="button" disabled={!enabled || !authorized || !preview.valid} onClick={reviewConfirmation} className={`${button} mt-4 bg-[#123F77] text-white`}>Continue to confirmation</button>
    </>}
    {request && <>
      <p className="mt-3 break-all font-mono text-xs text-slate-500">Request: {request.requestId}</p>
      {!result || result.kind === 'error' || result.kind === 'disabled' || uncertain ? <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-[#112344]">
        <input type="checkbox" checked={acknowledged} disabled={sending || uncertain} onChange={e => setAcknowledged(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#123F77]" />
        I confirm these {request.rows.length} reports are ready for the matching and planner review queue.
      </label> : null}
      {result && 'summary' in result && <div role={completed ? 'status' : 'alert'} aria-live="polite" className={`mt-4 rounded-xl border p-4 ${completed ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
        <p className="font-semibold">{completed ? `${result.summary.imported_count} imported · ${result.summary.duplicate_count} duplicate · 0 errors` : `Batch rejected · 0 imported · ${result.summary.error_count} invalid rows`}</p>
        <p className="mt-2 text-sm">{completed ? 'Imported reports await AI matching and human planner review. Duplicates keep their existing state.' : 'No reports from this batch were saved. Return to review and correct the reported rows.'}</p>
        {result.summary.replayed && <p className="mt-2 text-sm">Retry confirmed: no additional reports were created.</p>}
        {!!result.summary.errors.length && <ul className="mt-2 max-h-64 overflow-auto text-sm">{result.summary.errors.map((e, i) => <li key={i}>Row {e.row_number}{e.field ? ` · ${e.field}` : ''}: {e.message}</li>)}</ul>}
        {completed && <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">View report outcomes</summary><ul className="mt-2 max-h-64 overflow-auto">{result.summary.rows.map(r => <li key={r.row_number}>Row {r.row_number} · {r.outcome} · {r.update_id}</li>)}</ul></details>}
      </div>}
      {result && 'message' in result && <div role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900"><p className="font-semibold">{uncertain ? 'Outcome unknown — not confirmed' : result.kind === 'disabled' ? 'Submission locked' : 'Request rejected by the server'}</p><p>{result.message}</p>{uncertain && <p>Keep this screen open. The rows and request ID stay unchanged for retry.</p>}</div>}
      {requestActorId !== submitter?.id && <p role="alert" className="mt-3 text-sm text-rose-800">The signed-in account changed. Do not retry under another account.</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        {!completed && result?.kind !== 'rejected' && <button type="button" disabled={sending || !enabled || !authorized || !acknowledged || requestActorId !== submitter?.id} onClick={() => void send()} className={`${button} bg-[#123F77] text-white`}>{sending ? 'Submitting reports…' : result ? 'Retry same request' : 'Confirm import'}</button>}
        <button type="button" disabled={sending || uncertain} onClick={returnToReview} className={`${button} bg-white text-[#123F77]`}>{completed ? 'Close summary' : result ? 'Return to review' : 'Cancel confirmation'}</button>
      </div>
    </>}
  </section>;
}
