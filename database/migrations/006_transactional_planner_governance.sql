-- SETU Phase 0.75 - Transactional planner governance and audit hardening
-- Apply after 005_auth_rls.sql. This migration does not mutate schedule data.

-- Browser sessions may read the baseline, but only service-role processes may
-- ingest or maintain it. Remove the obsolete planner/admin write policy too.
revoke insert, update, delete on table public.schedule_activities from authenticated;
drop policy if exists "schedule_planner_admin_write" on public.schedule_activities;
grant all on table public.schedule_activities to service_role;

-- Planner decisions and audit inserts must pass through the transactional RPCs
-- below. Browser sessions retain SELECT access and site/engineer INSERT access.
revoke update on table public.field_updates from authenticated;
drop policy if exists "field_planner_admin_update_review" on public.field_updates;
grant all on table public.field_updates to service_role;

revoke insert on table public.planner_audit_logs from authenticated;
drop policy if exists "audit_authenticated_insert" on public.planner_audit_logs;
grant all on table public.planner_audit_logs to service_role;

-- planner_name and override_by remain display-only compatibility fields.
-- actor_user_id is the authoritative authenticated identity for audit records.
comment on column public.planner_audit_logs.planner_name is
    'Non-authoritative display label. actor_user_id is the authoritative authenticated actor.';
comment on column public.field_updates.override_by is
    'Non-authoritative display label. The corresponding override audit actor_user_id is authoritative.';

create or replace function public.review_field_update(
    p_field_update_id uuid,
    p_action text,
    p_target_activity_id text default null,
    p_remarks text default null
)
returns public.field_updates
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_user_id uuid := auth.uid();
    v_actor_role text;
    v_actor_label text;
    v_action text := lower(btrim(coalesce(p_action, '')));
    v_target_activity_id text := nullif(btrim(coalesce(p_target_activity_id, '')), '');
    v_previous_activity_id text;
    v_new_activity_id text;
    v_update public.field_updates%rowtype;
begin
    if v_actor_user_id is null then
        raise exception using
            errcode = '42501',
            message = 'Authentication is required for planner decisions';
    end if;

    select ur.role
      into v_actor_role
      from public.user_roles as ur
     where ur.user_id = v_actor_user_id;

    if v_actor_role is null or v_actor_role not in ('planner', 'admin') then
        raise exception using
            errcode = '42501',
            message = 'Planner or administrator role is required';
    end if;

    if v_action not in ('accept', 'reject', 'remap') then
        raise exception 'Unsupported planner decision';
    end if;

    select fu.*
      into v_update
      from public.field_updates as fu
     where fu.id = p_field_update_id
     for update;

    if not found then
        raise exception 'Field update is unavailable for review';
    end if;

    if v_update.status is distinct from 'pending' then
        raise exception 'Field update is already finalized';
    end if;

    v_previous_activity_id := v_update.matched_activity_id;

    if v_action = 'accept' then
        if v_update.matched_activity_id is null then
            raise exception 'Approval requires a linked schedule activity';
        end if;

        if not exists (
            select 1
              from public.schedule_activities as sa
             where sa.activity_id = v_update.matched_activity_id
        ) then
            raise exception 'Linked schedule activity does not exist';
        end if;

        if v_update.validation_status = 'block'
           and v_update.validation_overridden is not true then
            raise exception 'Blocked validation requires an override before approval';
        end if;

        v_new_activity_id := v_update.matched_activity_id;

        update public.field_updates
           set status = 'approved',
               planner_remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
               updated_at = now()
         where id = p_field_update_id
         returning * into v_update;

    elsif v_action = 'reject' then
        -- Rejection preserves any machine-suggested link but creates no new link.
        v_new_activity_id := null;

        update public.field_updates
           set status = 'rejected',
               planner_remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
               updated_at = now()
         where id = p_field_update_id
         returning * into v_update;

    else
        if v_target_activity_id is null then
            raise exception 'Remap requires a target schedule activity';
        end if;

        if not exists (
            select 1
              from public.schedule_activities as sa
             where sa.activity_id = v_target_activity_id
        ) then
            raise exception 'Target schedule activity does not exist';
        end if;

        if v_update.validation_status = 'block'
           and v_update.validation_overridden is not true then
            raise exception 'Blocked validation requires an override before remap';
        end if;

        v_new_activity_id := v_target_activity_id;

        update public.field_updates
           set status = 'remapped',
               matched_activity_id = v_target_activity_id,
               planner_remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
               updated_at = now()
         where id = p_field_update_id
         returning * into v_update;
    end if;

    v_actor_label := case v_actor_role
        when 'admin' then 'Authenticated Administrator'
        else 'Authenticated Planner'
    end;

    insert into public.planner_audit_logs (
        field_update_id,
        action,
        previous_activity_id,
        new_activity_id,
        planner_name,
        remarks,
        actor_user_id
    ) values (
        p_field_update_id,
        v_action,
        v_previous_activity_id,
        v_new_activity_id,
        v_actor_label,
        nullif(btrim(coalesce(p_remarks, '')), ''),
        v_actor_user_id
    );

    return v_update;
end;
$$;

