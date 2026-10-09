-- Phase 1 only. Local review artifact; apply separately after 009.
-- Machine extraction does not approve a mapping or modify the schedule baseline.
begin;

alter table public.field_updates
    add column progress_extraction_revision bigint
        check (progress_extraction_revision >= 0 and progress_extraction_revision <= evidence_revision),
    add column progress_extraction_retry_revision bigint
        check (progress_extraction_retry_revision >= 0 and progress_extraction_retry_revision <= evidence_revision),
    add column progress_extraction_attempts integer not null default 0 check (progress_extraction_attempts >= 0),
    add column progress_extraction_last_error text,
    add column progress_extraction_next_attempt_at timestamptz;

create index field_progress_extraction_pending on public.field_updates (created_at, id)
    where progress_extraction_revision is distinct from evidence_revision;

create table public.progress_events (
    id uuid primary key default gen_random_uuid(),
    field_update_id uuid not null references public.field_updates(id) on delete restrict,
    evidence_revision bigint not null check (evidence_revision >= 0),
    event_index integer not null check (event_index >= 0),
    event_type text not null check (event_type in ('START', 'FINISH', 'PROGRESS', 'UNKNOWN')),
    event_date date,
    progress_percent numeric check (progress_percent >= 0 and progress_percent <= 100),
    evidence_text text not null check (nullif(btrim(evidence_text), '') is not null),
    extraction_reason text not null check (nullif(btrim(extraction_reason), '') is not null),
    extraction_version text not null default 'phase1_rules_v1',
    created_at timestamptz not null default now(),
    constraint progress_event_percentage_shape check (
        (event_type = 'PROGRESS' and progress_percent is not null)
        or (event_type <> 'PROGRESS' and progress_percent is null)),
    constraint progress_unknown_date check (event_type <> 'UNKNOWN' or event_date is null),
    unique (field_update_id, evidence_revision, event_index)
);
-- The unique index already supports report/revision reads and the foreign key.

alter table public.progress_events enable row level security;
revoke all on table public.progress_events from public, anon, authenticated, service_role;
grant select on table public.progress_events to authenticated;
grant select, insert on table public.progress_events to service_role;
create policy progress_events_parent_read on public.progress_events
    for select to authenticated using (exists (
        select 1 from public.field_updates fu where fu.id = progress_events.field_update_id));

-- Existing INSERT policies remain intact. Their permissive rules do not know
-- this new worker-owned column, so an additive restrictive policy prevents a
-- client from marking arbitrary input as already extracted.
create policy field_progress_marker_insert_guard on public.field_updates as restrictive
    for insert to authenticated with check (progress_extraction_revision is null
        and progress_extraction_retry_revision is null and progress_extraction_attempts = 0
        and progress_extraction_last_error is null and progress_extraction_next_attempt_at is null);
-- 006 already revokes authenticated UPDATE on field_updates. No new grant.

create function public.protect_progress_event_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
    raise exception 'Progress event history is append-only';
end;
$$;
create trigger trg_protect_progress_event_history before update or delete
    on public.progress_events for each row execute function public.protect_progress_event_history();
revoke all on function public.protect_progress_event_history() from public, anon, authenticated, service_role;

