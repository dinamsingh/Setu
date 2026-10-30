-- Proposed, NOT PRODUCTION-APPLIED: public 48h isolated SETU evaluation.
-- Each provisioned workspace has exactly one Supervisor and one Planner.
-- Workspaces share read-only reference schedule, NOT each other's reports/audit.
-- Must be tested against a disposable PostgreSQL 17 fixture and audited before release.
BEGIN;

CREATE TABLE public.evaluator_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  revoked_at timestamptz,
  ip_hash text NOT NULL CHECK (ip_hash ~ '^[a-f0-9]{64}$')
);
CREATE INDEX evaluator_workspace_recent_by_ip ON public.evaluator_workspaces(ip_hash,created_at);
CREATE INDEX evaluator_workspace_recent ON public.evaluator_workspaces(created_at);

CREATE TABLE public.evaluator_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.evaluator_workspaces(id),
  role text NOT NULL CHECK (role IN ('site','planner')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,role)
);
CREATE INDEX evaluator_accounts_workspace ON public.evaluator_accounts(workspace_id);

ALTER TABLE public.evaluator_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluator_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.evaluator_workspaces,public.evaluator_accounts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.evaluator_workspaces,public.evaluator_accounts TO service_role;

-- Called only by the protected, server-side Edge Function. Atomic global and
-- per-IP admission limits, including concurrent callers. No public SQL EXECUTE.
-- Rate limits are safeguards; Cloudflare Turnstile is independently mandatory.
CREATE FUNCTION public.reserve_evaluator_workspace(p_ip_hash text)
RETURNS TABLE(workspace_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_ip_hash IS NULL OR p_ip_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid request fingerprint' USING ERRCODE='22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(71641038);
  IF (SELECT count(*) FROM public.evaluator_workspaces
      WHERE created_at > now()-interval '24 hours') >= 40 OR
     (SELECT count(*) FROM public.evaluator_workspaces
      WHERE ip_hash=p_ip_hash AND created_at > now()-interval '1 hour') >= 2 OR
     (SELECT count(*) FROM public.evaluator_workspaces
      WHERE ip_hash=p_ip_hash AND created_at > now()-interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'Evaluator creation quota reached; try later'
      USING ERRCODE='P0001';
  END IF;
  RETURN QUERY
    INSERT INTO public.evaluator_workspaces(ip_hash) VALUES(p_ip_hash)
    RETURNING id,public.evaluator_workspaces.expires_at;
END $$;
REVOKE ALL ON FUNCTION public.reserve_evaluator_workspace(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_evaluator_workspace(text) TO service_role;

-- An expired evaluator must lose role, reports, schedule and audit even with a
-- still-valid JWT. Non-evaluator production users preserve their current roles.
CREATE OR REPLACE FUNCTION public.evaluator_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT coalesce((
   SELECT a.expires_at > now() AND a.revoked_at IS NULL
     AND w.expires_at > now() AND w.revoked_at IS NULL
   FROM public.evaluator_accounts a
   JOIN public.evaluator_workspaces w ON w.id=a.workspace_id
   WHERE a.user_id=auth.uid()
 ),true);
$$;
REVOKE ALL ON FUNCTION public.evaluator_active() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.evaluator_active() TO authenticated;

CREATE OR REPLACE FUNCTION public.evaluator_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.evaluator_accounts WHERE user_id=auth.uid());
$$;
REVOKE ALL ON FUNCTION public.evaluator_user() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.evaluator_user() TO authenticated;

-- Symmetric isolation: evaluator sees only its OWN workspace's records; ordinary
-- planners/site accounts see only ordinary records, never evaluator workspaces.
CREATE OR REPLACE FUNCTION public.evaluator_can_read_submitter(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT CASE WHEN EXISTS(
   SELECT 1 FROM public.evaluator_accounts WHERE user_id=auth.uid()
 ) THEN EXISTS(
   SELECT 1 FROM public.evaluator_accounts viewer
   JOIN public.evaluator_workspaces w ON w.id=viewer.workspace_id
   JOIN public.evaluator_accounts author ON author.workspace_id=viewer.workspace_id
   WHERE viewer.user_id=auth.uid()
     AND viewer.expires_at > now() AND viewer.revoked_at IS NULL
     AND w.expires_at > now() AND w.revoked_at IS NULL
     AND author.user_id=p_user_id
 ) ELSE NOT EXISTS(
   SELECT 1 FROM public.evaluator_accounts a WHERE a.user_id=p_user_id
 ) END;
$$;
REVOKE ALL ON FUNCTION public.evaluator_can_read_submitter(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.evaluator_can_read_submitter(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.evaluator_can_read_report(p_report_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(
   SELECT 1 FROM public.field_updates f
   WHERE f.id=p_report_id
     AND public.evaluator_can_read_submitter(f.submitted_by_user_id)
 );
$$;
REVOKE ALL ON FUNCTION public.evaluator_can_read_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.evaluator_can_read_report(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT r.role FROM public.user_roles r
 WHERE r.user_id=auth.uid()
   AND public.evaluator_active()
 LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- RESTRICTIVE SELECT policies always AND with current permissive RLS.
-- Normal planner cannot view demo groups; demo planner sees only its pair.
CREATE POLICY evaluator_reports_select ON public.field_updates
 AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.evaluator_can_read_submitter(submitted_by_user_id));
CREATE POLICY evaluator_audit_select ON public.planner_audit_logs
 AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.evaluator_can_read_report(field_update_id));
CREATE POLICY evaluator_clarifications_select ON public.field_update_clarifications
 AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.evaluator_can_read_report(field_update_id));
CREATE POLICY evaluator_remaps_select ON public.field_update_remap_proposals
 AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.evaluator_can_read_report(field_update_id));
CREATE POLICY evaluator_progress_select ON public.progress_events
 AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.evaluator_can_read_report(field_update_id));

CREATE POLICY evaluator_schedule_active ON public.schedule_activities
 AS RESTRICTIVE FOR SELECT TO authenticated USING (public.evaluator_active());
CREATE POLICY evaluator_aliases_active ON public.domain_aliases
 AS RESTRICTIVE FOR SELECT TO authenticated USING (public.evaluator_active());
CREATE POLICY evaluator_roles_active ON public.user_roles
 AS RESTRICTIVE FOR SELECT TO authenticated USING (public.evaluator_active());

-- Evaluators cannot change global schedule, aliases, or user role assignments.
CREATE POLICY evaluator_schedule_no_insert ON public.schedule_activities
 AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.evaluator_user());
CREATE POLICY evaluator_schedule_no_update ON public.schedule_activities
 AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (NOT public.evaluator_user()) WITH CHECK (NOT public.evaluator_user());
CREATE POLICY evaluator_schedule_no_delete ON public.schedule_activities
 AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.evaluator_user());
