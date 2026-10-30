-- Migration 017: planner-scoped supervisors and baselines.
--
-- PROBLEM (verified 2026-10-30): schedule_activities has no owner or
-- assignment column and is globally readable by every authenticated user.
-- The 220 activities currently in the live database are, by ID, exactly the
-- synthetic sample in data/synthetic_p6_schedule.csv. They are NOT original
-- company data, and they must not remain a live project baseline for everyone.
--
-- MODEL INTRODUCED HERE:
-- * schedule_baselines: one row per schedule upload. A planner owns the
--   baselines they upload. Exactly one system row is the Sample Baseline.
-- * planner_supervisor_assignments: a planner assigns a supervisor to one
--   baseline. A supervisor sees only the baselines they are assigned to.
-- * schedule_activities.baseline_id: every activity belongs to one baseline.
--   The existing 220 activities are backfilled to the Sample Baseline only.
-- * Evaluator accounts use the same scoped model: they may read the Sample
--   Baseline only, never another planner's baseline, and never write to it.
--
-- WHAT THIS DOES NOT DO:
-- * It does not delete any table, row, activity, report or account.
-- * It does not change matching, workflow, counts, filters or audit logic.
--   Matching scope enforcement in the worker is a follow-up: the worker must
--   filter candidates by the report submitter's assigned baseline once this
--   migration is live. Until then, the scoped READ policies below are the
--   access boundary for the UI, and the matching worker still uses the
--   global index — see docs/PLANNER_SCOPED_SUPERVISORS.md.
-- * It does not, by itself, activate anything live. Applying it requires a
--   verified restorable backup first, then the create-planner-supervisor
--   Edge Function deployment, then a frontend merge. This task applies
--   nothing to live Supabase.
--
-- ROLLBACK NOTE (non-destructive only):
-- * To roll back, drop ONLY the new policies and the two new tables, in
--   reverse order. Do NOT drop schedule_activities, do NOT delete its rows,
--   and do NOT drop the baseline_id column or the Sample Baseline row —
--   they are metadata only and keep the backfill intact. If the old global
--   read policy must be restored, re-create it explicitly after review;
--   this file deliberately replaces it with scoped policies, so a plain
--   revert of this file alone does not silently re-open global reads.
-- * There is no automatic rollback script: a rollback is a reviewed,
--   audited manual step, exactly like Migration 014.
BEGIN;

-- 1. Baselines -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_planner_id uuid NULL,
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_baselines_name_unique UNIQUE (name)
);
CREATE INDEX IF NOT EXISTS schedule_baselines_owner_idx
  ON public.schedule_baselines (owner_planner_id);
CREATE INDEX IF NOT EXISTS schedule_baselines_sample_idx
  ON public.schedule_baselines (is_sample) WHERE is_sample;

ALTER TABLE public.schedule_baselines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schedule_baselines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.schedule_baselines TO authenticated;
GRANT ALL ON public.schedule_baselines TO service_role;

-- The Sample Baseline is the labelled home of the old 220 activities.
-- owner_planner_id is NULL on purpose: it is a system sample, not a planner's
-- live project, and no planner owns it.
INSERT INTO public.schedule_baselines (name, owner_planner_id, is_sample)
VALUES ('Sample Baseline', NULL, true)
ON CONFLICT (name) DO NOTHING;

-- 2. Activity -> baseline link --------------------------------------------
ALTER TABLE public.schedule_activities
  ADD COLUMN IF NOT EXISTS baseline_id uuid
  REFERENCES public.schedule_baselines (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS schedule_activities_baseline_idx
  ON public.schedule_activities (baseline_id);

-- Backfill only: activities with no baseline yet join the Sample Baseline.
-- Existing rows are never deleted or rewritten beyond this metadata link.
UPDATE public.schedule_activities
SET baseline_id = (SELECT id FROM public.schedule_baselines WHERE is_sample LIMIT 1)
WHERE baseline_id IS NULL;

-- 3. Planner -> supervisor assignments --------------------------------------
CREATE TABLE IF NOT EXISTS public.planner_supervisor_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_id uuid NOT NULL REFERENCES public.schedule_baselines (id) ON DELETE CASCADE,
  supervisor_id uuid NOT NULL,
  planner_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planner_supervisor_assignment_unique UNIQUE (baseline_id, supervisor_id)
);
CREATE INDEX IF NOT EXISTS planner_supervisor_assignments_baseline_idx
  ON public.planner_supervisor_assignments (baseline_id);
