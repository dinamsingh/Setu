import './PlannerV2.css';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Header } from '../../components/common/Header';
import { Sidebar } from '../../components/common/Sidebar';
import { ActualsTable } from '../../components/planner/ActualsTable';
import { ActualsEvidencePanel } from '../../components/planner/ActualsEvidencePanel';
import { useScheduleActuals } from '../../hooks/useScheduleActuals';

export function ScheduleActuals() {
  const { rows, loading, error, refetch } = useScheduleActuals();
  const [selection, setSelection] = useState<string | null>(null);
  const selected = rows.find(row => row.activity_id === selection);
  const selectedId = selected?.activity_id;
  const evidenceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedId) evidenceRef.current?.scrollIntoView?.({ block: 'start' });
  }, [selectedId]);
  function refresh() { setSelection(null); refetch(); }
  return <div className="setu-planner-v2 setu-planner-v2--schedule-actuals min-h-screen bg-setu-slate-100 flex flex-col">
    <Header currentRole="planner"/>
    <div className="flex-1 flex flex-col md:flex-row"><Sidebar/>
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-[100rem]">
        <section className="flex flex-wrap items-start justify-between gap-4 border-l-4 border-setu-blue bg-white px-5 py-5 sm:px-6 shadow-xs">
          <div><p className="text-xs font-semibold tracking-[0.14em] text-setu-blue uppercase">Schedule control · read-only</p><h1 className="mt-1 text-2xl font-extrabold tracking-tight text-setu-slate-900">Schedule Actuals</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-setu-slate-600">SETU actuals overlay — derived from current planner-approved evidence. Imported baseline unchanged.</p></div>
          <button type="button" onClick={refresh} disabled={loading} className="inline-flex items-center gap-2 border border-setu-slate-300 px-4 py-2.5 text-xs font-bold text-setu-slate-700 hover:bg-setu-slate-50 disabled:opacity-50"><RefreshCw className="h-4 w-4"/>Refresh</button>
        </section>
        <section aria-label="Schedule actuals overlay" className="mt-5 border border-setu-slate-200 bg-white">
          <div className="flex flex-wrap justify-between gap-2 border-b border-setu-slate-200 px-4 py-3 text-xs text-setu-slate-600"><p>Explicit START / FINISH dates. Latest chronological PROGRESS.</p><p>Warnings disclose conflicts; evidence is never repaired here.</p></div>
          <ActualsTable rows={rows} loading={loading} error={error} selectedId={selection} onSelect={id => setSelection(previous => previous === id ? null : id)}/>
        </section>
        {selected && !loading && !error && <div ref={evidenceRef}><ActualsEvidencePanel key={selected.activity_id} row={selected} onClose={() => setSelection(null)}/></div>}
        <p className="mt-4 text-xs leading-5 text-setu-slate-500">Live views on entry or Refresh. Legacy decisions without current governance are excluded. No baseline updates or Primavera writeback.</p>
      </main>
    </div>
  </div>;
}