CREATE POLICY evaluator_aliases_no_insert ON public.domain_aliases
 AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.evaluator_user());
CREATE POLICY evaluator_aliases_no_update ON public.domain_aliases
 AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (NOT public.evaluator_user()) WITH CHECK (NOT public.evaluator_user());
CREATE POLICY evaluator_aliases_no_delete ON public.domain_aliases
 AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.evaluator_user());
CREATE POLICY evaluator_roles_no_insert ON public.user_roles
 AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.evaluator_user());
CREATE POLICY evaluator_roles_no_update ON public.user_roles
 AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (NOT public.evaluator_user()) WITH CHECK (NOT public.evaluator_user());
CREATE POLICY evaluator_roles_no_delete ON public.user_roles
 AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.evaluator_user());

-- SECURITY DEFINER planner RPCs bypass RLS. Row-level guards therefore verify
-- each mutation against the actor's workspace, in BOTH directions.
-- Background service_role workers have NULL auth.uid() and remain functional.
CREATE FUNCTION public.evaluator_guard_report_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
 IF v_actor IS NULL THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='DELETE' THEN
   IF NOT public.evaluator_can_read_submitter(OLD.submitted_by_user_id)
      OR public.evaluator_user() THEN
     RAISE EXCEPTION 'Report is outside your workspace' USING ERRCODE='42501';
   END IF;
   RETURN OLD;
 END IF;
 IF TG_OP='INSERT' AND public.evaluator_user() THEN
   IF NOT public.evaluator_active() OR NEW.submitted_by_user_id IS DISTINCT FROM v_actor THEN
     RAISE EXCEPTION 'Evaluator submission is not authorized' USING ERRCODE='42501';
   END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
   IF NOT public.evaluator_can_read_submitter(OLD.submitted_by_user_id) OR
      NOT public.evaluator_can_read_submitter(NEW.submitted_by_user_id) THEN
     RAISE EXCEPTION 'Report is outside your workspace' USING ERRCODE='42501';
   END IF;
   IF public.evaluator_user() AND
      OLD.submitted_by_user_id IS DISTINCT FROM NEW.submitted_by_user_id THEN
     RAISE EXCEPTION 'Evaluator cannot reassign reports' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.evaluator_guard_report_mutation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER evaluator_report_guard BEFORE INSERT OR UPDATE OR DELETE
 ON public.field_updates FOR EACH ROW EXECUTE FUNCTION public.evaluator_guard_report_mutation();

CREATE FUNCTION public.evaluator_guard_related_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='DELETE' THEN
   IF public.evaluator_user() OR NOT public.evaluator_can_read_report(OLD.field_update_id) THEN
     RAISE EXCEPTION 'Audit/workflow row outside your workspace' USING ERRCODE='42501';
   END IF;
   RETURN OLD;
 END IF;
 IF NOT public.evaluator_can_read_report(NEW.field_update_id) OR
    (TG_OP='UPDATE' AND NOT public.evaluator_can_read_report(OLD.field_update_id)) THEN
   RAISE EXCEPTION 'Audit/workflow row outside your workspace' USING ERRCODE='42501';
 END IF;
 IF public.evaluator_user() AND TG_OP='UPDATE' AND
    OLD.field_update_id IS DISTINCT FROM NEW.field_update_id THEN
   RAISE EXCEPTION 'Cannot move audit/workflow rows between reports' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.evaluator_guard_related_mutation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER evaluator_audit_guard BEFORE INSERT OR UPDATE OR DELETE
 ON public.planner_audit_logs FOR EACH ROW EXECUTE FUNCTION public.evaluator_guard_related_mutation();
CREATE TRIGGER evaluator_clarifications_guard BEFORE INSERT OR UPDATE OR DELETE
 ON public.field_update_clarifications FOR EACH ROW EXECUTE FUNCTION public.evaluator_guard_related_mutation();
CREATE TRIGGER evaluator_remap_guard BEFORE INSERT OR UPDATE OR DELETE
 ON public.field_update_remap_proposals FOR EACH ROW EXECUTE FUNCTION public.evaluator_guard_related_mutation();
CREATE TRIGGER evaluator_progress_guard BEFORE INSERT OR UPDATE OR DELETE
 ON public.progress_events FOR EACH ROW EXECUTE FUNCTION public.evaluator_guard_related_mutation();

COMMIT;
