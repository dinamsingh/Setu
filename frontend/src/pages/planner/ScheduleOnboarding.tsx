import React, { useState } from 'react';
import { 
  UploadCloud, 
  CheckCircle2, 
  AlertCircle, 
  Database, 
  Search,
  ShieldCheck
} from 'lucide-react';
import Papa from 'papaparse';
import { Header } from '../../components/common/Header';
import { Sidebar } from '../../components/common/Sidebar';
import { useScheduleData } from '../../hooks/useScheduleData';

export const ScheduleOnboarding: React.FC = () => {
  const { activities, disciplines, loading, error } = useScheduleData();
  const [searchTerm, setSearchTerm] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [isValidated, setIsValidated] = useState(false);

  const requiredColumns = [
    'activity_id',
    'activity_name',
    'wbs_code',
    'discipline',
    'planned_start_date',
    'planned_finish_date',
  ];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);
    setValidationErrors([]);
    setIsValidated(false);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields || [];
        const missing = requiredColumns.filter((col) => !headers.includes(col));

        if (missing.length > 0) {
          setValidationErrors([
            `Missing mandatory Primavera columns: ${missing.join(', ')}`,
          ]);
          setPreviewRows([]);
          setIsValidated(false);
        } else {
          setValidationErrors([]);
          setPreviewRows(results.data.slice(0, 5));
          setIsValidated(true);
        }
      },
      error: (err) => {
        setValidationErrors([`CSV Parsing Error: ${err.message}`]);
      },
    });
  };

  const filteredActivities = activities.filter(
    (a) =>
      a.activity_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.activity_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.discipline.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-setu-slate-100 flex flex-col">
      <Header currentRole="planner" />

      <div className="flex-1 flex flex-col md:flex-row">
        <Sidebar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl">
          {/* Header Banner */}
          <div className="bg-white rounded-2xl border border-setu-slate-200 p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center space-x-2 text-xs font-bold text-setu-blue uppercase tracking-wider">
                  <Database className="w-4 h-4" />
                  <span>Primavera-Style Baseline CSV Review</span>
                </div>
                <h1 className="text-2xl font-extrabold text-setu-slate-900 mt-1">
                  Schedule Baseline Onboarding
                </h1>
                <p className="text-xs text-setu-slate-500 mt-1">
                  Inspect the active schedule index and preview the required structure of a local CSV.
                </p>
              </div>

              <div className={`flex items-center space-x-2 text-xs px-3 py-1.5 rounded-lg font-semibold self-start sm:self-center border ${
                error
                  ? 'text-rose-800 bg-rose-50 border-rose-200'
                  : loading
                  ? 'text-setu-slate-700 bg-setu-slate-50 border-setu-slate-200'
                  : 'text-emerald-800 bg-emerald-50 border-emerald-200'
              }`}>
                {error ? <AlertCircle className="w-4 h-4 text-rose-600" /> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                  <span>
                    {loading ? 'Checking baseline...' : error ? 'Baseline unavailable' : `${activities.length} activities loaded`}
                  </span>
              </div>
            </div>
          </div>

          {/* Architecture Trust & Scope Note */}
          <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-blue-950 space-y-1.5">
            <div className="flex items-center space-x-2 font-bold">
              <ShieldCheck className="w-4 h-4 text-setu-blue" />
              <span>Read-Only Governance Boundary</span>
            </div>
            <p className="text-blue-900 leading-relaxed">
              <strong>SETU indexes the baseline schedule; it does not modify Primavera directly.</strong> All updates are verified separately in the Planner Review Queue before a schedule diff export is generated for planner upload.
            </p>
            <div className="pt-1 text-[11px] text-blue-800 italic">
              Live prototype: Primavera-style CSV ingestion. Deployment extension: Direct XER / XML parser integration.
            </div>
          </div>

          {/* Active Baseline Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-white border border-setu-slate-200">
              <span className="text-xs font-bold uppercase tracking-wider text-setu-slate-400">Indexed Tasks</span>
              <div className="text-2xl font-extrabold text-setu-navy mt-1">{loading ? '-' : activities.length}</div>
              <p className="text-[11px] text-setu-slate-500 mt-0.5">L5 / L6 Primavera Activities</p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-setu-slate-200">
              <span className="text-xs font-bold uppercase tracking-wider text-setu-slate-400">Disciplines</span>
              <div className="text-2xl font-extrabold text-setu-teal mt-1">{loading ? '-' : disciplines.length}</div>
              <p className="text-[11px] text-setu-slate-500 mt-0.5">Piping, Civil, Pipeline, etc.</p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-setu-slate-200">
              <span className="text-xs font-bold uppercase tracking-wider text-setu-slate-400">Embedding Schema</span>
              <div className="text-2xl font-extrabold text-setu-green mt-1">384-dim</div>
              <p className="text-[11px] text-setu-slate-500 mt-0.5">Configured vector dimension</p>
            </div>
            <div className="p-4 rounded-xl bg-white border border-setu-slate-200">
              <span className="text-xs font-bold uppercase tracking-wider text-setu-slate-400">Baseline Status</span>
              <div className="text-2xl font-extrabold text-setu-blue mt-1">Locked</div>
              <p className="text-[11px] text-setu-slate-500 mt-0.5">Read-only protection active</p>
            </div>
          </div>

          {/* Upload & Validation Staging Area */}
          <div className="bg-white rounded-xl border border-setu-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-setu-slate-800">
                   Validate Schedule CSV (Preview Only)
                </h3>
                <p className="text-xs text-setu-slate-500 mt-0.5">
                   Select a local CSV to validate required columns and preview its activity structure. This phase does not import or commit the file.
                </p>
              </div>
            </div>

            {/* Local file selection zone */}
            <div className="border-2 border-dashed border-setu-slate-300 hover:border-setu-blue rounded-xl p-8 text-center transition-colors bg-setu-slate-50/50">
              <UploadCloud className="w-10 h-10 text-setu-slate-400 mx-auto mb-2" />
              <p className="text-xs font-bold text-setu-slate-700">
                 Select a Primavera-style schedule CSV for local schema preview
              </p>
              <p className="text-[11px] text-setu-slate-500 mt-1">
                 The selected file remains a browser preview; no baseline records are written.
              </p>

              <label className="mt-4 inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-white border border-setu-slate-300 text-xs font-semibold text-setu-slate-700 hover:bg-setu-slate-50 cursor-pointer shadow-2xs">
                <span>Select Local File</span>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {uploadedFileName && (
                <div className="mt-3 text-xs font-mono text-setu-blue font-bold">
                  Selected: {uploadedFileName}
                </div>
              )}
            </div>

            {/* Validation Feedback */}
            {validationErrors.length > 0 && (
              <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Schema Validation Error:</span>
                  <ul className="list-disc list-inside mt-0.5">
                    {validationErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {isValidated && (
              <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-2">
                <div className="flex items-center space-x-1.5 font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Required columns detected. Preview is available below; no import has occurred.</span>
                </div>
                {previewRows.length > 0 && (
                  <div className="overflow-x-auto pt-1">
                    <table className="min-w-full text-left text-[11px] border-collapse bg-white rounded border border-emerald-200">
                      <thead className="bg-emerald-100/50 text-emerald-900">
                        <tr>
                          <th className="p-1.5 font-bold">Activity ID</th>
                          <th className="p-1.5 font-bold">Name</th>
                          <th className="p-1.5 font-bold">WBS</th>
                          <th className="p-1.5 font-bold">Discipline</th>
                          <th className="p-1.5 font-bold">Planned Start</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-emerald-100">
                        {previewRows.map((row, i) => (
                          <tr key={i}>
                            <td className="p-1.5 font-mono font-bold">{row.activity_id}</td>
                            <td className="p-1.5">{row.activity_name}</td>
                            <td className="p-1.5 font-mono">{row.wbs_code}</td>
                            <td className="p-1.5">{row.discipline}</td>
                            <td className="p-1.5">{row.planned_start_date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="pt-2 text-right text-[11px] font-semibold text-emerald-800">
                  Preview complete - schedule import is intentionally not enabled in this phase.
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900">
              <strong>Unable to load the active schedule baseline:</strong> {error}
            </div>
          )}

          {/* Active Indexed Baseline Table */}
          <div className="bg-white rounded-xl border border-setu-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-setu-slate-800">
                  Active Baseline Schedule Index ({activities.length} activities)
                </h3>
                <p className="text-xs text-setu-slate-500">
                  Live activities indexed in Supabase and available for hybrid semantic retrieval.
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-setu-slate-400" />
                <input
                  type="text"
                  placeholder="Search activity ID or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full text-xs pl-8 pr-3 py-2 rounded-lg border border-setu-slate-300 focus:outline-none focus:ring-1 focus:ring-setu-blue"
                />
              </div>
            </div>

            {loading ? (
              <div className="p-8 text-center text-xs text-setu-slate-500 border border-dashed border-setu-slate-300 rounded-lg">
                Loading schedule activities from Supabase...
              </div>
            ) : error ? (
              <div className="p-8 text-center text-xs text-rose-700 border border-dashed border-rose-300 bg-rose-50 rounded-lg">
                The activity table is unavailable until the baseline query succeeds.
              </div>
            ) : activities.length === 0 ? (
              <div className="p-8 text-center text-xs text-setu-slate-500 border border-dashed border-setu-slate-300 rounded-lg">
                No schedule activities were returned by the active baseline query.
              </div>
            ) : (
            <>
            <div className="overflow-x-auto max-h-96 border border-setu-slate-200 rounded-lg">
              <table className="min-w-full text-left text-xs border-collapse">
                <thead className="bg-setu-slate-50 sticky top-0 border-b border-setu-slate-200 text-setu-slate-600">
                  <tr>
                    <th className="py-2.5 px-3 font-bold">Activity ID</th>
                    <th className="py-2.5 px-3 font-bold">Activity Name</th>
                    <th className="py-2.5 px-3 font-bold">WBS Code</th>
                    <th className="py-2.5 px-3 font-bold">Discipline</th>
                    <th className="py-2.5 px-3 font-bold">Duration</th>
                    <th className="py-2.5 px-3 font-bold">Planned Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-setu-slate-100">
                  {filteredActivities.slice(0, 100).map((act) => (
                    <tr key={act.activity_id} className="hover:bg-setu-slate-50/70">
                      <td className="py-2 px-3 font-mono font-bold text-setu-navy">{act.activity_id}</td>
                      <td className="py-2 px-3 font-medium text-setu-slate-800">{act.activity_name}</td>
                      <td className="py-2 px-3 font-mono text-setu-slate-500 text-[11px]">{act.wbs_code}</td>
                      <td className="py-2 px-3">
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-setu-slate-100 text-setu-teal">
                          {act.discipline}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-setu-slate-600 text-[11px]">
                        {act.planned_start_date} to {act.planned_finish_date}
                      </td>
                      <td className="py-2 px-3 text-setu-slate-700 font-mono text-[11px]">
                        {act.planned_qty || 0} {act.unit_of_measure || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-setu-slate-400 text-right">
              Showing top {Math.min(filteredActivities.length, 100)} of {filteredActivities.length} matching activities
            </p>
            </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
