-- Disposable PG17 fixture only. NEVER run on production.
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TABLE public.user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),role text NOT NULL
);
CREATE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT role FROM public.user_roles WHERE user_id=auth.uid() LIMIT 1;
$$;
CREATE TABLE public.field_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by_user_id uuid REFERENCES auth.users(id),
  field_text text, status text DEFAULT 'pending'
);
CREATE TABLE public.planner_audit_logs (id uuid DEFAULT gen_random_uuid() PRIMARY KEY,field_update_id uuid NOT NULL);
CREATE TABLE public.field_update_clarifications (id uuid DEFAULT gen_random_uuid() PRIMARY KEY,field_update_id uuid NOT NULL);
CREATE TABLE public.field_update_remap_proposals (id uuid DEFAULT gen_random_uuid() PRIMARY KEY,field_update_id uuid NOT NULL);
CREATE TABLE public.progress_events (id uuid DEFAULT gen_random_uuid() PRIMARY KEY,field_update_id uuid NOT NULL);
CREATE TABLE public.domain_aliases (id uuid DEFAULT gen_random_uuid() PRIMARY KEY,name text);
CREATE TABLE public.schedule_activities (id text PRIMARY KEY,name text);

GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planner_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_update_clarifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_update_remap_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY roles_self ON public.user_roles FOR SELECT TO authenticated
USING (user_id=auth.uid());
CREATE POLICY updates_planner_read ON public.field_updates FOR SELECT TO authenticated
USING (public.current_user_role()='planner');
CREATE POLICY updates_site_own ON public.field_updates FOR SELECT TO authenticated
USING (submitted_by_user_id=auth.uid());
CREATE POLICY updates_insert ON public.field_updates FOR INSERT TO authenticated
WITH CHECK (submitted_by_user_id=auth.uid());
CREATE POLICY updates_update ON public.field_updates FOR UPDATE TO authenticated USING (true) WITH CHECK(true);
CREATE POLICY audit_read ON public.planner_audit_logs FOR SELECT TO authenticated USING(public.current_user_role()='planner');
CREATE POLICY clarification_read ON public.field_update_clarifications FOR SELECT TO authenticated USING(public.current_user_role()='planner');
CREATE POLICY remap_read ON public.field_update_remap_proposals FOR SELECT TO authenticated USING(public.current_user_role()='planner');
CREATE POLICY progress_read ON public.progress_events FOR SELECT TO authenticated USING(true);
CREATE POLICY aliases_read ON public.domain_aliases FOR SELECT TO authenticated USING(true);
CREATE POLICY schedule_read ON public.schedule_activities FOR SELECT TO authenticated USING(true);
CREATE POLICY alias_update ON public.domain_aliases FOR UPDATE TO authenticated USING(true) WITH CHECK(true);

INSERT INTO auth.users(id,email) VALUES
('10000000-0000-4000-8000-000000000001','site@project.example'),
('10000000-0000-4000-8000-000000000002','planner@project.example'),
('10000000-0000-4000-8000-000000000003','site@demo.invalid'),
('10000000-0000-4000-8000-000000000004','planner@demo.invalid'),
('10000000-0000-4000-8000-000000000005','site-b@demo.invalid'),
('10000000-0000-4000-8000-000000000006','planner-b@demo.invalid');
INSERT INTO public.user_roles VALUES
('10000000-0000-4000-8000-000000000001','site'),
('10000000-0000-4000-8000-000000000002','planner'),
('10000000-0000-4000-8000-000000000003','site'),
('10000000-0000-4000-8000-000000000004','planner'),
('10000000-0000-4000-8000-000000000005','site'),
('10000000-0000-4000-8000-000000000006','planner');
INSERT INTO public.field_updates(id,submitted_by_user_id,field_text) VALUES
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','historic project'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','demo report A'),
('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000005','demo report B');
INSERT INTO public.schedule_activities VALUES('OIL-PIP-202-A','Synthetic schedule fixture');
INSERT INTO public.domain_aliases(name) VALUES('spool');