-- EXECUTE is granted only to service_role, like the 009 worker RPCs. Parent
-- lock serializes extraction against clarification and other report changes.
create function public.complete_field_update_progress_extraction(
    p_field_update_id uuid, p_evidence_revision bigint, p_events jsonb
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
    u public.field_updates%rowtype;
    e jsonb;
    ordinal bigint;
begin
    select * into u from public.field_updates where id = p_field_update_id for update;
    if not found or u.evidence_revision is distinct from p_evidence_revision then return false; end if;
    -- Successful retry never overwrites the first extraction of this revision.
    if u.progress_extraction_revision = p_evidence_revision then return true; end if;
    if jsonb_typeof(p_events) is distinct from 'array' then
        raise exception 'A non-empty ordered progress event array is required';
    end if;
    if jsonb_array_length(p_events) = 0 then
        raise exception 'A non-empty ordered progress event array is required';
    end if;
    if jsonb_array_length(p_events) > 1 and exists (
        select 1 from jsonb_array_elements(p_events) item where item->>'event_type' = 'UNKNOWN') then
        raise exception 'UNKNOWN must be the sole event when no supported actual event exists';
    end if;
    for e, ordinal in select value, ordinality from jsonb_array_elements(p_events) with ordinality loop
        if jsonb_typeof(e) is distinct from 'object'
           or jsonb_typeof(e->'event_index') is distinct from 'number'
           or (e->>'event_index')::numeric is distinct from ordinal - 1
           or jsonb_typeof(e->'event_type') is distinct from 'string'
           or jsonb_typeof(e->'evidence_text') is distinct from 'string'
           or jsonb_typeof(e->'extraction_reason') is distinct from 'string'
           or coalesce(e->>'extraction_version', '') <> 'phase1_rules_v1'
           or (e->'event_date' is not null and jsonb_typeof(e->'event_date') not in ('null', 'string'))
           or (e->>'event_date' is not null and e->>'event_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
           or (e->'progress_percent' is not null and jsonb_typeof(e->'progress_percent') not in ('null', 'number')) then
            raise exception 'Invalid progress event shape or ordering';
        end if;
        insert into public.progress_events (field_update_id, evidence_revision, event_index,
            event_type, event_date, progress_percent, evidence_text, extraction_reason, extraction_version)
        values (u.id, p_evidence_revision, (ordinal - 1)::integer,
            e->>'event_type', (e->>'event_date')::date, (e->>'progress_percent')::numeric,
            e->>'evidence_text', e->>'extraction_reason', 'phase1_rules_v1');
    end loop;
    -- This marker is not a planner workflow change. Do not bump workflow_revision
    -- or replace matching, validation, override or approval state.
    update public.field_updates set progress_extraction_revision = p_evidence_revision,
        progress_extraction_retry_revision = null, progress_extraction_attempts = 0,
        progress_extraction_last_error = null, progress_extraction_next_attempt_at = null where id = u.id;
    return true;
end;
$$;
revoke all on function public.complete_field_update_progress_extraction(uuid, bigint, jsonb)
    from public, anon, authenticated;
grant execute on function public.complete_field_update_progress_extraction(uuid, bigint, jsonb) to service_role;

-- Durable retries belong to one evidence revision. New evidence ignores an old
-- deadline; successful completion clears failure state under the same parent lock.
create function public.fail_field_update_progress_extraction(
    p_field_update_id uuid, p_evidence_revision bigint, p_error text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
    u public.field_updates%rowtype;
    attempts integer;
begin
    select * into u from public.field_updates where id = p_field_update_id for update;
    if not found or u.evidence_revision is distinct from p_evidence_revision
        or u.progress_extraction_revision = p_evidence_revision then return false; end if;
    attempts := case when u.progress_extraction_retry_revision = p_evidence_revision
        then least(u.progress_extraction_attempts, 2147483646) + 1 else 1 end;
    update public.field_updates set progress_extraction_retry_revision = p_evidence_revision,
        progress_extraction_attempts = attempts,
        progress_extraction_last_error = left(coalesce(nullif(btrim(p_error), ''), 'Extraction failed'), 500),
        progress_extraction_next_attempt_at = now() + make_interval(secs =>
            least(1800, 30 * power(2, least(attempts - 1, 6)))::double precision)
        where id = u.id;
    return true;
end;
$$;
revoke all on function public.fail_field_update_progress_extraction(uuid, bigint, text)
    from public, anon, authenticated;
grant execute on function public.fail_field_update_progress_extraction(uuid, bigint, text) to service_role;

-- Fetch only a bounded eligible batch, rather than scanning all reports in Python.
create function public.list_field_updates_for_progress_extraction(p_limit integer default 25)
returns setof public.field_updates language sql stable security definer set search_path = '' as $$
    select u.* from public.field_updates u
    where u.progress_extraction_revision is distinct from u.evidence_revision
        and (u.progress_extraction_retry_revision is distinct from u.evidence_revision
            or u.progress_extraction_next_attempt_at is null or u.progress_extraction_next_attempt_at <= now())
    order by u.created_at, u.id
    limit greatest(0, least(coalesce(p_limit, 25), 25));
$$;
revoke all on function public.list_field_updates_for_progress_extraction(integer) from public, anon, authenticated;
grant execute on function public.list_field_updates_for_progress_extraction(integer) to service_role;

create function public.progress_extraction_ready()
returns boolean language sql stable security invoker set search_path = '' as $$
    select pg_catalog.to_regclass('public.progress_events') is not null
        and pg_catalog.to_regprocedure('public.complete_field_update_progress_extraction(uuid,bigint,jsonb)') is not null
        and pg_catalog.to_regprocedure('public.fail_field_update_progress_extraction(uuid,bigint,text)') is not null
        and pg_catalog.to_regprocedure('public.list_field_updates_for_progress_extraction(integer)') is not null;
$$;
revoke all on function public.progress_extraction_ready() from public, anon, authenticated;
grant execute on function public.progress_extraction_ready() to service_role;

comment on table public.progress_events is
    'Append-only machine extraction by evidence revision; not planner approval or schedule actuals/writeback.';
comment on column public.field_updates.progress_extraction_revision is
    'NULL until extracted; older marker means current evidence awaits extraction. Existing rows support worker backfill.';
commit;
