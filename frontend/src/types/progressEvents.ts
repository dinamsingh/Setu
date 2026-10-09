export interface ProgressEvent {
  id: string;
  field_update_id: string;
  evidence_revision: number;
  event_index: number;
  event_type: 'START' | 'FINISH' | 'PROGRESS' | 'UNKNOWN';
  event_date: string | null;
  progress_percent: number | null;
  evidence_text: string;
  extraction_reason: string;
  extraction_version: string;
  created_at: string;
}
