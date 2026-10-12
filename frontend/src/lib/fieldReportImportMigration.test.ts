import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIELD_REPORT_IMPORT_DEPLOYMENT, isFieldReportImportEnabled } from './fieldReportImportDeployment';

const sql = readFileSync(new URL('../../../database/migrations/013_secure_field_report_import.sql', import.meta.url), 'utf8');
const compact = sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const lower = compact.toLowerCase();
describe('013 secure import static migration contracts (not DB execution)', () => {
  it('requires authenticated JWT identity and authoritative site/engineer role', () => {
    expect(lower).toContain("v_actor uuid := auth.uid()");
    expect(lower).toContain("auth.role() is distinct from 'authenticated'");
    expect(lower).toContain("coalesce(public.current_user_role(), '') not in ('site', 'engineer')");
    expect(lower.indexOf('only authenticated')).toBeLessThan(lower.indexOf('jsonb_array_length(p_rows)'));
  });
  it('exposes only the authenticated RPC, with no exposed trigger helper', () => {
    expect(lower).toContain("returns jsonb language plpgsql security definer set search_path = ''");
    expect(lower).toContain('revoke execute on function public.import_field_reports(uuid, text, jsonb) from public, anon, authenticated, service_role;');
    expect(lower).toContain('grant execute on function public.import_field_reports(uuid, text, jsonb) to authenticated;');
    expect(lower).toContain('revoke execute on function public.protect_spreadsheet_field_update() from public, anon, authenticated, service_role;');
  });
  it('keeps both receipt tables owner-only with RLS and no browser policies', () => {
    expect(lower).toContain('alter table public.field_report_import_batches enable row level security;');
    expect(lower).toContain('alter table public.field_report_import_rows enable row level security;');
    expect(lower).toContain('revoke all on public.field_report_import_batches, public.field_report_import_rows from public, anon, authenticated, service_role;');
    expect(lower).not.toContain('create policy');
    expect(lower.match(/alter table public\.\w+/g)).toEqual(['alter table public.field_report_import_batches','alter table public.field_report_import_rows']);
  });
  it('uses database uniqueness for actor-scoped requests and cross-upload report identity', () => {
    expect(lower).toContain('primary key (actor_user_id, request_id)');
    expect(lower).toContain('primary key (actor_user_id, fingerprint)');
    expect(lower).toContain('on conflict (actor_user_id, request_id) do nothing');
    expect(lower).toContain('on conflict (actor_user_id, fingerprint) do nothing');
    expect(lower).toContain('on delete restrict deferrable initially deferred');
    expect(lower).toContain('v_existing.canonical_row is distinct from v_canonical');
  });
  it('uses stable lock order and a separate post-conflict SELECT without unbounded retries', () => {
    expect(lower).toContain("order by pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(c::text, 'utf8')), 'hex'), (r->>'row_number')::integer");
    expect(lower).toContain('select * into v_batch from public.field_report_import_batches');
    expect(lower).toContain('select * into v_existing from public.field_report_import_rows');
    expect(lower).toContain("using errcode = '40001'");
    expect(lower).not.toMatch(/while|skip locked|pg_advisory|on conflict[^;]+do update/);
  });
  it('validates a bounded array of exact typed fields with strict dates and disciplines', () => {
    expect(lower).toContain("pg_catalog.jsonb_typeof(p_rows) is distinct from 'array'");
    expect(lower).toContain('v_total < 1 or v_total > 1000');
    expect(lower).toContain('pg_catalog.octet_length(p_rows::text) > 16777216');
    expect(lower).toContain('pg_catalog.char_length(v_value) > 10000');
    expect(lower).toContain("pg_catalog.jsonb_typeof(v_row->v_key) <> 'string'");
    expect(lower).toContain("where key not in ('row_number', 'field_text', 'site_location', 'reported_date', 'reported_by', 'discipline')");
    expect(lower).toContain("'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'");
    expect(lower).toContain('exception when invalid_datetime_format or datetime_field_overflow');
    expect(lower).toContain("array['piping','pipeline','civil','electrical','mechanical','instrumentation']");
  });
  it('rejects invalid batches before any receipt/report insertion and does not swallow storage failures', () => {
    expect(lower.indexOf('if v_error_count > 0 then')).toBeLessThan(lower.indexOf('insert into public.field_report_import_batches'));
    expect(lower).toContain("'status','rejected'");
    expect(lower).toContain("'imported_count',0,'duplicate_count',0,'error_count',v_error_count");
    expect(lower).not.toContain('exception when others');
    expect(lower).not.toContain('exception when unique_violation');
    expect(lower).toMatch(/^begin; /); expect(lower).toMatch(/ commit;$/);
  });
  it('forces pipeline state and server-generated identity without client matching/approval data', () => {
    expect(compact).toContain("'pending', 'Pending', 0, null, null, null, '[]', null, '[]', false");
    expect(lower).toContain("v_id := pg_catalog.gen_random_uuid(); v_update_id := 'upd-imp-' || v_id::text");
    expect(lower).toContain("'spreadsheet_' || p_source_format");
    expect(lower).toContain("v_row->>'discipline', v_actor");
    expect(lower).not.toMatch(/v_row->>?'(?:confidence_score|matched_activity_id|submitted_by_user_id|status)'/);
  });
  it('reports retry as zero new imports and all duplicate rows, not repeated success counts', () => {
    expect(lower).toContain("'imported_count',0,'duplicate_count',v_total, 'replayed',true");
    expect(lower).toContain("'{\"outcome\":\"duplicate\"}'::jsonb");
    expect(lower).toContain('v_batch.payload is distinct from p_rows');
    expect(lower).toContain("'outcome',v_outcome");
  });
  it('adds only an import-specific guard and preserves old submission/discipline triggers', () => {
    expect(lower).toContain("if auth.role() = 'service_role' then return new; end if");
    expect(lower).toContain('old.reported_by is distinct from new.reported_by');
    expect(lower).toContain('before insert or update on public.field_updates');
    expect(lower).toContain('r.actor_user_id = auth.uid()');
    expect(lower).not.toContain('protect_field_update_original_submission');
    expect(lower).not.toContain('protect_field_update_discipline');
    expect(lower).not.toMatch(/insert into public\.(planner_audit_logs|schedule_activities)|update public\.(field_updates|schedule_activities)|delete from/);
  });
  it('keeps confirmation gated, SQL out of the wizard and manual submission unchanged', () => {
    const wizard = readFileSync(new URL('../components/supervisor/ReportImportWizard.tsx', import.meta.url), 'utf8');
    const manual = readFileSync(new URL('../hooks/useFieldUpdates.ts', import.meta.url), 'utf8');
    expect(wizard).not.toMatch(/supabase|import_field_reports|\.rpc\(|\.insert\(/);
    expect(wizard).toContain('ReportImportConfirmation');
    // Release values may be enabled after verification; enforce the gate contract,
    // not the development defaults. Runtime truth-table/adapter tests cover denial.
    expect(Object.keys(FIELD_REPORT_IMPORT_DEPLOYMENT).sort()).toEqual([
      'migration012Verified', 'migration013Verified', 'submissionEnabled',
    ]);
    expect(Object.values(FIELD_REPORT_IMPORT_DEPLOYMENT).every(value => typeof value === 'boolean')).toBe(true);
    expect(isFieldReportImportEnabled()).toBe(Object.values(FIELD_REPORT_IMPORT_DEPLOYMENT).every(value => value === true));
    const confirmation = readFileSync(new URL('../components/supervisor/ReportImportConfirmation.tsx', import.meta.url), 'utf8');
    expect(confirmation).not.toMatch(/supabase|import_field_reports|\.rpc\(|\.insert\(/);
    expect(confirmation).toContain('await submitFieldReportImport(request)');
    expect(manual).toContain("source_type: 'manual_text'");
    expect(manual).not.toContain('import_field_reports');
  });
});
