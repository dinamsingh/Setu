import type { CandidateMatch, FieldUpdate, KpiMetrics, ScheduleActivity } from '../types';

export function parseCandidates(raw: any): CandidateMatch[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function computeKpis(updates: FieldUpdate[]): KpiMetrics {
  const kpis: KpiMetrics = {
    total: updates.length,
    high: 0,
    medium: 0,
    low: 0,
    approved: 0,
    rejected: 0,
    remapped: 0,
    pending: 0,
  };

  for (const u of updates) {
    if (u.confidence_level === 'High') kpis.high++;
    else if (u.confidence_level === 'Medium') kpis.medium++;
    else if (u.confidence_level === 'Low') kpis.low++;

    if (u.status === 'approved') kpis.approved++;
    else if (u.status === 'rejected') kpis.rejected++;
    else if (u.status === 'remapped') kpis.remapped++;
    else kpis.pending++;
  }

  return kpis;
}

export function getConfidenceColor(level: string): { bg: string; text: string; border: string; label: string } {
  switch (level?.toLowerCase()) {
    case 'high':
      return {
        bg: 'bg-setu-green-bg',
        text: 'text-setu-green-dark',
        border: 'border-setu-green',
        label: 'Suggested Link — Fast-Track Review',
      };
    case 'medium':
      return {
        bg: 'bg-setu-amber-bg',
        text: 'text-setu-amber-dark',
        border: 'border-setu-amber',
        label: 'Planner Review Required',
      };
    case 'low':
      return {
        bg: 'bg-setu-red-bg',
        text: 'text-setu-red-dark',
        border: 'border-setu-red',
        label: 'Clarification / Remap Required',
      };
    default:
      return {
        bg: 'bg-setu-slate-100',
        text: 'text-setu-slate-700',
        border: 'border-setu-slate-300',
        label: 'Pending Link Analysis',
      };
  }
}

export function getStatusBadge(status: string): { bg: string; text: string; label: string } {
  switch (status?.toLowerCase()) {
    case 'approved':
      return { bg: 'bg-setu-green text-white', text: 'text-white', label: 'APPROVED' };
    case 'remapped':
      return { bg: 'bg-purple-600 text-white', text: 'text-white', label: 'REMAPPED' };
    case 'rejected':
      return { bg: 'bg-setu-red text-white', text: 'text-white', label: 'REJECTED' };
    default:
      return { bg: 'bg-setu-slate-200 text-setu-slate-700', text: 'text-setu-slate-700', label: 'PENDING' };
  }
}

export function buildExportData(
  updates: FieldUpdate[],
  activitiesMap: Map<string, ScheduleActivity>
) {
  return updates
    .filter((u) => u.status === 'approved' || u.status === 'remapped')
    .map((u) => {
      const actId = u.matched_activity_id || 'UNASSIGNED';
      const act = actId !== 'UNASSIGNED' ? activitiesMap.get(actId) : undefined;
      const actName = act ? act.activity_name : 'Manual Review Activity';

      const scoreNum = u.confidence_score ? Number(u.confidence_score).toFixed(3) : '0.000';

      return {
        'Activity ID': actId,
        'Activity Name': actName,
        'Reported Date': u.reported_date || '',
        'Site Location': u.site_location || '',
        'Field Evidence': u.field_text || '',
        'Confidence Score': scoreNum,
        'Planner Status': u.status.charAt(0).toUpperCase() + u.status.slice(1),
        'Planner Remarks': u.planner_remarks || '',
      };
    });
}
