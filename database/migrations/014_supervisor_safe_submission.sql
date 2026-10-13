-- Phase 4: Supervisor Safe Submission Boundary
-- Apply this migration in a separately authorized deployment.
-- Live Supabase is untouched; browser submission gate remains locked until verified.
begin;

-- 1. Authoritative Server Validation RPC for Supervisor Field Updates
create or replace function public.submit_supervisor_field_update(
    p_field_text text,
    p_site_location text,
    p_reported_date date,
    p_reported_by text,
    p_discipline text default null,
    p_source_type text default 'manual_text',
    p_client_update_id text default null,
    p_interpretation jsonb default null,
    p_clarification jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := auth.uid();
    v_role text;
    v_field_text text;
    v_site_location text;
    v_reported_by text;
    v_id uuid;
    v_update_id text;
    v_today_ist date;
begin
    -- A. Authentication & Role Authorization
    if v_actor is null or auth.role() is distinct from 'authenticated' then
        raise exception 'Authentication required' using errcode = '42501';
    end if;

    v_role := coalesce(public.current_user_role(), '');
    if v_role not in ('site', 'engineer') then
        raise exception 'Only authenticated site or engineer users may submit supervisor updates' using errcode = '42501';
    end if;

    -- B. Authoritative Field Validation
    v_field_text := pg_catalog.btrim(p_field_text);
    if v_field_text is null or pg_catalog.length(v_field_text) < 3 then
        raise exception 'Narrative text must be at least 3 characters' using errcode = '22023';
    end if;
    if pg_catalog.length(v_field_text) > 4000 then
        raise exception 'Narrative text cannot exceed 4000 characters' using errcode = '22023';
    end if;

    v_site_location := pg_catalog.btrim(p_site_location);
    if v_site_location is null or pg_catalog.length(v_site_location) < 2 then
        raise exception 'Site location must be at least 2 characters' using errcode = '22023';
    end if;
    if pg_catalog.length(v_site_location) > 200 then
        raise exception 'Site location cannot exceed 200 characters' using errcode = '22023';
    end if;

    v_reported_by := pg_catalog.btrim(p_reported_by);
    if v_reported_by is null or pg_catalog.length(v_reported_by) < 2 then
        raise exception 'Reporter name must be at least 2 characters' using errcode = '22023';
    end if;
    if pg_catalog.length(v_reported_by) > 100 then
        raise exception 'Reporter name cannot exceed 100 characters' using errcode = '22023';
    end if;

    if p_reported_date is null then
        raise exception 'Reported date is required' using errcode = '22023';
    end if;

    -- Observation date cannot be in the future (allowing max 1 day buffer for timezone differences)
    v_today_ist := (pg_catalog.timezone('Asia/Kolkata', pg_catalog.now()))::date;
    if p_reported_date > (v_today_ist + 1) then
        raise exception 'Reported observation date cannot be in the future' using errcode = '22023';
    end if;
    if p_reported_date < '2020-01-01'::date then
        raise exception 'Reported date is outside project timeline' using errcode = '22023';
    end if;

    if p_discipline is not null and p_discipline not in (
        'Piping', 'Pipeline', 'Civil', 'Electrical', 'Mechanical', 'Instrumentation'
    ) then
        raise exception 'Invalid discipline: must be Piping, Pipeline, Civil, Electrical, Mechanical, or Instrumentation' using errcode = '22023';
    end if;

    if p_source_type not in ('manual_text', 'voice') then
        raise exception 'Invalid source_type: must be manual_text or voice' using errcode = '22023';
    end if;

    -- C. Identity Generation
    v_id := pg_catalog.gen_random_uuid();
    if p_client_update_id is not null and p_client_update_id ~ '^UPD-[A-Za-z0-9-]+$' then
        if not exists (select 1 from public.field_updates where update_id = p_client_update_id) then
            v_update_id := p_client_update_id;
        else
            v_update_id := 'UPD-' || pg_catalog.to_char(v_today_ist, 'YYYYMMDD') || '-' || pg_catalog.substr(v_id::text, 1, 8);
        end if;
    else
        v_update_id := 'UPD-' || pg_catalog.to_char(v_today_ist, 'YYYYMMDD') || '-' || pg_catalog.substr(v_id::text, 1, 8);
    end if;

    -- D. Authorization Flag for Insert Trigger
    perform pg_catalog.set_config('setu.authorized_submission', 'on', true);

    -- E. Insertion into public.field_updates with Enforced Baseline Safety Defaults
    insert into public.field_updates (
        id,
        update_id,
        source_type,
        field_text,
        site_location,
        reported_by,
        discipline,
        reported_date,
        status,
        confidence_level,
        confidence_score,
        matched_activity_id,
        expanded_text,
        matched_layer,
        candidate_matches,
        validation_results,
        submitted_by_user_id
    ) values (
        v_id,
        v_update_id,
        p_source_type,
        v_field_text,
        v_site_location,
        v_reported_by,
        p_discipline,
        p_reported_date,
        'pending',
        'Pending',
        0,
        null,
        null,
        null,
        case when p_interpretation is not null then pg_catalog.jsonb_build_array(p_interpretation) else '[]'::jsonb end,
        case when p_clarification is not null then pg_catalog.jsonb_build_array(p_clarification) else '[]'::jsonb end,
        v_actor
    );

    -- F. Return Confirmation Receipt
    return pg_catalog.jsonb_build_object(
        'success', true,
        'id', v_id,
        'update_id', v_update_id,
        'status', 'pending'
    );
end;
$$;

-- Revoke all public execution rights and grant only to authenticated users
revoke execute on function public.submit_supervisor_field_update(text, text, date, text, text, text, text, jsonb, jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.submit_supervisor_field_update(text, text, date, text, text, text, text, jsonb, jsonb)
    to authenticated;

-- 2. Trigger to Prevent Direct Client-Side Bypass
create or replace function public.protect_manual_field_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.role() = 'service_role' then
        return new;
    end if;

    if tg_op = 'INSERT' and new.source_type in ('manual_text', 'voice') then
        if pg_catalog.current_setting('setu.authorized_submission', true) is distinct from 'on' then
            raise exception 'Manual and voice field updates must use the secure submit_supervisor_field_update RPC' using errcode = '42501';
        end if;
    end if;

    return new;
end;
$$;

revoke execute on function public.protect_manual_field_update()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_protect_manual_field_update on public.field_updates;
create trigger trg_protect_manual_field_update
before insert on public.field_updates
for each row execute function public.protect_manual_field_update();

commit;
