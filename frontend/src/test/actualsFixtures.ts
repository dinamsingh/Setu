import type { ActualsEvidence, ScheduleActualsRow } from '../types/actuals';

export const actualsRow: ScheduleActualsRow = {
  activity_id: 'ACT-A', activity_name: 'Rack B piping', wbs_code: '1.2', wbs_name: 'Pipeline', discipline: 'Piping',
  planned_start_date: '2026-09-01', planned_finish_date: '2026-10-01',
  actual_start: '2026-09-03', actual_finish: '2026-10-03', progress_percent: 60,
  contributing_event_count: 3, contributing_report_count: 1,
  selected_start_event_id: 'event-start', selected_finish_event_id: 'event-finish', selected_progress_event_id: 'event-progress',
  latest_evidence_date: '2026-10-03', latest_decision_at: '2026-10-04T10:00:00Z', latest_extraction_at: '2026-10-04T11:00:00Z',
  finish_before_start: false, multiple_start_dates: false, multiple_finish_dates: false,
  progress_regression: false, progress_after_finish: false, ambiguous_progress_order: false,
  unresolved_event_date: false, start_not_evidenced: false,
};
export const actualsEvidence: ActualsEvidence = {
  activity_id: 'ACT-A', event_id: 'event-start', event_type: 'START', event_date: '2026-09-03',
  progress_percent: null, event_index: 0, field_update_id: 'report-id', update_id: 'FU-001',
  reported_date: '2026-09-03', report_created_at: '2026-09-03T10:00:00Z', evidence_revision: 2,
  evidence_text: 'Rack B piping started today', extraction_reason: 'Explicit actual START',
  extraction_version: 'phase1_rules_v1', extraction_created_at: '2026-09-03T11:00:00Z',
  decision_audit_id: 'audit-id', decision_actor_user_id: 'authoritative-planner-id', planner_display_label: 'Authenticated Planner',
  decision_action: 'accept', decision_at: '2026-09-03T12:00:00Z', finalized_remap_proposal_id: null,
  chronology_date: '2026-09-03', chronology_basis: 'event_date',
};
