import './PlannerV2.css';
import React, { useState, useMemo } from 'react';
import { 
  Download, 
  BookOpen, 
  Search,
  Check,
  X,
  Sparkles,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown
} from 'lucide-react';
import Papa from 'papaparse';
import { Header } from '../../components/common/Header';
import { Sidebar } from '../../components/common/Sidebar';
import { useFieldUpdates } from '../../hooks/useFieldUpdates';
import { useScheduleData } from '../../hooks/useScheduleData';
import { useAuditLogs } from '../../hooks/useAuditLogs';
import { buildExportData } from '../../lib/utils';
import { humanizeAuditAction } from '../../lib/plannerWorkspace';
import { LoadingSkeleton } from '../../components/common/LoadingSkeleton';

export const AuditExport: React.FC = () => {
  const { updates, loading: updatesLoading } = useFieldUpdates();
  const { activitiesMap, loading: scheduleLoading } = useScheduleData();
  const { logs, aliases, loading: logsLoading, approveAlias, rejectAlias } = useAuditLogs();

  const [aliasTab, setAliasTab] = useState<'all' | 'proposed' | 'verified' | 'rejected'>('all');
  const [aliasSearch, setAliasSearch] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [exportSearch, setExportSearch] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showAliasGovernance, setShowAliasGovernance] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

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
    link.setAttribute('download', 'approved_evidence_activity_mapping.csv');
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

  const filteredExportData = useMemo(() => {
    const q = exportSearch.trim().toLowerCase();
    if (!q) return exportData;
    return exportData.filter((row) => Object.values(row).join(' ').toLowerCase().includes(q));
  }, [exportData, exportSearch]);
  const filteredLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((log) => [log.action, log.planner_name, log.remarks, log.previous_activity_id, log.new_activity_id, updatesMap.get(log.field_update_id) || ''].join(' ').toLowerCase().includes(q));
  }, [logs, auditSearch, updatesMap]);

  return (
    <div className="setu-planner-v2 setu-planner-v2--audit-export min-h-screen bg-setu-slate-100 flex flex-col">
      <Header currentRole="planner" />

      <div className="flex-1 flex flex-col md:flex-row">
        <Sidebar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-5 max-w-7xl">
          {/* Page header — same pattern as Control Room */}
          <section className="border-l-4 border-[#007AFF] bg-white px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold tracking-[0.14em] text-[#007AFF] uppercase">
                  Compliance &amp; Change Tracking
                </p>
                <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-setu-slate-900">
                  Audit &amp; Export
                </h1>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-setu-slate-600">
                  Append-only planner audit trail and controlled evidence-to-activity mapping export.
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs font-semibold uppercase tracking-wider text-setu-slate-500">Exportable mappings</p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-setu-slate-900">{exportData.length}</p>
              </div>
            </div>
          </section>

          {/* How this works — same grouped-list pattern as Control Room */}
          <section className="bg-white border border-setu-slate-200 px-6 py-5">
            <h2 className="text-sm font-bold text-setu-slate-900">How this works</h2>
            <div className="pl-metric-list mt-3">
              {[
                { n: '1', label: 'Planner Review & Decision', detail: 'Field evidence is reviewed and decided in the Review Queue.' },
                { n: '2', label: 'Append-only Audit Logging', detail: 'Every decision is recorded and cannot be edited.' },
                { n: '3', label: 'Controlled Mapping Export', detail: 'Only finalized mappings are available as CSV.' },
              ].map((step) => (
                <div key={step.n} className="pl-metric-row" style={{ cursor: 'default' }}>
                  <span className="pl-metric-main">
                    <span className="pl-metric-label"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#007AFF] text-xs font-bold text-white">{step.n}</span>{step.label}</span>
                    <span className="pl-metric-detail">{step.detail}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm leading-6 text-setu-slate-500">No direct Primavera write-back. Export contains only finalized evidence-to-activity mappings.</p>
          </section>

          {/* Section 1: Controlled Schedule Export Preview */}
          <section className="bg-white border border-setu-slate-200 px-6 py-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-setu-slate-900">
                  Approved Evidence-to-Activity Mapping Preview
                </h2>
                <p className="text-sm leading-6 text-setu-slate-600">
                  Contains approved and remapped field evidence linked to loaded schedule activities. Excludes pending and rejected reports. AI suggestion confidence is not assigned to planner-selected remaps.
                </p>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-setu-slate-400" />
                <input
                  type="text"
                  placeholder="Search export preview..."
                  value={exportSearch}
                  onChange={(e) => setExportSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2.5 text-sm rounded-lg border border-setu-slate-200 focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
                />
              </div>
              <button
                type="button"
                disabled={exportData.length === 0}
                onClick={handleDownloadCsv}
                className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-[#007AFF] hover:bg-[#0066D6] text-white text-sm font-bold transition-colors disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>Download Approved Mapping CSV</span>
              </button>
            </div>

            {exportData.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-setu-slate-300 rounded-lg text-xs text-setu-slate-500">
                No planner decisions finalized yet. Review pending reports in the Review Queue to populate exportable rows.
              </div>
            ) : (
              <div className="overflow-x-auto border border-setu-slate-200 rounded-xl max-h-96">
                <table className="min-w-full text-left text-xs border-collapse">
                  <thead className="bg-setu-slate-50 border-b border-setu-slate-200 text-setu-slate-600 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3 font-bold">Activity ID</th>
                      <th className="py-2.5 px-3 font-bold">Activity Name</th>
                      <th className="py-2.5 px-3 font-bold">Date</th>
                      <th className="py-2.5 px-3 font-bold">Location</th>
                      <th className="py-2.5 px-3 font-bold">Field Evidence</th>
                      <th className="py-2.5 px-3 font-bold">Mapping Source</th>
                      <th className="py-2.5 px-3 font-bold">AI Suggestion Confidence Score</th>
                      <th className="py-2.5 px-3 font-bold">Status</th>
                      <th className="py-2.5 px-3 font-bold">Planner Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-setu-slate-100">
                    {filteredExportData.map((row, idx) => (
                      <tr key={idx} className="hover:bg-setu-slate-50/70">
                        <td className="py-2.5 px-3 font-mono font-bold text-setu-navy">{row['Activity ID']}</td>
                        <td className="py-2.5 px-3 font-medium text-setu-slate-800">{row['Activity Name']}</td>
                        <td className="py-2.5 px-3 text-setu-slate-600 font-mono text-[11px]">{row['Reported Date']}</td>
                        <td className="py-2.5 px-3 text-setu-slate-600">{row['Site Location']}</td>
                        <td className="py-2.5 px-3 text-setu-slate-700 italic max-w-xs truncate" title={row['Field Evidence']}>
                          "{row['Field Evidence']}"
                        </td>
                        <td className="py-2.5 px-3 text-setu-slate-600">{row['Mapping Source']}</td>
                        <td className="py-2.5 px-3 font-mono font-bold text-setu-slate-800">{row['AI Suggestion Confidence Score'] || 'N/A'}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                            row['Planner Status'] === 'Approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-purple-100 text-purple-800'
                          }`}>
                            {row['Planner Status']}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-setu-slate-600 text-[11px]">{row['Planner Remarks']}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {exportData.length > 0 && filteredExportData.length === 0 && (
              <p className="text-sm text-setu-slate-500">No export rows match this search.</p>
            )}
          </section>

          {/* Section 2: Full Audit Timeline */}
          <section className="bg-white border border-setu-slate-200 px-6 py-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-setu-slate-900">
                  Append-only Planner Audit Trail ({filteredLogs.length} of {logs.length} entries)
                </h2>
                <p className="text-sm leading-6 text-setu-slate-600">
                  Decision history for accept, remap, reject, requeue, and validation override actions.
                </p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-setu-slate-400" />
                <input
                  type="text"
                  placeholder="Search audit trail..."
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2.5 text-sm rounded-lg border border-setu-slate-200 focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
                />
              </div>
            </div>

            {loading ? (
              <LoadingSkeleton rows={2} />
            ) : logs.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-setu-slate-300 rounded-lg text-xs text-setu-slate-500">
                No audit entries recorded yet. Review reports in the Review Queue.
              </div>
            ) : (
              <div className="overflow-x-auto border border-setu-slate-200 rounded-xl max-h-96">
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
                    {filteredLogs.map((log) => {
                      const evidence = updatesMap.get(log.field_update_id) || 'Site log reference';
                      return (
                        <tr key={log.id} className="hover:bg-setu-slate-50/70">
                          <td className="py-2.5 px-3 font-mono text-[11px] text-setu-slate-500 whitespace-nowrap">
                            {log.created_at ? log.created_at.slice(0, 19).replace('T', ' ') : '—'}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded text-[11px] font-extrabold uppercase ${
                              log.action === 'accept' ? 'bg-emerald-100 text-emerald-800' :
                              log.action === 'remap' ? 'bg-purple-100 text-purple-800' :
                              log.action === 'requeue' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {humanizeAuditAction(log.action, log.metadata)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-setu-slate-600">{log.previous_activity_id || 'None'}</td>
                          <td className="py-2.5 px-3 font-mono font-bold text-setu-navy">{log.new_activity_id || 'None'}</td>
                          <td className="py-2.5 px-3 text-setu-slate-700 italic max-w-xs truncate" title={evidence}>
                            "{evidence}"
                          </td>
                          <td className="py-2.5 px-3 text-setu-slate-600">{log.planner_name}</td>
                          <td className="py-2.5 px-3 text-setu-slate-600">{log.remarks}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {logs.length > 0 && filteredLogs.length === 0 && (
              <p className="text-sm text-setu-slate-500">No audit entries match this search.</p>
            )}
          </section>

          {/* Toast message display */}
          {toastMessage && (
            <div className="fixed bottom-6 right-6 z-50 bg-setu-slate-900 text-white px-4 py-3 rounded-xl shadow-xl border border-setu-slate-700 flex items-center gap-2 text-xs animate-fadeIn">
              <Sparkles className="w-4 h-4 text-setu-blue-light shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* Alias governance — one section card, header toggles the body */}
          <section className="bg-white border border-setu-slate-200 px-6 py-5 space-y-4">
            <button
              type="button"
              onClick={() => setShowAliasGovernance((current) => !current)}
              className="flex w-full items-center justify-between text-left focus:outline-none focus:ring-2 focus:ring-setu-blue/30 rounded"
              aria-expanded={showAliasGovernance}
            >
              <span className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-[#007AFF]" />
                <span className="text-sm font-bold text-setu-slate-900">Alias governance</span>
                <span className="font-mono text-[11px] font-medium text-setu-slate-500">{aliases.length} entries</span>
              </span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-setu-slate-500 transition-transform ${showAliasGovernance ? 'rotate-180' : ''}`} />
            </button>
            <div className={showAliasGovernance ? 'space-y-4 border-t border-setu-slate-200 pt-4' : 'hidden'}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-sm leading-6 text-setu-slate-600">
                  Review proposed field-language aliases. Only verified aliases can affect later matching runs. Proposed aliases remain quarantined and do not affect scoring until a planner approves them.
                </p>
              </div>

              {/* Quick Search */}
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-setu-slate-400" />
                <input
                  type="text"
                  placeholder="Search aliases or P6 terms..."
                  value={aliasSearch}
                  onChange={(e) => setAliasSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2.5 text-sm rounded-lg border border-setu-slate-200 focus:outline-none focus:ring-2 focus:ring-setu-blue/30"
                />
              </div>
            </div>

            {/* Tabs Filter Bar */}
            <div className="flex flex-wrap items-center gap-2 border-b border-setu-slate-100 pb-2.5">
              <button
                type="button"
                onClick={() => setAliasTab('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  aliasTab === 'all'
                    ? 'bg-[#007AFF] text-white'
                    : 'bg-setu-slate-100 text-setu-slate-600 hover:bg-setu-slate-200'
                }`}
              >
                All Aliases ({aliases.length})
              </button>

              <button
                type="button"
                onClick={() => setAliasTab('proposed')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                  aliasTab === 'proposed'
                    ? 'bg-[#007AFF] text-white'
                    : 'bg-white border border-setu-slate-200 text-setu-slate-600 hover:bg-setu-slate-50'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Proposed for Review</span>
                <span className="font-mono opacity-70">
                  {aliases.filter((a) => a.status === 'proposed').length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setAliasTab('verified')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  aliasTab === 'verified'
                    ? 'bg-[#007AFF] text-white'
                    : 'bg-white border border-setu-slate-200 text-setu-slate-600 hover:bg-setu-slate-50'
                }`}
              >
                Active Verified ({aliases.filter((a) => (a.status || 'verified') === 'verified').length})
              </button>

              <button
                type="button"
                onClick={() => setAliasTab('rejected')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  aliasTab === 'rejected'
                    ? 'bg-[#007AFF] text-white'
                    : 'bg-white border border-setu-slate-200 text-setu-slate-600 hover:bg-setu-slate-50'
                }`}
              >
                Rejected ({aliases.filter((a) => a.status === 'rejected').length})
              </button>
            </div>

            {/* Aliases Table */}
            {aliases.length === 0 ? (
              <div className="p-8 text-center text-xs text-setu-slate-400">
                No domain aliases found in database.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-setu-slate-200">
                <table className="min-w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-setu-slate-50 border-b border-setu-slate-200 text-setu-slate-600">
                      <th className="py-2.5 px-3 font-bold">Field Term (Jargon)</th>
                      <th className="py-2.5 px-3 font-bold">Standard Primavera Term</th>
                      <th className="py-2.5 px-3 font-bold">Discipline</th>
                      <th className="py-2.5 px-3 font-bold">Origin</th>
                      <th className="py-2.5 px-3 font-bold">Source Report</th>
                      <th className="py-2.5 px-3 font-bold">Status</th>
                      <th className="py-2.5 px-3 font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-setu-slate-100">
                    {(() => {
                      let list = aliases;
                      if (aliasTab !== 'all') {
                        list = list.filter((a) => (a.status || 'verified') === aliasTab);
                      }
                      if (aliasSearch.trim()) {
                        const q = aliasSearch.toLowerCase().trim();
                        list = list.filter(
                          (a) =>
                            a.field_term.toLowerCase().includes(q) ||
                            a.standard_term.toLowerCase().includes(q) ||
                            (a.discipline && a.discipline.toLowerCase().includes(q)) ||
                            (a.source_update_id && a.source_update_id.toLowerCase().includes(q))
                        );
                      }

                      if (list.length === 0) {
                        return (
                          <tr>
                            <td colSpan={7} className="p-6 text-center text-xs text-setu-slate-400">
                              No aliases match current filter or search query.
                            </td>
                          </tr>
                        );
                      }

                      return list.map((al) => {
                        const status = al.status || 'verified';
                        const isProposed = status === 'proposed';
                        const isVerified = status === 'verified';

                        return (
                          <tr key={al.id} className="hover:bg-setu-slate-50/70 transition-colors">
                            <td className="py-2.5 px-3 font-mono font-bold text-setu-navy">
                              "{al.field_term}"
                            </td>
                            <td className="py-2.5 px-3 font-medium text-setu-slate-800">
                              {al.standard_term}
                            </td>
                            <td className="py-2.5 px-3 text-setu-slate-700 font-semibold">
                              {al.discipline || 'General'}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase ${
                                al.origin === 'planner_correction'
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-setu-slate-100 text-setu-slate-700'
                              }`}>
                                {al.origin === 'planner_correction' ? 'Correction' : 'Seed'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-setu-slate-500">
                              {al.source_update_id || '—'}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={`px-2 py-0.5 rounded text-[11px] font-extrabold uppercase ${
                                isVerified ? 'bg-emerald-100 text-emerald-800' :
                                isProposed ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
                              }`}>
                                {status}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {isProposed ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const res = await approveAlias(al.id, 'Lead Project Planner');
                                      if (res.success) {
                                        showToast(`Alias "${al.field_term}" approved & activated into engine.`);
                                      }
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors"
                                  >
                                    <Check className="w-3 h-3" />
                                    <span>Approve</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const res = await rejectAlias(al.id, 'Lead Project Planner');
                                      if (res.success) {
                                        showToast(`Alias "${al.field_term}" rejected.`);
                                      }
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition-colors"
                                  >
                                    <X className="w-3 h-3" />
                                    <span>Reject</span>
                                  </button>
                                </div>
                              ) : isVerified ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-semibold">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Active</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-rose-600 font-semibold">
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Quarantined</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};
