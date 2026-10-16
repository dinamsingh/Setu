import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SUPERVISOR_SUBMISSION_DEPLOYMENT,
  isSupervisorSubmissionEnabled,
  getSupervisorSubmissionDeploymentStatus,
} from './supervisorSubmissionDeployment';

const migration014Path = new URL('../../../database/migrations/014_supervisor_safe_submission.sql', import.meta.url);
const sql014 = readFileSync(migration014Path, 'utf8');
const lower014 = sql014.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const stageCLockdownPath = new URL('../../../database/staged_rollout/015_lockdown_direct_field_update_inserts.sql', import.meta.url);
const sqlStageC = readFileSync(stageCLockdownPath, 'utf8');
const lowerStageC = sqlStageC.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

describe('014 supervisor safe submission staged rollout static contracts', () => {
  it('requires authenticated JWT identity and authoritative site/engineer role in RPC', () => {
    expect(lower014).toContain('v_actor uuid := auth.uid()');
    expect(lower014).toContain("auth.role() is distinct from 'authenticated'");
    expect(lower014).toContain("coalesce(public.current_user_role(), '')");
    expect(lower014).toContain("('site', 'engineer')");
  });

  it('declares security definer with empty search path and least privilege grants', () => {
    expect(lower014).toContain("security definer set search_path = ''");
    expect(lower014).toContain(
      'revoke execute on function public.submit_supervisor_field_update(text, text, date, text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated, service_role;'
    );
    expect(lower014).toContain(
      'grant execute on function public.submit_supervisor_field_update(text, text, date, text, text, text, text, text, jsonb, jsonb) to authenticated;'
    );
    expect(lower014).toContain(
      'grant execute on function public.submit_supervisor_field_update(text, text, date, text, text, text, text, text, jsonb, jsonb) to service_role;'
    );
  });

  it('creates an isolated receipts table with RLS and no browser policies for idempotency and audit', () => {
    expect(lower014).toContain('create table if not exists public.supervisor_submission_receipts');
    expect(lower014).toContain('alter table public.supervisor_submission_receipts enable row level security;');
    expect(lower014).toContain('revoke all on public.supervisor_submission_receipts from public, anon, authenticated;');
    expect(lower014).toContain('grant all on public.supervisor_submission_receipts to service_role;');
    expect(lower014).toContain('primary key (actor_user_id, idempotency_key)');
    expect(lower014).toContain('on conflict (actor_user_id, idempotency_key) do nothing');
  });

  it('enforces strict Asia/Kolkata date boundary and rigorous field validation', () => {
    expect(lower014).toContain('length(v_field_text) < 3');
    expect(lower014).toContain('length(v_field_text) > 4000');
    expect(lower014).toContain('length(v_site_location) < 2');
    expect(lower014).toContain('length(v_site_location) > 200');
    expect(lower014).toContain('length(v_reported_by) < 2');
    expect(lower014).toContain('length(v_reported_by) > 100');
    expect(lower014).toContain("v_today_ist := (pg_catalog.timezone('asia/kolkata', pg_catalog.now()))::date");
    expect(lower014).toContain('if p_reported_date > v_today_ist then');
    expect(lower014).toContain('reported observation date cannot be in the future');
  });

  it('guarantees baseline safety defaults and keeps untrusted semantic metadata out of candidate matches and validation results', () => {
    expect(lower014).toContain("'pending'");
    expect(lower014).toContain("'pending'");
    expect(lower014).toContain('0');
    expect(lower014).toContain("'[]'::jsonb, null, '[]'::jsonb, false, 0, 0, v_actor");
  });

  it('cleans up flawed trigger in Stage A and preserves legacy client inserts during expansion', () => {
    // Stage A cleans up flawed trigger from earlier iterations without revoking direct table inserts prematurely
    expect(lower014).toContain('drop trigger if exists trg_protect_field_update_insert_boundary on public.field_updates;');
    expect(lower014).toContain('drop function if exists public.protect_field_update_insert_boundary();');
    expect(lower014).not.toContain('revoke insert on table public.field_updates');
  });

  it('enforces Stage C native privilege lockdown behind manual release barrier outside automatic migrations directory', () => {
    // Stage C is placed in database/staged_rollout/ to prevent automatic execution by CI / deployment tooling
    expect(existsSync(stageCLockdownPath)).toBe(true);
    expect(lowerStageC).toContain('revoke insert on table public.field_updates from authenticated, anon, public;');
    expect(lowerStageC).toContain('drop policy if exists "field_site_engineer_insert_own" on public.field_updates;');
    expect(lowerStageC).toContain('drop trigger if exists trg_protect_field_update_insert_boundary on public.field_updates;');
  });

  it('keeps deployment gate locked by default until verified in production', () => {
    expect(SUPERVISOR_SUBMISSION_DEPLOYMENT.migration014Verified).toBe(false);
    expect(SUPERVISOR_SUBMISSION_DEPLOYMENT.submissionEnabled).toBe(false);
    expect(isSupervisorSubmissionEnabled()).toBe(false);
    const status = getSupervisorSubmissionDeploymentStatus();
    expect(status.enabled).toBe(false);
    expect(status.message).toContain('locked pending verified deployment');
  });
});
