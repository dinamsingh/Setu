-- Synthetic, minimal Supabase-shaped fixture for native PostgreSQL 17 CI only.
-- NEVER execute this fixture on live Supabase or any persistent database.
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), '');
$$;

CREATE TABLE public.user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  role text NOT NULL CHECK (role IN ('site','engineer','planner','admin'))
);

CREATE FUNCTION public.current_user_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid();
$$;

CREATE TABLE public.field_updates (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  update_id text NOT NULL UNIQUE,
  source_type text NOT NULL,
  field_text text NOT NULL,
  site_location text,
  reported_by text,
  discipline text,
  reported_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  confidence_level text,
  confidence_score double precision,
  matched_activity_id text,
  expanded_text text,
  matched_layer text,
  candidate_matches jsonb DEFAULT '[]'::jsonb,
  validation_status text,
  validation_results jsonb DEFAULT '[]'::jsonb,
  validation_overridden boolean NOT NULL DEFAULT false,
  evidence_revision bigint NOT NULL DEFAULT 0,
  workflow_revision bigint NOT NULL DEFAULT 0,
  submitted_by_user_id uuid REFERENCES auth.users(id)
);
CREATE SCHEMA IF NOT EXISTS extensions;

GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;
GRANT SELECT, INSERT ON public.field_updates TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_updates TO service_role;

ALTER TABLE public.field_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY field_site_engineer_select_own ON public.field_updates
  FOR SELECT TO authenticated
  USING (submitted_by_user_id = (SELECT auth.uid())
         AND (SELECT public.current_user_role()) IN ('site', 'engineer'));
CREATE POLICY field_planner_admin_select_all ON public.field_updates
  FOR SELECT TO authenticated
  USING ((SELECT public.current_user_role()) IN ('planner', 'admin'));
-- Explicitly retain the old permissive INSERT policy to prove that 014's
-- SQL GRANT revocation blocks direct writes *independently* from RLS.
CREATE POLICY field_site_engineer_insert_own ON public.field_updates
  FOR INSERT TO authenticated
  WITH CHECK (submitted_by_user_id = (SELECT auth.uid())
              AND (SELECT public.current_user_role()) IN ('site', 'engineer'));
CREATE POLICY roles_authenticated_read_self ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

INSERT INTO auth.users(id) VALUES
  ('10000000-0000-4000-8000-000000000001'::uuid),
  ('10000000-0000-4000-8000-000000000002'::uuid),
  ('10000000-0000-4000-8000-000000000003'::uuid);
INSERT INTO public.user_roles(user_id, role) VALUES
  ('10000000-0000-4000-8000-000000000001'::uuid, 'site'),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'engineer'),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'planner');
