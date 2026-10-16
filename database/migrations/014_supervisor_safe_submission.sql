-- Phase 4: Supervisor Safe Submission Boundary
-- Authoritative server validation, duplicate prevention, and direct-insert boundary.
-- Staged deployment: RPC and receipt table deployed first; direct-insert restriction
-- activated following verified frontend rollout to prevent downtime.
begin;

-- 1. Supervisor Submission Receipts Table (Idempotency and Audit)
create table if not exists public.supervisor_submission_receipts (
    actor_user_id uuid not null,
    idempotency_key text not null,
    field_update_id uuid not null,
    update_id text not null,
    payload_hash bytea not null,
    unverified_interpretation jsonb default null,
    unverified_clarification jsonb default null,
    created_at timestamptz not null default pg_catalog.clock_timestamp(),
    primary key (actor_user_id, idempotency_key)
);

alter table public.supervisor_submission_receipts enable row level security;
revoke all on public.supervisor_submission_receipts from public, anon, authenticated, service_role;

-- 2. Authoritative Server Validation RPC for Supervisor Field Updates
create or replace function public.submit_supervisor_field_update(
    p_field_text text,
    p_site_location text,
    p_reported_date date,
    p_reported_by text,
    p_discipline text default null,
    p_source_type text default 'manual_text',
    p_client_update_id text default null,
    p_idempotency_key text default null,
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
    v_idempotency_key text;
    v_payload_hash bytea;
    v_existing_receipt record;
begin
    -- A. Authentication & Authoritative Role Authorization
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

    -- Strict Asia/Kolkata date guard: observation date cannot be in the future
    v_today_ist := (pg_catalog.timezone('Asia/Kolkata', pg_catalog.now()))::date;
    if p_reported_date > v_today_ist then
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

    if p_source_type not in ('manual_text', 'voice_transcript') then
        raise exception 'Invalid source_type: must be manual_text or voice_transcript' using errcode = '22023';
    end if;

    -- C. Idempotency Key & Transactional Duplicate Prevention
    v_idempotency_key := coalesce(nullif(pg_catalog.btrim(p_idempotency_key), ''), p_client_update_id, pg_catalog.gen_random_uuid()::text);
    v_payload_hash := pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
            v_field_text,
            v_site_location,
            p_reported_date::text,
            v_reported_by,
            p_discipline,
            p_source_type
        )::text,
        'UTF8'
    ));

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

    -- Store receipt with unverified client metadata kept isolated from authoritative fields
    insert into public.supervisor_submission_receipts (
        actor_user_id,
        idempotency_key,
        field_update_id,
        update_id,
        payload_hash,
        unverified_interpretation,
        unverified_clarification
    ) values (
        v_actor,
        v_idempotency_key,
        v_id,
        v_update_id,
        v_payload_hash,
        p_interpretation,
        p_clarification
    )
    on conflict (actor_user_id, idempotency_key) do nothing;

    if not found then
        -- Conflict: check if identical payload replay or key reuse with different content
        select * into v_existing_receipt
        from public.supervisor_submission_receipts
        where actor_user_id = v_actor and idempotency_key = v_idempotency_key;

        if v_existing_receipt.payload_hash is distinct from v_payload_hash then
            raise exception 'Idempotency key already used for different report payload' using errcode = '23505';
        end if;

        return pg_catalog.jsonb_build_object(
            'success', true,
            'id', v_existing_receipt.field_update_id,
            'update_id', v_existing_receipt.update_id,
            'status', 'pending',
            'replayed', true
        );
    end if;

    -- D. Insertion into public.field_updates with Enforced Baseline Safety Defaults
    -- Fix 4: p_interpretation and p_clarification are untrusted client metadata
    -- and MUST NOT be stored in candidate_matches or validation_results.
    -- candidate_matches and validation_results remain canonical empty arrays.
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
        validation_status,
        validation_results,
        validation_overridden,
        evidence_revision,
        workflow_revision,
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
        '[]'::jsonb,
        null,
        '[]'::jsonb,
        false,
        0,
        0,
        v_actor
    );

    -- E. Return Confirmation Receipt
    return pg_catalog.jsonb_build_object(
        'success', true,
        'id', v_id,
        'update_id', v_update_id,
        'status', 'pending',
        'replayed', false
    );
end;
$$;

-- Revoke all public execution rights and grant only to authenticated users
revoke execute on function public.submit_supervisor_field_update(text, text, date, text, text, text, text, text, jsonb, jsonb)
    from public, anon, authenticated, service_role;
grant execute on function public.submit_supervisor_field_update(text, text, date, text, text, text, text, text, jsonb, jsonb)
    to authenticated;

-- 3. Authoritative Database Protection Trigger
-- Fix 2: Blocks ANY direct client insert from authenticated/anon roles regardless of source_type.
-- Does not trust client-controlled source types (like 'text' or 'custom') or custom session flags.
-- Only security definer RPCs (running under definer role) or service_role can write to field_updates.
create or replace function public.protect_field_update_insert_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Service role is always permitted (background workers, migrations, system tasks)
    if auth.role() = 'service_role' then
        return new;
    end if;

    -- Direct client insert from authenticated or anon is forbidden regardless of source_type.
    -- In a direct client call, pg_catalog.current_user is 'authenticated' or 'anon'.
    -- In a security definer RPC (submit_supervisor_field_update, import_field_reports),
    -- pg_catalog.current_user is the database owner (definer).
    if pg_catalog.current_user in ('authenticated', 'anon', 'public') then
        raise exception 'Direct client insert on field_updates is forbidden. Submissions must use the authoritative RPC submit_supervisor_field_update or import_field_reports.' using errcode = '42501';
    end if;

    -- Whitelist source_type validation across all valid server writers
    if new.source_type not in (
        'manual_text', 'voice_transcript', 'spreadsheet_xlsx', 'spreadsheet_csv', 'whatsapp_log', 'text'
    ) then
        raise exception 'Invalid source_type: %', new.source_type using errcode = '22023';
    end if;

    return new;
end;
$$;

revoke execute on function public.protect_field_update_insert_boundary()
    from public, anon, authenticated, service_role;

drop trigger if exists trg_protect_manual_field_update on public.field_updates;
drop trigger if exists trg_protect_field_update_insert_boundary on public.field_updates;
create trigger trg_protect_field_update_insert_boundary
before insert on public.field_updates
for each row execute function public.protect_field_update_insert_boundary();

commit;
