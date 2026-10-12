import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('012 field-report intake migration contract (static; never applied)', () => {
  const sql = readFileSync(new URL('../../../database/migrations/012_field_report_intake.sql', import.meta.url), 'utf8');
  const compact = sql.replace(/--[^\n]*/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const body = compact.split('as $$')[1]?.split('$$;')[0]?.trim();

  it('keeps discipline nullable and optional without defaults or backfill', () => {
    expect(compact).toContain('alter table public.field_updates add column if not exists discipline text;');
    expect(compact).not.toMatch(/\b(not null|default|update public\.field_updates)\b/);
  });

  it('rejects all distinct changes, including NULL transitions, with only the service-role exception', () => {
    // Exact body contract excludes NULL-unsafe inequality and additional bypasses.
    expect(body).toBe("begin if auth.role() = 'service_role' then return new; end if; if old.discipline is distinct from new.discipline then raise exception 'immutable field: discipline cannot be modified after submission'; end if; return new; end;");
  });

  it('checks the JWT role before the guard and fails closed for absent role claims', () => {
    expect(body).toMatch(/^begin if auth\.role\(\) = 'service_role' then return new; end if; if old\.discipline is distinct from new\.discipline/);
    expect(compact).not.toMatch(/\b(current_user|session_user|current_user_role|coalesce)\b/);
  });

  it('uses an idempotent row-level BEFORE UPDATE guard on every update', () => {
    expect(compact).toContain('create or replace trigger trg_protect_field_update_discipline before update on public.field_updates for each row execute function public.protect_field_update_discipline();');
    expect(compact).not.toMatch(/\bbefore update of\b/);
  });

  it('uses an idempotent invoker function with a hardened search path', () => {
    expect(compact).toContain("create or replace function public.protect_field_update_discipline() returns trigger language plpgsql security invoker set search_path = '' as $$");
    expect(compact).not.toContain('security definer');
  });

  it('does not replace the original-submission guard or change grants/RLS/workflows', () => {
    expect(compact).not.toMatch(/protect_field_update_original_submission|trg_protect_field_update_submission/);
    expect(compact).not.toMatch(/\b(grant|revoke|policy|drop|enable row level security|disable row level security)\b/);
    expect(compact.match(/create or replace function [^(]+/g)).toEqual(['create or replace function public.protect_field_update_discipline']);
    expect(compact.match(/create or replace trigger \w+/g)).toEqual(['create or replace trigger trg_protect_field_update_discipline']);
    expect(compact.match(/alter table [^;]+;/g)).toEqual(['alter table public.field_updates add column if not exists discipline text;']);
  });

  it('keeps the additive migration in one transaction', () => {
    expect(compact).toMatch(/^begin; /);
    expect(compact).toMatch(/ commit;$/);
  });
});
