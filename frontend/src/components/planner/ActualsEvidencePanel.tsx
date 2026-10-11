import { TriangleAlert, X } from 'lucide-react';
import { useActualsEvidence } from '../../hooks/useActualsEvidence';
import { actualsWarnings, type ScheduleActualsRow } from '../../types/actuals';

export function ActualsEvidencePanel({ row, onClose }: { row: ScheduleActualsRow; onClose: () => void }) {
  const { events, loading, error, page, hasMore, next, previous, refetch } = useActualsEvidence(row.activity_id);
  const selected = [row.selected_start_event_id, row.selected_finish_event_id, row.selected_progress_event_id];
  const warnings = actualsWarnings(row);
  return <section aria-label={`Evidence for ${row.activity_id}`} className="mt-5 border border-setu-slate-300 bg-white">
    <div className="flex items-start justify-between gap-4 border-b border-setu-slate-200 px-5 py-4">
      <div><p className="text-[10px] font-bold uppercase tracking-wider text-setu-blue">Read-only provenance</p><h2 className="mt-1 text-lg font-bold">{row.activity_id} · {row.activity_name}</h2><p className="mt-1 text-xs text-setu-slate-500">{row.contributing_event_count} eligible events from {row.contributing_report_count} reports. Source selection is calculated by the database.</p></div>
      <button onClick={onClose} type="button" aria-label="Close evidence" className="p-2 text-setu-slate-600 hover:bg-setu-slate-100"><X className="h-5 w-5"/></button>
    </div>
    <div className="px-5 py-4">
      {warnings.length > 0 && <div className="mb-4 flex gap-2 border-l-4 border-setu-amber bg-amber-50 p-3 text-xs text-amber-950"><TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true"/><div>{warnings.map(w => <p key={w}>{w}</p>)}</div></div>}
      <p className="mb-4 break-all text-xs text-setu-slate-600">Selected sources — START: {row.selected_start_event_id ?? 'not dated'}; FINISH: {row.selected_finish_event_id ?? 'not dated'}; PROGRESS: {row.selected_progress_event_id ?? 'unresolved'}.</p>
      {loading ? <p role="status">Loading evidence…</p> : error ? <div role="alert">Could not load evidence: {error}. <button type="button" onClick={refetch} className="text-setu-blue underline">Retry evidence</button></div> : !events.length ? <p>No current eligible evidence returned. Refresh the overlay if the source state changed.</p> : events.map(event => <article key={event.event_id} className="border-t border-setu-slate-200 py-4">
        <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-bold text-setu-blue">{event.event_type}</span><span className="font-semibold tabular-nums">{event.event_date ?? 'Date unresolved'}{event.progress_percent !== null ? ` · ${event.progress_percent}%` : ''}</span>{selected.includes(event.event_id) && <span className="border border-setu-blue/30 px-2 py-0.5 font-bold text-setu-blue">Selected source</span>}</div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{event.evidence_text}</p>
        <p className="mt-2 text-xs leading-5 text-setu-slate-600">Extraction: {event.extraction_reason}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs text-setu-slate-600 sm:grid-cols-2">
          <div><dt className="font-semibold">Report / revision</dt><dd className="break-all">{event.update_id ?? event.field_update_id} · evidence revision {event.evidence_revision}<br/>{event.field_update_id}</dd></div>
          <div><dt className="font-semibold">Reported / received</dt><dd>{event.reported_date ?? 'Unresolved'} / {event.report_created_at ?? 'Unavailable'}</dd></div>
          <div><dt className="font-semibold">Governed decision</dt><dd>{event.decision_action} · {event.decision_at ?? 'Unavailable'}</dd></div>
          <div><dt className="font-semibold">Authoritative actor user ID</dt><dd className="break-all">{event.decision_actor_user_id}</dd>{event.planner_display_label && <dd>{event.planner_display_label} (display label only)</dd>}</div>
          <div><dt className="font-semibold">Audit / proposal</dt><dd className="break-all">{event.decision_audit_id}<br/>{event.finalized_remap_proposal_id ?? 'No remap proposal'}</dd></div>
          <div><dt className="font-semibold">Event / extraction</dt><dd className="break-all">{event.event_id}<br/>{event.extraction_version} · {event.extraction_created_at ?? 'Unavailable'}</dd></div>
          <div><dt className="font-semibold">Progress chronology only</dt><dd>{event.chronology_date ?? 'Unresolved'} · {event.chronology_basis}; not an inferred START/FINISH date.</dd></div>
        </dl>
      </article>)}
      <div className="mt-3 flex items-center gap-4 text-xs"><button type="button" disabled={page === 0 || loading} onClick={previous} className="text-setu-blue disabled:text-setu-slate-400">Previous evidence</button><span>Page {page + 1}</span><button type="button" disabled={!hasMore || loading} onClick={next} className="text-setu-blue disabled:text-setu-slate-400">Next evidence</button></div>
    </div>
  </section>;
}
