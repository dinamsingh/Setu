import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SUPERVISOR_SUBMISSION_DEPLOYMENT,
  isSupervisorSubmissionEnabled,
} from './supervisorSubmissionDeployment';

const sql = readFileSync(
  new URL('../../../database/migrations/014_supervisor_safe_submission.sql', import.meta.url),
  'utf8'
);
const compact = sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const lower = compact.toLowerCase();

describe('014 supervisor safe submission static migration contracts', () => {
  it('requires authenticated JWT identity and authoritative site/engineer role in RPC', () => {
    expect(lower).toContain('v_actor uuid := auth.uid()');
    expect(lower).toContain("auth.role() is distinct from 'authenticated'");
    expect(lower).toContain("coalesce(public.current_user_role(), '')");
    expect(lower).toContain("('site', 'engineer')");
  });

  it('declares security definer with empty search path and least privilege grants', () => {
    expect(lower).toContain("security definer set search_path = ''");
    expect(lower).toContain(
      'revoke execute on function public.submit_supervisor_field_update(text, text, date, text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;'
    );
    expect(lower).toContain(
      'grant execute on function public.submit_supervisor_field_update(text, text, date, text, text, text, text, text, jsonb, jsonb) to authenticated;'
    );
  });

  it('creates an isolated receipts table with RLS and no browser policies for idempotency and audit', () => {
    expect(lower).toContain('create table if not exists public.supervisor_submission_receipts');
    expect(lower).toContain('alter table public.supervisor_submission_receipts enable row level security;');
    expect(lower).toContain('revoke all on public.supervisor_submission_receipts from public, anon, authenticated, service_role;');
    expect(lower).toContain('primary key (actor_user_id, idempotency_key)');
    expect(lower).toContain('on conflict (actor_user_id, idempotency_key) do nothing');
  });

  it('enforces strict Asia/Kolkata date boundary and rigorous field validation', () => {
    expect(lower).toContain('length(v_field_text) < 3');
    expect(lower).toContain('length(v_field_text) > 4000');
    expect(lower).toContain('length(v_site_location) < 2');
    expect(lower).toContain('length(v_site_location) > 200');
    expect(lower).toContain('length(v_reported_by) < 2');
    expect(lower).toContain('length(v_reported_by) > 100');
    expect(lower).toContain("v_today_ist := (pg_catalog.timezone('asia/kolkata', pg_catalog.now()))::date");
    expect(lower).toContain('if p_reported_date > v_today_ist then');
    expect(lower).toContain('reported observation date cannot be in the future');
  });

  it('guarantees baseline safety defaults and keeps untrusted semantic metadata out of candidate matches and validation results', () => {
    expect(lower).toContain("'pending'");
    expect(lower).toContain("'pending'");
    expect(lower).toContain('0');
    expect(lower).toContain("'[]'::jsonb, null, '[]'::jsonb, false, 0, 0, v_actor");
  });

  it('installs authoritative bypass-protection trigger on field_updates blocking direct client inserts regardless of source_type', () => {
    expect(lower).toContain('create or replace function public.protect_field_update_insert_boundary()');
    expect(lower).toContain("if pg_catalog.current_user in ('authenticated', 'anon', 'public') then");
    expect(lower).toContain('direct client insert on field_updates is forbidden');
    expect(lower).toContain('trg_protect_field_update_insert_boundary');
    expect(lower).toContain('revoke execute on function public.protect_field_update_insert_boundary()');
  });

  it('keeps deployment gate locked by default until verified in production', () => {
    expect(SUPERVISOR_SUBMISSION_DEPLOYMENT.migration014Verified).toBe(false);
    expect(SUPERVISOR_SUBMISSION_DEPLOYMENT.submissionEnabled).toBe(false);
    expect(isSupervisorSubmissionEnabled()).toBe(false);
  });
});
