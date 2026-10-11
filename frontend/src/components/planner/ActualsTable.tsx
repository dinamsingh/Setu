import { TriangleAlert } from 'lucide-react';
import { actualsWarnings, type ScheduleActualsRow } from '../../types/actuals';

export function ActualsTable({ rows, loading, error, selectedId, onSelect }: {
  rows: ScheduleActualsRow[]; loading: boolean; error: string | null;
  selectedId: string | null; onSelect: (id: string) => void;
}) {
  if (loading) return <p role="status" className="p-8 text-sm text-setu-slate-600">Loading schedule actuals…</p>;
  if (error) return <p role="alert" className="p-8 text-sm text-red-800">Could not load actuals: {error}. Use Refresh to retry.</p>;
  if (!rows.length) return <p className="p-8 text-sm text-setu-slate-600">No baseline activities available. No approved actuals.</p>;
  return <div className="max-h-[65vh] overflow-auto"><table className="w-full text-left text-xs tabular-nums">
    <caption className="sr-only">Imported baseline and read-only SETU actuals</caption>
    <thead className="sticky top-0 z-10 bg-white">
      <tr className="border-b border-setu-slate-300 text-[10px] uppercase tracking-wider text-setu-slate-500">
        <th rowSpan={2} scope="col" className="px-4 py-3 min-w-56">Activity</th>
        <th colSpan={2} scope="colgroup" className="bg-setu-slate-50 px-4 py-2">Baseline</th>
        <th colSpan={3} scope="colgroup" className="border-l border-setu-slate-300 px-4 py-2 text-setu-blue">SETU actuals</th>
        <th rowSpan={2} scope="col" className="px-4 py-3">Evidence</th>
        <th rowSpan={2} scope="col" className="px-4 py-3 min-w-48">Status</th>
      </tr>
      <tr className="border-b border-setu-slate-300 text-setu-slate-700">
        <th scope="col" className="bg-setu-slate-50 px-4 py-3 whitespace-nowrap">Baseline Start</th>
        <th scope="col" className="bg-setu-slate-50 px-4 py-3 whitespace-nowrap">Baseline Finish</th>
        <th scope="col" className="border-l border-setu-slate-300 px-4 py-3 whitespace-nowrap">SETU Actual Start</th>
        <th scope="col" className="px-4 py-3 whitespace-nowrap">SETU Actual Finish</th>
        <th scope="col" className="px-4 py-3">Progress</th>
      </tr>
    </thead>
    <tbody>{rows.map(row => {
      const warnings = actualsWarnings(row);
      return <tr key={row.activity_id} className={`border-b border-setu-slate-200 align-top ${selectedId === row.activity_id ? 'bg-blue-50' : 'hover:bg-setu-slate-50'}`}>
        <td className="px-4 py-4"><span className="font-bold text-setu-slate-900">{row.activity_id}</span><p className="mt-1 leading-5 text-setu-slate-700">{row.activity_name}</p><p className="mt-1 text-[10px] text-setu-slate-500">{[row.wbs_code, row.discipline].filter(Boolean).join(' · ')}</p></td>
        <td className="bg-setu-slate-50/60 px-4 py-4 whitespace-nowrap">{row.planned_start_date ?? '—'}</td>
        <td className="bg-setu-slate-50/60 px-4 py-4 whitespace-nowrap">{row.planned_finish_date ?? '—'}</td>
        <td className="border-l border-setu-slate-300 px-4 py-4 whitespace-nowrap font-semibold">{row.actual_start ?? '—'}</td>
        <td className="px-4 py-4 whitespace-nowrap font-semibold">{row.actual_finish ?? '—'}</td>
        <td className="px-4 py-4 font-semibold">{row.progress_percent === null ? '—' : `${row.progress_percent}%`}</td>
        <td className="px-4 py-4"><p>{row.contributing_event_count} events</p><p className="mt-1 text-setu-slate-500">{row.contributing_report_count} reports</p>{row.contributing_event_count > 0 && <button type="button" onClick={() => onSelect(row.activity_id)} aria-expanded={selectedId === row.activity_id} className="mt-2 font-semibold text-setu-blue underline underline-offset-4">View evidence</button>}</td>
        <td className="px-4 py-4 text-setu-slate-600">{row.contributing_event_count === 0 ? 'No approved actuals' : warnings.length ? <div className="flex gap-2 text-amber-900"><TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0"/><div><p className="font-semibold">Evidence warnings</p>{warnings.map(w => <p key={w} className="mt-1 leading-5">{w}</p>)}</div></div> : 'Current approved evidence'}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}
