export type ClarificationImpact = 'confirm_only' | 'validation_inputs_changed' | 'mapping_inputs_changed';
export interface Clarification {
  id: string;
  field_update_id: string;
  mode: 'resolve_now' | 'request_response';
  recipient_user_id: string | null;
  question: string;
  response: string | null;
  communication_method: string | null;
  supplied_by: string | null;
  requested_by_user_id: string;
  responded_by_user_id: string | null;
  status: 'open' | 'responded' | 'resolved' | 'cancelled';
  triage_impact: ClarificationImpact | null;
  triage_note: string | null;
  created_at: string;
  responded_at: string | null;
  resolved_at: string | null;
  cancelled_at: string | null;
}
export interface RemapProposal {
  id: string;
  field_update_id: string;
  target_activity_id: string;
  evidence_revision: number;
  workflow_revision: number;
  validation_generation: number;
  validated_generation: number | null;
  validation_evidence_revision: number | null;
  status: 'pending_validation' | 'validated' | 'blocked' | 'finalized' | 'cancelled';
  validation_status: 'pass' | 'warn' | 'block' | null;
  validation_results: import('./index').ValidationCheckResult[];
  validation_overridden: boolean;
  override_reason: string | null;
  override_evidence_revision: number | null;
  override_validation_generation: number | null;
  created_at: string;
}
export type WorkflowState = 'Awaiting AI' | 'Awaiting Field Response' | 'Response Received'
  | 'Reprocessing Evidence' | 'Validating Selected Activity' | 'Validation Blocked'
  | 'Ready to Confirm Remap' | 'Reviewable' | 'Finalized';
export type WorkflowResult = { success: boolean; error?: string };
