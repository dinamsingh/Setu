export interface ScheduleActualsRow {
  activity_id: string;
  activity_name: string;
  wbs_code: string | null;
  wbs_name: string | null;
  discipline: string | null;
  planned_start_date: string | null;
  planned_finish_date: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  progress_percent: number | null;
  contributing_event_count: number;
  contributing_report_count: number;
  selected_start_event_id: string | null;
  selected_finish_event_id: string | null;
  selected_progress_event_id: string | null;
  latest_evidence_date: string | null;
  latest_decision_at: string | null;
  latest_extraction_at: string | null;
  finish_before_start: boolean;
  multiple_start_dates: boolean;
  multiple_finish_dates: boolean;
  progress_regression: boolean;
  progress_after_finish: boolean;
  ambiguous_progress_order: boolean;
  unresolved_event_date: boolean;
  start_not_evidenced: boolean;
}

export interface ActualsEvidence {
  activity_id: string;
  event_id: string;
  event_type: 'START' | 'FINISH' | 'PROGRESS';
  event_date: string | null;
  progress_percent: number | null;
  event_index: number;
  field_update_id: string;
  update_id: string | null;
  reported_date: string | null;
  report_created_at: string | null;
  evidence_revision: number;
  evidence_text: string;
  extraction_reason: string;
  extraction_version: string;
  extraction_created_at: string | null;
  decision_audit_id: string;
  decision_actor_user_id: string;
  planner_display_label: string | null;
  decision_action: string;
  decision_at: string | null;
  finalized_remap_proposal_id: string | null;
  chronology_date: string | null;
  chronology_basis: 'event_date' | 'reported_date' | 'unresolved';
}

export function actualsWarnings(row: ScheduleActualsRow): string[] {
  const flags: [boolean, string][] = [
    [row.finish_before_start, 'Finish before start'],
    [row.multiple_start_dates, 'Multiple start dates; earliest selected'],
    [row.multiple_finish_dates, 'Multiple finish dates; latest selected'],
    [row.progress_regression, 'Later progress is lower than earlier evidence'],
    [row.progress_after_finish, 'Progress reported after finish'],
    [row.ambiguous_progress_order, 'Conflicting same-day progress; deterministic tie-break applied'],
    [row.unresolved_event_date, 'Approved evidence; date unresolved'],
    [row.start_not_evidenced, 'Start not evidenced'],
  ];
  return flags.filter(([present]) => present).map(([, label]) => label);
}
