/**
 * SETU - TypeScript Type Definitions
 * Maps to Supabase PostgreSQL schema and UI state representations.
 */

export interface ScheduleActivity {
  id: string;
  activity_id: string;
  activity_name: string;
  wbs_code: string;
  wbs_name?: string | null;
  discipline: string;
  planned_start_date?: string | null;
  planned_finish_date?: string | null;
  planned_progress_pct?: number;
  unit_of_measure?: string;
  planned_qty?: number;
  created_at?: string;
}

export interface DomainAlias {
  id: number;
  field_term: string;
  standard_term: string;
  discipline?: string | null;
  status: 'verified' | 'proposed' | 'rejected';
  origin: 'seed' | 'planner_correction';
  source_update_id?: string | null;
  proposed_by?: string | null;
  reviewed_by?: string | null;
  created_at?: string;
  reviewed_at?: string | null;
}

export interface CandidateMatch {
  activity_id: string;
  activity_name: string;
  discipline?: string;
  wbs_code?: string;
  combined_score?: number;
  final_score?: number;
  score?: number;
  semantic_score?: number;
  fuzzy_score?: number;
  discipline_boost?: number;
  location_score?: number;
  location_match?: boolean;
  rationale?: string;
}

export interface ValidationCheckResult {
  check: string;
  name: string;
  outcome: 'pass' | 'warn' | 'fail';
  message: string;
  evidence: Record<string, any>;
  status?: 'pass' | 'warn' | 'fail';
  reason?: string;
}

export interface FieldUpdate {
  id: string;
  update_id: string;
  source_type: string;
  field_text: string;
  site_location: string | null;
  reported_by: string | null;
  expanded_text: string | null;
  matched_activity_id: string | null;
  confidence_score: number | null;
  confidence_level: 'High' | 'Medium' | 'Low' | 'Pending';
  matched_layer: string | null;
  candidate_matches: CandidateMatch[] | string | null;
  validation_status?: 'pass' | 'warn' | 'block' | null;
  validation_results?: ValidationCheckResult[] | string | null;
  validation_overridden?: boolean;
  override_reason?: string | null;
  override_by?: string | null;
  override_at?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'remapped';
  planner_remarks: string | null;
  reported_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlannerAuditLog {
  id: string;
  field_update_id: string;
  action: 'accept' | 'reject' | 'remap' | 'requeue' | 'override';
  previous_activity_id: string | null;
  new_activity_id: string | null;
  planner_name: string;
  remarks: string | null;
  created_at: string;
}

export interface KpiMetrics {
  total: number;
  high: number;
  medium: number;
  low: number;
  approved: number;
  rejected: number;
  remapped: number;
  pending: number;
  awaiting?: number;
}

export interface FilterState {
  confidence: string;
  status: string;
  discipline: string;
  search: string;
}

export type UserRole = 'site' | 'engineer' | 'planner' | 'admin' | null;
