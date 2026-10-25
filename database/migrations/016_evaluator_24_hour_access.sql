-- Proposed migration (NOT production-applied): real 24-hour SIH evaluator access.
-- Review and run against disposable PG17 fixture before any production rollout.
-- Private link has 14 days to be opened ONCE. Access ends 24 hours after redemption.
-- Never send generated tokens to public GitHub, logs, or screenshots.
BEGIN;

CREATE TABLE public.evaluator_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_sha256 text UNIQUE NOT NULL CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  valid_until timestamptz NOT NULL,
  redeemed_at timestamptz,
  access_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.evaluator_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_id uuid NOT NULL REFERENCES public.evaluator_invites(id),
  role text NOT NULL CHECK (role IN ('site','planner')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invite_id,role)
);
CREATE INDEX evaluator_accounts_invite ON public.evaluator_accounts(invite_id);

ALTER TABLE public.evaluator_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluator_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.evaluator_invites,public.evaluator_accounts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.evaluator_invites,public.evaluator_accounts TO service_role;

-- Only the SQL editor owner may mint an invitation. The function is deliberately
-- NOT executable by any API role. Access after redemption is 24h, not 14 days.
CREATE FUNCTION public.issue_evaluator_invite()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_token text;
BEGIN
  v_token := pg_catalog.encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.evaluator_invites(token_sha256,valid_until)
  VALUES(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_token,'UTF8')),'hex'),now()+interval '14 days');
  RETURN 'https://setu-app.pages.dev/evaluator#invite='||v_token;
END $$;
REVOKE ALL ON FUNCTION public.issue_evaluator_invite() FROM PUBLIC,anon,authenticated,service_role;

-- Only an Edge Function using service_role can redeem the SHA256 digest, once.
-- The raw token is never stored. The row lock provided by UPDATE prevents replay.
CREATE FUNCTION public.claim_evaluator_invite(p_sha256 text)
RETURNS TABLE(invite_id uuid,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY
    UPDATE public.evaluator_invites AS i
    SET redeemed_at = now(), access_expires_at = now() + interval '24 hours'
    WHERE i.token_sha256 = p_sha256 AND i.redeemed_at IS NULL AND i.valid_until > now()
    RETURNING i.id,i.access_expires_at;
END $$;
REVOKE ALL ON FUNCTION public.claim_evaluator_invite(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evaluator_invite(text) TO service_role;

-- Role and object access independently expire, even if a browser still has a JWT.
-- Ordinary production users (not in evaluator_accounts) retain original behavior.
CREATE OR REPLACE FUNCTION public.evaluator_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT coalesce((
   SELECT a.expires_at > now() AND a.revoked_at IS NULL
   FROM public.evaluator_accounts a WHERE a.user_id=auth.uid()
 ),true);
$$;
REVOKE ALL ON FUNCTION public.evaluator_active() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.evaluator_active() TO authenticated;

CREATE OR REPLACE FUNCTION public.evaluator_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.evaluator_accounts a WHERE a.user_id=auth.uid());
$$;
REVOKE ALL ON FUNCTION public.evaluator_user() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.evaluator_user() TO authenticated;

CREATE OR REPLACE FUNCTION public.evaluator_can_read_submitter(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public.evaluator_accounts WHERE user_id=auth.uid())
 THEN true
 ELSE EXISTS(
   SELECT 1 FROM public.evaluator_accounts viewer
   JOIN public.evaluator_accounts author ON author.invite_id=viewer.invite_id
   WHERE viewer.user_id=auth.uid()
     AND viewer.expires_at > now() AND viewer.revoked_at IS NULL
     AND author.user_id=p_user_id
 ) END;
$$;
REVOKE ALL ON FUNCTION public.evaluator_can_read_submitter(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.evaluator_can_read_submitter(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.evaluator_can_read_report(p_report_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public.evaluator_accounts WHERE user_id=auth.uid())
 THEN true
 ELSE EXISTS(
  SELECT 1 FROM public.field_updates f
  JOIN public.evaluator_accounts author ON author.user_id=f.submitted_by_user_id
  JOIN public.evaluator_accounts viewer ON viewer.invite_id=author.invite_id
  WHERE f.id=p_report_id AND viewer.user_id=auth.uid()
    AND viewer.expires_at > now() AND viewer.revoked_at IS NULL
 ) END;
$$;
REVOKE ALL ON FUNCTION public.evaluator_can_read_report(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.evaluator_can_read_report(uuid) TO authenticated;

-- Preserve current semantics for normal SETU users; return NULL on evaluator expiry.
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT r.role FROM public.user_roles AS r
 WHERE r.user_id=auth.uid()
   AND NOT EXISTS(
     SELECT 1 FROM public.evaluator_accounts AS a
     WHERE a.user_id=r.user_id AND (a.expires_at <= now() OR a.revoked_at IS NOT NULL)
   )
 LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- Restrictive policies are ANDed with ALL existing permissive policies. This
-- isolates evaluator from historic production reports, comments and audit rows.
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

-- Expired evaluators must also lose read access to shared schedule/aliases/roles.
CREATE POLICY evaluator_schedule_active ON public.schedule_activities
AS RESTRICTIVE FOR SELECT TO authenticated USING (public.evaluator_active());
CREATE POLICY evaluator_aliases_active ON public.domain_aliases
AS RESTRICTIVE FOR SELECT TO authenticated USING (public.evaluator_active());
CREATE POLICY evaluator_roles_active ON public.user_roles
AS RESTRICTIVE FOR SELECT TO authenticated USING (public.evaluator_active());

-- Forbid evaluator writes to global schedule / alias dictionaries.
CREATE POLICY evaluator_schedule_no_insert ON public.schedule_activities
AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.evaluator_user());
CREATE POLICY evaluator_schedule_no_update ON public.schedule_activities
AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.evaluator_user()) WITH CHECK (NOT public.evaluator_user());
CREATE POLICY evaluator_schedule_no_delete ON public.schedule_activities
AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.evaluator_user());
CREATE POLICY evaluator_aliases_no_insert ON public.domain_aliases
AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.evaluator_user());
CREATE POLICY evaluator_aliases_no_update ON public.domain_aliases
AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.evaluator_user()) WITH CHECK (NOT public.evaluator_user());
CREATE POLICY evaluator_aliases_no_delete ON public.domain_aliases
AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.evaluator_user());

