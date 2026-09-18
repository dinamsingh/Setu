import React, { useMemo } from 'react';
import { 
  Download, 
  ShieldCheck, 
  BookOpen, 
  FileCheck
} from 'lucide-react';
import Papa from 'papaparse';
import { Header } from '../../components/common/Header';
import { Sidebar } from '../../components/common/Sidebar';
import { useFieldUpdates } from '../../hooks/useFieldUpdates';
import { useScheduleData } from '../../hooks/useScheduleData';
import { useAuditLogs } from '../../hooks/useAuditLogs';
import { buildExportData } from '../../lib/utils';
import { LoadingSkeleton } from '../../components/common/LoadingSkeleton';

export const AuditExport: React.FC = () => {
  const { updates, loading: updatesLoading } = useFieldUpdates();
  const { activitiesMap, loading: scheduleLoading } = useScheduleData();
  const { logs, aliases, loading: logsLoading } = useAuditLogs();

  const loading = updatesLoading || scheduleLoading || logsLoading;

  // Build exportable records (approved + remapped only)
  const exportData = useMemo(() => {
    return buildExportData(updates, activitiesMap);
  }, [updates, activitiesMap]);

  const handleDownloadCsv = () => {
    if (exportData.length === 0) return;

    const csvString = Papa.unparse(exportData);
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'planner_approved_schedule_updates.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Map updates to get field text for audit logs
  const updatesMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of updates) {
      map.set(u.id, u.field_text);
    }
    return map;
  }, [updates]);

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
                  <ShieldCheck className="w-4 h-4" />
                  <span>Compliance & Change Tracking</span>
                </div>
                <h1 className="text-2xl font-extrabold text-setu-slate-900 mt-1">
                  Audit Trail & Controlled Schedule Export
                </h1>
                <p className="text-xs text-setu-slate-500 mt-1">
                  Immutable regulatory log of human planner decisions and verified schedule update export.
                </p>
              </div>

              <div className="flex items-center space-x-2 text-xs text-setu-slate-700 bg-setu-slate-50 border border-setu-slate-200 px-3 py-2 rounded-lg font-mono">
                <span>Total Exportable:</span>
                <strong className="text-setu-navy font-bold text-sm">{exportData.length}</strong>
              </div>
            </div>
          </div>

          {/* Three-Step Governance Strip */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 rounded-xl bg-setu-navy text-white">
            <div className="flex items-center space-x-3 p-2">
              <div className="w-8 h-8 rounded-full bg-setu-blue flex items-center justify-center font-bold text-xs shrink-0">
                1
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-setu-blue-light block">Step One</span>
                <span className="text-xs font-bold">Planner Review & Decision</span>
              </div>
            </div>

            <div className="flex items-center space-x-3 p-2 border-t md:border-t-0 md:border-l border-setu-slate-700">
              <div className="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center font-bold text-xs shrink-0">
                2
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-purple-300 block">Step Two</span>
                <span className="text-xs font-bold">Immutable Audit Logging</span>
              </div>
            </div>

            <div className="flex items-center space-x-3 p-2 border-t md:border-t-0 md:border-l border-setu-slate-700">
              <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center font-bold text-xs shrink-0">
                3
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-emerald-300 block">Step Three</span>
                <span className="text-xs font-bold">Reviewable CSV Schedule Diff</span>
              </div>
            </div>
          </div>

          {/* Governance Callout */}
          <div className="p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-200 text-xs text-emerald-950 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <FileCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                <strong>Controlled Schedule Governance:</strong> No direct Primavera write-back. Only planner-approved updates are exported.
              </span>
            </div>
          </div>

          {/* Section 1: Controlled Schedule Export Preview */}
          <div className="bg-white rounded-xl border border-setu-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-setu-slate-900">
                  Planner-Approved Schedule Update CSV Preview
                </h2>
                <p className="text-xs text-setu-slate-500">
                  Contains strictly approved and remapped field reports. Excludes pending or rejected updates.
                </p>
              </div>

              <button
                type="button"
                disabled={exportData.length === 0}
                onClick={handleDownloadCsv}
                className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-setu-green hover:bg-setu-green-dark text-white text-xs font-bold shadow-xs transition-colors disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>Download Planner-Approved CSV</span>
              </button>
            </div>

            {exportData.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-setu-slate-300 rounded-lg text-xs text-setu-slate-500">
                No planner decisions finalized yet. Review pending reports in the Review Queue to populate exportable rows.
              </div>
            ) : (
              <div className="overflow-x-auto border border-setu-slate-200 rounded-lg max-h-72">
                <table className="min-w-full text-left text-xs border-collapse">
                  <thead className="bg-setu-slate-50 border-b border-setu-slate-200 text-setu-slate-600 sticky top-0">
                    <tr>
                      <th className="py-2 px-3 font-bold">Activity ID</th>
                      <th className="py-2 px-3 font-bold">Activity Name</th>
                      <th className="py-2 px-3 font-bold">Date</th>
                      <th className="py-2 px-3 font-bold">Location</th>
                      <th className="py-2 px-3 font-bold">Field Evidence</th>
                      <th className="py-2 px-3 font-bold">Score</th>
                      <th className="py-2 px-3 font-bold">Status</th>
                      <th className="py-2 px-3 font-bold">Planner Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-setu-slate-100">
                    {exportData.map((row, idx) => (
                      <tr key={idx} className="hover:bg-setu-slate-50/70">
                        <td className="py-2 px-3 font-mono font-bold text-setu-navy">{row['Activity ID']}</td>
                        <td className="py-2 px-3 font-medium text-setu-slate-800">{row['Activity Name']}</td>
                        <td className="py-2 px-3 text-setu-slate-600 font-mono text-[11px]">{row['Reported Date']}</td>
                        <td className="py-2 px-3 text-setu-slate-600">{row['Site Location']}</td>
                        <td className="py-2 px-3 text-setu-slate-700 italic max-w-xs truncate" title={row['Field Evidence']}>
                          "{row['Field Evidence']}"
                        </td>
                        <td className="py-2 px-3 font-mono font-bold text-setu-teal">{row['Confidence Score']}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            row['Planner Status'] === 'Approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-purple-100 text-purple-800'
                          }`}>
                            {row['Planner Status']}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-setu-slate-600 text-[11px]">{row['Planner Remarks']}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 2: Full Audit Timeline */}
          <div className="bg-white rounded-xl border border-setu-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-setu-slate-900">
                  Immutable Planner Decision Audit Trail ({logs.length} entries)
                </h2>
                <p className="text-xs text-setu-slate-500">
                  Regulatory decision log recording every accept, remap, and reject action with planner notes.
                </p>
              </div>
            </div>

            {loading ? (
              <LoadingSkeleton rows={2} />
            ) : logs.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-setu-slate-300 rounded-lg text-xs text-setu-slate-500">
                No audit entries recorded yet. Review reports in the Review Queue.
              </div>
            ) : (
              <div className="overflow-x-auto border border-setu-slate-200 rounded-lg max-h-96">
                <table className="min-w-full text-left text-xs border-collapse">
                  <thead className="bg-setu-slate-50 border-b border-setu-slate-200 text-setu-slate-600 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3 font-bold">Timestamp</th>
                      <th className="py-2.5 px-3 font-bold">Action</th>
                      <th className="py-2.5 px-3 font-bold">Previous Task</th>
                      <th className="py-2.5 px-3 font-bold">Assigned Task</th>
                      <th className="py-2.5 px-3 font-bold">Field Evidence</th>
                      <th className="py-2.5 px-3 font-bold">Acting Planner</th>
                      <th className="py-2.5 px-3 font-bold">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-setu-slate-100">
                    {logs.map((log) => {
                      const evidence = updatesMap.get(log.field_update_id) || 'Site log reference';
                      return (
                        <tr key={log.id} className="hover:bg-setu-slate-50/70">
                          <td className="py-2 px-3 font-mono text-[11px] text-setu-slate-500 whitespace-nowrap">
                            {log.created_at ? log.created_at.slice(0, 19).replace('T', ' ') : '—'}
                          </td>
                          <td className="py-2 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                              log.action === 'accept' ? 'bg-emerald-100 text-emerald-800' :
                              log.action === 'remap' ? 'bg-purple-100 text-purple-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {log.action}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono text-setu-slate-600">{log.previous_activity_id || 'None'}</td>
                          <td className="py-2 px-3 font-mono font-bold text-setu-navy">{log.new_activity_id || 'None'}</td>
                          <td className="py-2 px-3 text-setu-slate-700 italic max-w-xs truncate" title={evidence}>
                            "{evidence}"
                          </td>
                          <td className="py-2 px-3 text-setu-slate-600">{log.planner_name}</td>
                          <td className="py-2 px-3 text-setu-slate-600">{log.remarks}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 3: Verified Vocabulary & Project Memory Block */}
          <div className="bg-white rounded-xl border border-setu-slate-200 p-6 shadow-xs space-y-3">
            <div className="flex items-center space-x-2">
              <BookOpen className="w-4 h-4 text-setu-teal" />
              <h2 className="text-sm font-bold text-setu-slate-900">
                Verified Vocabulary & Project Memory ({aliases.length} aliases)
              </h2>
            </div>
            <p className="text-xs text-setu-slate-500">
              Every planner-verified mapping strengthens future project recall. Oil India Limited domain dictionary mappings:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              {aliases.slice(0, 6).map((al) => (
                <div key={al.id} className="p-2.5 rounded-lg bg-setu-slate-50 border border-setu-slate-200 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-setu-navy">"{al.field_term}"</span>
                    <span className="text-[10px] text-setu-teal font-semibold">[{al.discipline || 'General'}]</span>
                  </div>
                  <p className="text-[11px] text-setu-slate-600 mt-1 truncate" title={al.standard_term}>
                    &rarr; {al.standard_term}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-setu-slate-400 italic">
              Showing sample 6 of {aliases.length} domain aliases active in Supabase.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
};
