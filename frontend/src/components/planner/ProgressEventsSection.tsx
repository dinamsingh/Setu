import type { FieldUpdate } from '../../types';
import type { ProgressEvent } from '../../types/progressEvents';

export function ProgressEventsSection({ update, events = [], loading = false, error = null, onRetry }: {
  update: FieldUpdate; events?: ProgressEvent[]; loading?: boolean; error?: string | null;
  onRetry?: () => void;
}) {
  const revision = update.evidence_revision ?? 0;
  const completed = update.progress_extraction_revision === revision;
  const current = events.filter(e => e.field_update_id === update.id && e.evidence_revision === revision)
    .sort((a, b) => a.event_index - b.event_index);
  const formatDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
  return <div className="mt-4 border-t border-setu-slate-200 pt-4" aria-label="Progress Events">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-xs font-bold text-setu-navy">Progress Events</h3>
      <span className="font-mono text-[10px] text-setu-slate-500">Evidence revision {revision}</span>
    </div>
    <p className="mt-1 text-[11px] leading-5 text-setu-slate-600">
      Machine-extracted evidence. Not planner approval; no schedule dates or progress have been updated.
    </p>
    {!completed ? <p className="mt-2 text-xs text-setu-slate-600" role="status">Awaiting structured progress extraction.</p>
      : loading ? <p className="mt-2 text-xs text-setu-slate-600" role="status">Loading structured progress.</p>
      : error ? <p className="mt-2 text-xs text-rose-800" role="alert">Progress events could not load: {error}</p>
      : current.length === 0 ? <p className="mt-2 text-xs text-setu-slate-600">Structured progress is unavailable. Refresh this report.</p>
      : <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {current.map(event => <div key={event.id} className="border border-setu-slate-200 bg-setu-slate-50 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-bold text-setu-navy">{event.event_type}</span>
            {event.event_type === 'PROGRESS' && <span className="font-mono text-sm font-semibold text-setu-navy">{event.progress_percent}%</span>}
          </div>
          <p className="mt-1 text-xs text-setu-slate-700">{event.event_type === 'UNKNOWN' ? 'Needs planner interpretation'
            : event.event_date ? formatDate(event.event_date) : 'Date not resolved'}</p>
          <details className="mt-2 text-[11px] text-setu-slate-600">
            <summary className="cursor-pointer font-semibold focus:outline-none focus:ring-2 focus:ring-setu-blue/30">Evidence and rule</summary>
            <blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-setu-slate-300 pl-2 leading-5">{event.evidence_text}</blockquote>
            <p className="mt-2 leading-5">{event.extraction_reason}</p>
            <p className="mt-1 font-mono text-[10px]">{event.extraction_version}</p>
          </details>
        </div>)}
      </div>}
    {completed && !loading && (error || current.length === 0) && onRetry && <button type="button" onClick={onRetry}
      className="mt-2 text-xs font-semibold text-setu-blue underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-setu-blue/30">Retry loading progress events</button>}
  </div>;
}
