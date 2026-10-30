-- Emergency rollback for migration 016 BEFORE public demo accounts have been issued.
-- No deletion of real users or any existing SETU reports. Transactional.
-- This intentionally refuses to run if evaluator accounts exist, because
-- removing their RLS protections without deleting identities would expose data.
BEGIN;
SET LOCAL lock_timeout = '4s';
DO $$
BEGIN
 IF to_regclass('public.evaluator_accounts') IS NOT NULL
    AND (SELECT count(*) FROM public.evaluator_accounts) > 0 THEN
  RAISE EXCEPTION 'Cannot roll back isolation with active evaluator auth accounts. Revoke/delete evaluator identities first.';
 END IF;
END $$;
DROP TRIGGER IF EXISTS evaluator_report_guard ON public.field_updates;
DROP TRIGGER IF EXISTS evaluator_audit_guard ON public.planner_audit_logs;
DROP TRIGGER IF EXISTS evaluator_clarifications_guard ON public.field_update_clarifications;
DROP TRIGGER IF EXISTS evaluator_remap_guard ON public.field_update_remap_proposals;
DROP TRIGGER IF EXISTS evaluator_progress_guard ON public.progress_events;

DROP POLICY IF EXISTS evaluator_reports_select ON public.field_updates;
DROP POLICY IF EXISTS evaluator_audit_select ON public.planner_audit_logs;
DROP POLICY IF EXISTS evaluator_clarifications_select ON public.field_update_clarifications;
DROP POLICY IF EXISTS evaluator_remaps_select ON public.field_update_remap_proposals;
DROP POLICY IF EXISTS evaluator_progress_select ON public.progress_events;
DROP POLICY IF EXISTS evaluator_schedule_active ON public.schedule_activities;
DROP POLICY IF EXISTS evaluator_aliases_active ON public.domain_aliases;
DROP POLICY IF EXISTS evaluator_roles_active ON public.user_roles;
DROP POLICY IF EXISTS evaluator_schedule_no_insert ON public.schedule_activities;
DROP POLICY IF EXISTS evaluator_schedule_no_update ON public.schedule_activities;
DROP POLICY IF EXISTS evaluator_schedule_no_delete ON public.schedule_activities;
DROP POLICY IF EXISTS evaluator_aliases_no_insert ON public.domain_aliases;
DROP POLICY IF EXISTS evaluator_aliases_no_update ON public.domain_aliases;
DROP POLICY IF EXISTS evaluator_aliases_no_delete ON public.domain_aliases;
DROP POLICY IF EXISTS evaluator_roles_no_insert ON public.user_roles;
DROP POLICY IF EXISTS evaluator_roles_no_update ON public.user_roles;
DROP POLICY IF EXISTS evaluator_roles_no_delete ON public.user_roles;

-- Restore the EXACT current_user_role() definition read from live SETU
-- immediately prior to migration 016.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
 SELECT role FROM public.user_roles
 WHERE user_id = (SELECT auth.uid())
 LIMIT 1;
$$;
-- Restore common pre-016 read behavior (original function is public-executable).
GRANT EXECUTE ON FUNCTION public.current_user_role() TO PUBLIC;

DROP FUNCTION IF EXISTS public.evaluator_guard_report_mutation();
DROP FUNCTION IF EXISTS public.evaluator_guard_related_mutation();
DROP FUNCTION IF EXISTS public.evaluator_can_read_report(uuid);
DROP FUNCTION IF EXISTS public.evaluator_can_read_submitter(uuid);
DROP FUNCTION IF EXISTS public.evaluator_active();
DROP FUNCTION IF EXISTS public.evaluator_user();
DROP FUNCTION IF EXISTS public.reserve_evaluator_workspace(text);
DROP TABLE IF EXISTS public.evaluator_accounts;
DROP TABLE IF EXISTS public.evaluator_workspaces;
COMMIT;
