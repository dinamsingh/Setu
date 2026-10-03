import type { FieldUpdate } from '../types';
import type { Clarification, RemapProposal } from '../types/workflow';
export const report: FieldUpdate = {
  id: 'report', update_id: 'UPD-TEST', source_type: 'manual_text', field_text: 'Original evidence',
  site_location: 'Area A', reported_by: 'Display name only', submitted_by_user_id: 'site',
  expanded_text: null, matched_activity_id: 'ACT-A', confidence_score: .9, confidence_level: 'High',
  matched_layer: 'semantic', candidate_matches: [], validation_status: 'pass', validation_results: [],
  validation_overridden: false, status: 'pending', planner_remarks: null, reported_date: '2026-10-03',
  created_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:00:00Z',
  evidence_revision: 0, validation_evidence_revision: 0, workflow_revision: 1,
};
export const round: Clarification = {
  id: 'round', field_update_id: 'report', mode: 'request_response', recipient_user_id: 'site',
  question: 'Which location?', response: null, communication_method: null, supplied_by: null,
  requested_by_user_id: 'planner', responded_by_user_id: null, status: 'open', triage_impact: null,
  triage_note: null, created_at: '2026-10-03T10:00:00Z', responded_at: null, resolved_at: null, cancelled_at: null,
};
export const proposal: RemapProposal = {
  id: 'proposal', field_update_id: 'report', target_activity_id: 'ACT-B', evidence_revision: 0,
  workflow_revision: 1, validation_generation: 1, validated_generation: null, validation_evidence_revision: null,
  status: 'pending_validation', validation_status: null, validation_results: [], validation_overridden: false,
  override_reason: null, override_evidence_revision: null, override_validation_generation: null, created_at: '2026-10-03T10:00:00Z',
};
