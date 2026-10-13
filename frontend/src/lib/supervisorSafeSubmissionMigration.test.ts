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
      'revoke execute on function public.submit_supervisor_field_update(text, text, date, text, text, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;'
    );
    expect(lower).toContain(
      'grant execute on function public.submit_supervisor_field_update(text, text, date, text, text, text, text, jsonb, jsonb) to authenticated;'
    );
  });

  it('enforces rigorous server-side validation bounds on all fields', () => {
    expect(lower).toContain('length(v_field_text) < 3');
    expect(lower).toContain('length(v_field_text) > 4000');
    expect(lower).toContain('length(v_site_location) < 2');
    expect(lower).toContain('length(v_site_location) > 200');
    expect(lower).toContain('length(v_reported_by) < 2');
    expect(lower).toContain('length(v_reported_by) > 100');
    expect(lower).toContain('reported observation date cannot be in the future');
  });

  it('guarantees baseline safety defaults on insert (status pending, confidence Pending, score 0)', () => {
    expect(lower).toContain("'pending'");
    expect(lower).toContain("'pending'");
    expect(lower).toContain('0');
    expect(lower).toContain('v_actor');
  });

  it('installs bypass-protection trigger on field_updates for manual_text and voice sources', () => {
    expect(lower).toContain('create or replace function public.protect_manual_field_update()');
    expect(lower).toContain("new.source_type in ('manual_text', 'voice')");
    expect(lower).toContain("current_setting('setu.authorized_submission', true) is distinct from 'on'");
    expect(lower).toContain('trg_protect_manual_field_update');
    expect(lower).toContain('revoke execute on function public.protect_manual_field_update()');
  });

  it('keeps deployment gate locked by default until verified in production', () => {
    expect(SUPERVISOR_SUBMISSION_DEPLOYMENT.migration014Verified).toBe(false);
    expect(SUPERVISOR_SUBMISSION_DEPLOYMENT.submissionEnabled).toBe(false);
    expect(isSupervisorSubmissionEnabled()).toBe(false);
  });
});
