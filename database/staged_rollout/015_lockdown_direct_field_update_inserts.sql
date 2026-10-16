-- Phase 4: Stage C - Native Privilege Lockdown for public.field_updates
-- 
-- MANUAL RELEASE BARRIER - DO NOT DEPLOY AUTOMATICALLY
--
-- Deployment Prerequisites:
-- 1. Stage A (Migration 014) is applied to the target Supabase/PostgreSQL database.
-- 2. Stage B (Supervisor Frontend PR) is deployed and verified in production.
-- 3. Live traffic inspection confirms all Supervisor submissions use the authoritative
--    public.submit_supervisor_field_update RPC.
-- 4. No legacy clients or external integrations are issuing direct INSERTs to public.field_updates.
--
-- Rollout Action:
-- An authorized database operator runs this transaction manually against production Supabase.

begin;

-- 1. Remove any legacy or flawed triggers if present
drop trigger if exists trg_protect_manual_field_update on public.field_updates;
drop trigger if exists trg_protect_field_update_insert_boundary on public.field_updates;
drop function if exists public.protect_field_update_insert_boundary();

-- 2. Revoke direct INSERT privileges from all untrusted roles
revoke insert on table public.field_updates from authenticated, anon, public;

-- 3. Drop obsolete direct-insert client RLS policy
drop policy if exists "field_site_engineer_insert_own" on public.field_updates;

-- 4. Note on Authoritative RPCs and Privileged Writers:
--    - public.submit_supervisor_field_update is SECURITY DEFINER owned by postgres
--      and retains full table INSERT privileges.
--    - public.import_field_reports is SECURITY DEFINER owned by postgres
--      and retains full table INSERT privileges.
--    - Planner review functions (accept, review, requeue, override) perform authorized UPDATEs.
--    - service_role retains all privileges for background orchestrators.

commit;