create or replace function public.override_field_update_validation(
    p_field_update_id uuid,
    p_reason text
)
returns public.field_updates
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_user_id uuid := auth.uid();
    v_actor_role text;
    v_actor_label text;
    v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
    v_update public.field_updates%rowtype;
begin
    if v_actor_user_id is null then
        raise exception using
            errcode = '42501',
            message = 'Authentication is required for validation override';
    end if;

    select ur.role
      into v_actor_role
      from public.user_roles as ur
     where ur.user_id = v_actor_user_id;

    if v_actor_role is null or v_actor_role not in ('planner', 'admin') then
        raise exception using
            errcode = '42501',
            message = 'Planner or administrator role is required';
    end if;

    if v_reason is null then
        raise exception 'A non-empty override reason is required';
    end if;

    select fu.*
      into v_update
      from public.field_updates as fu
     where fu.id = p_field_update_id
     for update;

    if not found then
        raise exception 'Field update is unavailable for override';
    end if;

    if v_update.status is distinct from 'pending' then
        raise exception 'Finalized field updates cannot be overridden';
    end if;

    if v_update.validation_status is distinct from 'block' then
        raise exception 'Only blocked validation may be overridden';
    end if;

    if v_update.validation_overridden is true then
        raise exception 'Validation block is already overridden';
    end if;

    v_actor_label := case v_actor_role
        when 'admin' then 'Authenticated Administrator'
        else 'Authenticated Planner'
    end;

    update public.field_updates
       set validation_overridden = true,
           override_reason = v_reason,
           override_by = v_actor_label,
           override_at = now(),
           updated_at = now()
     where id = p_field_update_id
     returning * into v_update;

    insert into public.planner_audit_logs (
        field_update_id,
        action,
        previous_activity_id,
        new_activity_id,
        planner_name,
        remarks,
        actor_user_id
    ) values (
        p_field_update_id,
        'override',
        v_update.matched_activity_id,
        v_update.matched_activity_id,
        v_actor_label,
        'Validation Override: ' || v_reason,
        v_actor_user_id
    );

    return v_update;
end;
$$;

-- Preserve existing requeue behavior without reopening direct table or audit
-- mutation. This RPC does not finalize the report or alter its schedule link.
create or replace function public.requeue_field_update(
    p_field_update_id uuid,
    p_remarks text default null
)
returns public.field_updates
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor_user_id uuid := auth.uid();
    v_actor_role text;
    v_actor_label text;
    v_previous_activity_id text;
    v_update public.field_updates%rowtype;
begin
    if v_actor_user_id is null then
        raise exception using
            errcode = '42501',
            message = 'Authentication is required for requeue';
    end if;

    select ur.role
      into v_actor_role
      from public.user_roles as ur
     where ur.user_id = v_actor_user_id;

    if v_actor_role is null or v_actor_role not in ('planner', 'admin') then
        raise exception using
            errcode = '42501',
            message = 'Planner or administrator role is required';
    end if;

    select fu.*
      into v_update
      from public.field_updates as fu
     where fu.id = p_field_update_id
     for update;

    if not found then
        raise exception 'Field update is unavailable for requeue';
    end if;

    if v_update.status is distinct from 'pending' then
        raise exception 'Finalized field updates cannot be requeued';
    end if;

    v_previous_activity_id := v_update.matched_activity_id;

    v_actor_label := case v_actor_role
        when 'admin' then 'Authenticated Administrator'
        else 'Authenticated Planner'
    end;

    update public.field_updates
       set confidence_level = 'Pending',
           confidence_score = 0,
           matched_activity_id = null,
           matched_layer = null,
           candidate_matches = '[]'::jsonb,
           expanded_text = null,
           validation_status = null,
           validation_results = '[]'::jsonb,
           validation_overridden = false,
           override_reason = null,
           override_by = null,
           override_at = null,
           updated_at = now()
     where id = p_field_update_id
     returning * into v_update;

    insert into public.planner_audit_logs (
        field_update_id,
        action,
        previous_activity_id,
        new_activity_id,
        planner_name,
        remarks,
        actor_user_id
    ) values (
        p_field_update_id,
        'requeue',
        v_previous_activity_id,
        null,
        v_actor_label,
        coalesce(nullif(btrim(coalesce(p_remarks, '')), ''),
                 'Re-queued for re-matching with updated domain dictionary.'),
        v_actor_user_id
    );

    return v_update;
end;
$$;

-- Functions receive EXECUTE by default through PUBLIC on many Supabase
-- projects. Opt in only authenticated sessions. Each function then enforces
-- planner/admin role and binds actor identity to auth.uid().
revoke all on function public.review_field_update(uuid, text, text, text)
    from public, anon, authenticated;
revoke all on function public.override_field_update_validation(uuid, text)
    from public, anon, authenticated;
revoke all on function public.requeue_field_update(uuid, text)
    from public, anon, authenticated;

grant execute on function public.review_field_update(uuid, text, text, text)
    to authenticated;
grant execute on function public.override_field_update_validation(uuid, text)
    to authenticated;
grant execute on function public.requeue_field_update(uuid, text)
    to authenticated;
