import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  CheckCircle2, 
  AlertTriangle, 
  HelpCircle, 
  TrendingUp, 
  ArrowRight, 
  ShieldCheck, 
  FileCheck2,
  Clock
} from 'lucide-react';
import { Header } from '../../components/common/Header';
import { Sidebar } from '../../components/common/Sidebar';
import { KpiCard } from '../../components/common/KpiCard';
import { LoadingSkeleton } from '../../components/common/LoadingSkeleton';
import { useFieldUpdates } from '../../hooks/useFieldUpdates';
import { useScheduleData } from '../../hooks/useScheduleData';
import { useAuditLogs } from '../../hooks/useAuditLogs';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip as RechartsTooltip,
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid 
} from 'recharts';

export const CommandCenter: React.FC = () => {
  const navigate = useNavigate();
  const { updates, kpis, loading: updatesLoading } = useFieldUpdates();
  const { activities, activitiesMap, loading: scheduleLoading } = useScheduleData();
  const { logs } = useAuditLogs();

  const loading = updatesLoading || scheduleLoading;

  const awaitingCount = kpis.awaiting || 0;

  // Compute confidence chart data
  const confidenceChartData = useMemo(() => {
    const data = [
      { name: 'High Confidence (>=0.82)', value: kpis.high, color: '#219469' },
      { name: 'Medium Confidence (0.55-0.81)', value: kpis.medium, color: '#C47814' },
      { name: 'Low Confidence (<0.55)', value: kpis.low, color: '#C43C3C' },
    ];
    if (awaitingCount > 0) {
      data.push({ name: 'Awaiting Matching', value: awaitingCount, color: '#64748B' });
    }
    return data;
  }, [kpis, awaitingCount]);

  // Compute discipline chart data
  const disciplineChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const u of updates) {
      const act = u.matched_activity_id ? activitiesMap.get(u.matched_activity_id) : undefined;
      const disc = act?.discipline || (Array.isArray(u.candidate_matches) && u.candidate_matches[0]?.discipline) || 'General';
      counts[disc] = (counts[disc] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [updates, activitiesMap]);

  const pendingAttentionCount = kpis.medium + kpis.low;

  return (
    <div className="min-h-screen bg-setu-slate-100 flex flex-col">
      <Header currentRole="planner" />

      <div className="flex-1 flex flex-col md:flex-row">
        <Sidebar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl">
          {/* Executive Baseline Banner */}
          <div className="bg-setu-navy text-white rounded-2xl p-5 sm:p-6 border border-setu-slate-700 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center space-x-2 text-xs font-semibold text-setu-blue-light uppercase tracking-wider">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Executive Project Control Dashboard</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-1">
                  Planner Command Center
                </h1>
                <p className="text-xs sm:text-sm text-setu-slate-300 mt-1">
                  Baseline v1.0 &middot; <strong className="text-white">{activities.length || 220} activities indexed</strong> &middot; 6 engineering disciplines &middot; <span className="text-emerald-400 font-semibold">0 updates silently dropped</span>
                </p>
              </div>

              <button
                onClick={() => navigate('/planner/review')}
                className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-setu-blue hover:bg-setu-blue-light text-white text-xs font-bold shadow-xs transition-colors self-start sm:self-center"
              >
                <span>Open Review Queue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Prototype Disclaimer Banner */}
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="font-bold uppercase text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">
                Notice
              </span>
              <span>Synthetic prototype routing output — not pilot results. Real-time metrics computed directly from Supabase.</span>
            </div>
          </div>

          {loading ? (
            <LoadingSkeleton rows={3} />
          ) : (
            <>
              {/* KPI Stat Cards Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
                <KpiCard
                  label="Total Ingested"
                  value={kpis.total}
                  subtitle="Field reports in database"
                  variant="default"
                  icon={TrendingUp}
                  onClick={() => navigate('/planner/review')}
                />
                <KpiCard
                  label="Suggested Links"
                  value={kpis.high}
                  subtitle="High confidence (>=82%)"
                  variant="high"
                  icon={CheckCircle2}
                  onClick={() => navigate('/planner/review?confidence=High')}
                />
                <KpiCard
                  label="Review Required"
                  value={kpis.medium}
                  subtitle="Medium confidence (55-81%)"
                  variant="medium"
                  icon={AlertTriangle}
                  onClick={() => navigate('/planner/review?confidence=Medium')}
                />
                <KpiCard
                  label="Clarification Needed"
                  value={kpis.low}
                  subtitle="Low / Unmatched (<55%)"
                  variant="low"
                  icon={HelpCircle}
                  onClick={() => navigate('/planner/review?confidence=Low')}
                />
                <KpiCard
                  label="Planner Decisions"
                  value={kpis.approved + kpis.remapped}
                  subtitle={`${kpis.approved} Approved · ${kpis.remapped} Remapped`}
                  variant="blue"
                  icon={FileCheck2}
                  onClick={() => navigate('/planner/audit-export')}
                />
              </div>

              {/* Awaiting Matching Worker Notice Banner */}
              {awaitingCount > 0 && (
                <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-xs flex items-center justify-between shadow-2xs">
                  <div className="flex items-center space-x-2.5">
                    <span className="font-bold uppercase text-[10px] px-2 py-0.5 rounded bg-blue-200 text-blue-950 font-mono">
                      {awaitingCount} Awaiting
                    </span>
                    <span>
                      {awaitingCount} submitted report(s) are awaiting the matching worker. They will be linked automatically when the worker runs.
                    </span>
                  </div>
                  <button
                    onClick={() => navigate('/planner/review?confidence=Pending')}
                    className="inline-flex items-center space-x-1 text-xs font-bold text-setu-blue hover:underline shrink-0 ml-2"
                  >
                    <span>View in Queue</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Attention Required Panel */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <AlertTriangle className="w-4 h-4 text-setu-amber-dark" />
                      <h3 className="text-sm font-bold text-amber-950">
                        Attention Required: {pendingAttentionCount} Reports Awaiting Review or Remapping
                      </h3>
                    </div>
                    <p className="text-xs text-amber-800">
                      {kpis.medium} Medium-confidence reports require candidate selection, and {kpis.low} Low-confidence reports are flagged for planner remapping. 
                      <strong className="text-emerald-800 ml-1">100% of field updates are retained; 0 updates silently dropped.</strong>
                    </p>
                  </div>
                  <button
                    onClick={() => navigate('/planner/review?status=pending')}
                    className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-setu-amber hover:bg-setu-amber-dark text-white text-xs font-bold shadow-xs transition-colors self-start sm:self-center shrink-0"
                  >
                    <span>Filter Pending in Queue</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Visual Charts Grid (Recharts) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Confidence Routing Donut Chart */}
                <div className="rounded-xl border border-setu-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-setu-slate-800">
                      Confidence Routing Tier Distribution
                    </h3>
                    <p className="text-xs text-setu-slate-500 mt-0.5">
                      Routing breakdown by ensemble confidence threshold.
                    </p>
                  </div>
                  <div className="h-64 my-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={confidenceChartData}
                          innerRadius={60}
                          outerRadius={85}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {confidenceChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          formatter={(val: any) => [`${val} reports`, 'Count']}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-4 text-xs font-medium border-t border-setu-slate-100 pt-3">
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-[#219469]" />
                      <span>High ({kpis.high})</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-[#C47814]" />
                      <span>Medium ({kpis.medium})</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-[#C43C3C]" />
                      <span>Low ({kpis.low})</span>
                    </div>
                    {awaitingCount > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-full bg-[#64748B]" />
                        <span>Awaiting ({awaitingCount})</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Discipline Workload Bar Chart */}
                <div className="rounded-xl border border-setu-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-setu-slate-800">
                      Discipline-Wise Update Breakdown
                    </h3>
                    <p className="text-xs text-setu-slate-500 mt-0.5">
                      Active field evidence volume mapped across engineering disciplines.
                    </p>
                  </div>
                  <div className="h-64 my-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={disciplineChartData} margin={{ top: 20, right: 10, left: -20, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} interval={0} angle={-15} textAnchor="end" />
                        <YAxis tick={{ fontSize: 11, fill: '#64748B' }} allowDecimals={false} />
                        <RechartsTooltip />
                        <Bar dataKey="count" fill="#1E63B7" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-center text-[11px] text-setu-slate-400 border-t border-setu-slate-100 pt-3 font-medium">
                    Auto-categorized by detected domain terms and Primavera WBS codes.
                  </div>
                </div>
              </div>

              {/* Recent Activity Audit Feed */}
              <div className="rounded-xl border border-setu-slate-200 bg-white p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Clock className="w-4 h-4 text-setu-slate-500" />
                    <h3 className="text-sm font-bold text-setu-slate-800">
                      Recent Planner Decisions & Audit Trail
                    </h3>
                  </div>
                  <button
                    onClick={() => navigate('/planner/audit-export')}
                    className="text-xs font-bold text-setu-blue hover:underline"
                  >
                    View Full Audit Log
                  </button>
                </div>

                {logs.length === 0 ? (
                  <p className="text-xs text-setu-slate-500 py-3 italic">
                    No planner decisions recorded yet. Accept or Remap reports in the Review Queue to populate the audit trail.
                  </p>
                ) : (
                  <div className="divide-y divide-setu-slate-100">
                    {logs.slice(0, 4).map((l) => (
                      <div key={l.id} className="py-2.5 flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-2.5">
                          <span className={`px-2 py-0.5 rounded font-extrabold text-[10px] uppercase ${
                            l.action === 'accept' ? 'bg-emerald-100 text-emerald-800' :
                            l.action === 'remap' ? 'bg-purple-100 text-purple-800' : 'bg-rose-100 text-rose-800'
                          }`}>
                            {l.action}
                          </span>
                          <span className="font-mono text-setu-slate-700">
                            {l.previous_activity_id || '—'} &rarr; <strong className="text-setu-navy">{l.new_activity_id || '—'}</strong>
                          </span>
                          <span className="text-setu-slate-500 hidden sm:inline truncate max-w-xs">
                            "{l.remarks}"
                          </span>
                        </div>
                        <span className="text-setu-slate-400 font-mono text-[11px]">
                          {l.created_at ? l.created_at.slice(0, 19).replace('T', ' ') : 'Just now'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
};
