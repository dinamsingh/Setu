-- SETU Migration 014: production metadata preflight (READ ONLY).
-- NO DDL, no DML, no user data, no credentials; safe to rerun before rollout.
-- Pre-deployment expectation: Migration 013 exists; Migration 014 has NOT run.
-- This query does NOT verify a recoverable database backup or Supabase Auth UI.
WITH checks AS (
  SELECT 'PostgreSQL >= 17' AS check_name,
         (current_setting('server_version_num')::int >= 170000) AS passed
  UNION ALL
  SELECT 'Existing 013 secure CSV/XLSX RPC',
         to_regprocedure('public.import_field_reports(uuid,text,jsonb)') IS NOT NULL
  UNION ALL
  SELECT 'Original reports table exists',
         to_regclass('public.field_updates') IS NOT NULL
  UNION ALL
  SELECT 'Original roles table exists',
         to_regclass('public.user_roles') IS NOT NULL
  UNION ALL
  SELECT 'M014 supervisor RPC is not already present',
         to_regprocedure('public.submit_supervisor_field_update(text,text,date,text,text,text,text,text,jsonb,jsonb)') IS NULL
  UNION ALL
  SELECT 'M014 receipts table is not already present',
         to_regclass('public.supervisor_submission_receipts') IS NULL
  UNION ALL
  SELECT 'Required M014 field columns present',
         (SELECT count(*) = 21 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'field_updates'
            AND column_name IN (
              'id', 'update_id', 'source_type', 'field_text', 'site_location',
              'reported_by', 'discipline', 'reported_date', 'status',
              'confidence_level', 'confidence_score', 'matched_activity_id',
              'expanded_text', 'matched_layer', 'candidate_matches',
              'validation_status', 'validation_results',
              'validation_overridden', 'evidence_revision',
              'workflow_revision', 'submitted_by_user_id'
            ))
  UNION ALL
  SELECT 'RLS enabled on field_updates',
         (SELECT c.relrowsecurity FROM pg_class c
          WHERE c.oid = to_regclass('public.field_updates'))
  UNION ALL
  SELECT 'Existing import protection trigger present',
         EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE t.tgrelid = to_regclass('public.field_updates')
                   AND t.tgname = 'trg_protect_spreadsheet_field_update'
                   AND NOT t.tgisinternal)
  UNION ALL
  SELECT 'Existing original-submission guard present',
         EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE t.tgrelid = to_regclass('public.field_updates')
                   AND t.tgname = 'trg_protect_field_update_submission'
                   AND NOT t.tgisinternal)
  UNION ALL
  SELECT 'Existing discipline guard present',
         EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE t.tgrelid = to_regclass('public.field_updates')
                   AND t.tgname = 'trg_protect_field_update_discipline'
                   AND NOT t.tgisinternal)
  UNION ALL
  SELECT 'Authenticated browser INSERT currently granted (will be revoked)',
         has_table_privilege('authenticated','public.field_updates','INSERT')
  UNION ALL
  SELECT 'Existing planner report SELECT policy present',
         EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname='public' AND tablename='field_updates'
                   AND policyname='field_planner_admin_select_all'
                   AND cmd='SELECT')
)
SELECT check_name, COALESCE(passed,false) AS passed
FROM checks
ORDER BY check_name;
