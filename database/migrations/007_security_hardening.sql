-- SETU Phase 0.8 - Supabase security hardening
-- Additive migration after 006_transactional_planner_governance.sql.

-- Trigger helpers are invoked by PostgreSQL triggers, not by browser/API
-- callers. Revoke their default direct EXECUTE exposure.
revoke execute on function public.prevent_audit_log_modification()
    from public, anon, authenticated;
revoke execute on function public.protect_field_update_original_submission()
    from public, anon, authenticated;

-- Some Supabase projects provide this event-trigger helper; keep migration
-- portable when it is absent from a local or older project.
do $$
begin
    if to_regprocedure('public.rls_auto_enable()') is not null then
        execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
    end if;
end;
$$;

-- RLS policies call this helper. Keep authenticated EXECUTE; close anon only.
revoke execute on function public.current_user_role() from anon;

-- Preserve match_schedule_activities behavior and existing grants. Only set a
-- trusted resolution path for its public table and vector extension objects.
alter function public.match_schedule_activities(vector, double precision, integer)
    set search_path = public, extensions;