CREATE INDEX IF NOT EXISTS planner_supervisor_assignments_supervisor_idx
  ON public.planner_supervisor_assignments (supervisor_id);
CREATE INDEX IF NOT EXISTS planner_supervisor_assignments_planner_idx
  ON public.planner_supervisor_assignments (planner_id);

ALTER TABLE public.planner_supervisor_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planner_supervisor_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.planner_supervisor_assignments TO authenticated;
GRANT ALL ON public.planner_supervisor_assignments TO service_role;

-- 4. Scoped read policies ---------------------------------------------------
-- Baselines: a planner reads their own baselines; any authenticated user
-- may read the labelled Sample Baseline; a supervisor reads baselines they
-- are assigned to. Nothing else is readable through these policies.
DROP POLICY IF EXISTS schedule_baselines_owner_read ON public.schedule_baselines;
CREATE POLICY schedule_baselines_owner_read ON public.schedule_baselines
  FOR SELECT TO authenticated USING (owner_planner_id = auth.uid());
DROP POLICY IF EXISTS schedule_baselines_sample_read ON public.schedule_baselines;
CREATE POLICY schedule_baselines_sample_read ON public.schedule_baselines
  FOR SELECT TO authenticated USING (is_sample = true);
DROP POLICY IF EXISTS schedule_baselines_assigned_read ON public.schedule_baselines;
CREATE POLICY schedule_baselines_assigned_read ON public.schedule_baselines
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.planner_supervisor_assignments a
      WHERE a.baseline_id = public.schedule_baselines.id
        AND a.supervisor_id = auth.uid()
    )
  );
-- No INSERT/UPDATE/DELETE policy for authenticated users: only service_role
-- (via the planner-supervisor Edge Function and future admin import) writes
-- baselines. The Sample Baseline is therefore read-only for every app user.

-- Assignments: a planner lists their own assignments; a supervisor lists
-- only assignments naming them. Creation is service_role only, through the
-- Edge Function, which verifies baseline ownership first.
DROP POLICY IF EXISTS assignments_planner_read ON public.planner_supervisor_assignments;
CREATE POLICY assignments_planner_read ON public.planner_supervisor_assignments
  FOR SELECT TO authenticated USING (planner_id = auth.uid());
DROP POLICY IF EXISTS assignments_supervisor_read ON public.planner_supervisor_assignments;
CREATE POLICY assignments_supervisor_read ON public.planner_supervisor_assignments
  FOR SELECT TO authenticated USING (supervisor_id = auth.uid());

-- Activities: replace the old global authenticated read with scoped reads.
-- A planner reads activities of baselines they own; a supervisor reads
-- activities of baselines they are assigned to; everyone may read the
-- labelled Sample Baseline. Dropping the old policy is intentional and is
-- the access change of this migration — it is a policy change, not a data
-- deletion. Existing permissive policies from earlier migrations for other
-- roles are left untouched except for this one named policy.
DROP POLICY IF EXISTS schedule_authenticated_read ON public.schedule_activities;
DROP POLICY IF EXISTS schedule_activities_scoped_read ON public.schedule_activities;
CREATE POLICY schedule_activities_scoped_read ON public.schedule_activities
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.schedule_baselines b
      WHERE b.id = public.schedule_activities.baseline_id
        AND (
          b.owner_planner_id = auth.uid()
          OR b.is_sample = true
          OR EXISTS (
            SELECT 1 FROM public.planner_supervisor_assignments a
            WHERE a.baseline_id = b.id AND a.supervisor_id = auth.uid()
          )
        )
    )
  );
-- No new INSERT/UPDATE/DELETE policy for authenticated users on
-- schedule_activities: the Sample Baseline stays read-only for app users,
-- and writes remain service_role only, as before this migration.

COMMIT;