-- SECURITY DEFINER planner RPCs can bypass RLS, so row-level triggers explicitly
-- protect production reports and audit trail from evaluator mutations.
CREATE FUNCTION public.evaluator_guard_report_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.evaluator_accounts WHERE user_id=v_actor
  ) THEN
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.evaluator_accounts
    WHERE user_id=v_actor AND expires_at>now() AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'Evaluator access expired' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND
      (OLD.submitted_by_user_id IS DISTINCT FROM NEW.submitted_by_user_id)) THEN
    RAISE EXCEPTION 'Evaluator cannot delete or reassign reports' USING ERRCODE='42501';
  END IF;
  IF TG_OP='INSERT' AND NEW.submitted_by_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Evaluator reports must belong to the active Supervisor' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND NOT public.evaluator_can_read_submitter(OLD.submitted_by_user_id) THEN
    RAISE EXCEPTION 'Evaluator cannot modify production reports' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.evaluator_guard_report_mutation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER evaluator_report_guard BEFORE INSERT OR UPDATE OR DELETE
ON public.field_updates FOR EACH ROW EXECUTE FUNCTION public.evaluator_guard_report_mutation();

-- Guard all downstream workflow writes which reference field_update_id.
CREATE FUNCTION public.evaluator_guard_related_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(
   SELECT 1 FROM public.evaluator_accounts WHERE user_id=auth.uid()
 ) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'Evaluator cannot delete audit/workflow history' USING ERRCODE='42501';
 END IF;
 v_id := NEW.field_update_id;
 IF NOT public.evaluator_can_read_report(v_id) THEN
   RAISE EXCEPTION 'Evaluator may only modify its own demonstration workflow' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND OLD.field_update_id IS DISTINCT FROM NEW.field_update_id THEN
   RAISE EXCEPTION 'Evaluator cannot reassign workflow ownership' USING ERRCODE='42501';
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
