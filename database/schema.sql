-- ==========================================================
-- SETU - Database Schema (PostgreSQL + pgvector for Supabase)
-- Smart India Hackathon 2026 - SIH26122 (Oil India Limited)
-- ==========================================================

-- Enable the pgvector extension for semantic similarity search
create extension if not exists vector;

-- 1. Schedule Activities Table (Primavera P6 L5/L6 activities)
create table if not exists schedule_activities (
    id uuid primary key default gen_random_uuid(),
    activity_id text unique not null,               -- e.g. 'OIL-PIP-401'
    activity_name text not null,                     -- e.g. 'Fabrication & Erection of 12" Trunkline Spools'
    wbs_code text not null,                          -- e.g. '1.2.4.1'
    wbs_name text,                                   -- e.g. 'Pipeline Execution Section A'
    discipline text not null,                        -- e.g. 'Piping', 'Civil', 'Electrical', 'Instrumentation'
    planned_start_date date,
    planned_finish_date date,
    planned_progress_pct numeric default 0.0,
    unit_of_measure text default 'MTR',              -- e.g. 'MTR', 'NOS', 'CUM', 'MT'
    planned_qty numeric default 0.0,
    embedding vector(384),                           -- 384-dimensional vector for all-MiniLM-L6-v2
    created_at timestamptz default now()
);

-- Cosine index on vector embeddings for sub-millisecond retrieval
create index if not exists idx_schedule_activities_embedding 
on schedule_activities using ivfflat (embedding vector_cosine_ops)
with (lists = 10);

-- Index on discipline and WBS code for filtered matching
create index if not exists idx_schedule_activities_discipline 
on schedule_activities (discipline);

create index if not exists idx_schedule_activities_wbs 
on schedule_activities (wbs_code);


-- 2. Domain Alias Dictionary Table
create table if not exists domain_aliases (
    id serial primary key,
    field_term text unique not null,                 -- e.g. 'spool', 'stringing', 'hydrotest'
    standard_term text not null,                     -- e.g. 'prefabricated piping spool / line erection'
    discipline text,                                 -- e.g. 'Piping', 'Pipeline', 'Civil'
    status text default 'verified',                  -- 'verified', 'proposed', 'rejected'
    origin text default 'seed',                      -- 'seed', 'planner_correction'
    source_update_id text,                           -- Originating field report identifier
    proposed_by text,                                -- Proposing planner name
    reviewed_by text,                                -- Approving planner name
    created_at timestamptz default now(),
    reviewed_at timestamptz
);

create index if not exists idx_domain_aliases_term 
on domain_aliases (field_term);

create index if not exists idx_domain_aliases_status 
on domain_aliases (status);

-- Idempotent column migrations for existing instances
alter table domain_aliases add column if not exists status text default 'verified';
alter table domain_aliases add column if not exists origin text default 'seed';
alter table domain_aliases add column if not exists source_update_id text;
alter table domain_aliases add column if not exists proposed_by text;
alter table domain_aliases add column if not exists reviewed_by text;
alter table domain_aliases add column if not exists created_at timestamptz default now();
alter table domain_aliases add column if not exists reviewed_at timestamptz;

-- Ensure seed aliases default to verified and seed origin
update domain_aliases set status = 'verified' where status is null;
update domain_aliases set origin = 'seed' where origin is null;


-- 3. Field Updates Table (Ingested site logs & matching results)
create table if not exists field_updates (
    id uuid primary key default gen_random_uuid(),
    update_id text unique,                           -- Stable identifier e.g. 'UPD-2026-001'
    source_type text default 'text',                 -- 'text', 'excel', or 'whatsapp_log'
    field_text text not null,                        -- Raw text from the field
    site_location text,                              -- Physical location e.g. 'Duliajan Manifold Area A'
    reported_by text,                                -- Foreman / Engineer e.g. 'Ramesh Borah'
    expanded_text text,                              -- Text after domain alias normalization
    matched_activity_id text references schedule_activities(activity_id) on delete set null,
    confidence_score numeric(4,3),                   -- Weighted confidence score (0.000 to 1.000)
    confidence_level text default 'Pending',         -- 'High', 'Medium', 'Low', 'Pending'
    matched_layer text,                              -- 'hybrid', 'semantic', 'fuzzy', 'exact_alias'
    candidate_matches jsonb default '[]'::jsonb,     -- Top 3 candidate activities with scores and rationale
    status text default 'pending',                   -- 'pending', 'approved', 'rejected', 'remapped'
    planner_remarks text,                            -- Notes entered by Planner during review
    reported_date date default current_date,
    validation_status text,                          -- 'pass', 'warn', 'block', or NULL (not yet run)
    validation_results jsonb default '[]'::jsonb,    -- Array of check outcomes, messages, and evidence
    validation_overridden boolean default false,     -- True if planner explicitly overrides a block
    override_reason text,                            -- Mandatory justification for planner override
    override_by text,                                -- Planner name who authorized override
    override_at timestamptz,                         -- Timestamp when override was authorized
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_field_updates_status 
on field_updates (status);

create index if not exists idx_field_updates_confidence 
on field_updates (confidence_level);

create index if not exists idx_field_updates_validation_status 
on field_updates (validation_status);

-- Idempotent column migrations for field_updates
alter table field_updates add column if not exists validation_status text;
alter table field_updates add column if not exists validation_results jsonb default '[]'::jsonb;
alter table field_updates add column if not exists validation_overridden boolean default false;
alter table field_updates add column if not exists override_reason text;
alter table field_updates add column if not exists override_by text;
alter table field_updates add column if not exists override_at timestamptz;


-- 4. Planner Audit Logs Table (Full decision trail for compliance)
create table if not exists planner_audit_logs (
    id uuid primary key default gen_random_uuid(),
    field_update_id uuid references field_updates(id) on delete cascade,
    action text not null,                            -- 'auto_link', 'accept', 'reject', 'remap', 'requeue', 'override'
    previous_activity_id text,
    new_activity_id text,
    planner_name text default 'Lead Project Planner',
    remarks text,
    created_at timestamptz default now()
);

create index if not exists idx_planner_audit_field_id 
on planner_audit_logs (field_update_id);


-- 5. Stored Procedure for Semantic Cosine Search via pgvector
create or replace function match_schedule_activities (
  query_embedding vector(384),
  match_threshold float,
  match_count int
)
returns table (
  activity_id text,
  activity_name text,
  discipline text,
  wbs_code text,
  similarity float
)
language sql stable
as $$
  select
    schedule_activities.activity_id,
    schedule_activities.activity_name,
    schedule_activities.discipline,
    schedule_activities.wbs_code,
    1 - (schedule_activities.embedding <=> query_embedding) as similarity
  from schedule_activities
  where 1 - (schedule_activities.embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
$$;

-- 6. Authentication, authorization, and RLS
--
-- Browser access uses the publishable/anon key only after Supabase Auth
-- establishes an authenticated session. System workers use the service-role
-- key and intentionally bypass RLS.
--
-- User roles are intentionally stored in a database table rather than in
-- user-editable metadata. The helper below is SECURITY DEFINER and has a
-- fixed search_path so policies cannot be escalated by end users.

create table if not exists user_roles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    role text not null check (role in ('site', 'engineer', 'planner', 'admin')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_user_roles_role on user_roles(role);

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $
    select role
    from public.user_roles
    where user_id = (select auth.uid())
    limit 1;
$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

-- Track the authenticated submitter so field reports can be scoped to their
-- own rows. The service-role worker may leave this null for system imports.
alter table field_updates
    add column if not exists submitted_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_field_updates_submitted_by
    on field_updates(submitted_by_user_id);

-- Apply least privilege. The service_role grant is intentionally broad because
-- server-side matching/import workers use that credential and never expose it.
revoke all on table schedule_activities from anon, authenticated;
revoke all on table domain_aliases from anon, authenticated;
revoke all on table field_updates from anon, authenticated;
revoke all on table planner_audit_logs from anon, authenticated;
revoke all on table user_roles from anon, authenticated;

grant select on table schedule_activities to authenticated;
grant select, insert, update on table domain_aliases to authenticated;
grant select, insert, update on table field_updates to authenticated;
grant insert, select on table planner_audit_logs to authenticated;
grant select on table user_roles to authenticated;

grant all on table schedule_activities to service_role;
grant all on table domain_aliases to service_role;
grant all on table field_updates to service_role;
grant all on table planner_audit_logs to service_role;
grant all on table user_roles to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

alter table schedule_activities enable row level security;
alter table domain_aliases enable row level security;
alter table field_updates enable row level security;
alter table planner_audit_logs enable row level security;
alter table user_roles enable row level security;

-- Re-running this schema is safe: replace the policies deterministically.
drop policy if exists "schedule_authenticated_read" on schedule_activities;
drop policy if exists "schedule_planner_admin_write" on schedule_activities;
drop policy if exists "aliases_authenticated_read" on domain_aliases;
drop policy if exists "aliases_authenticated_propose" on domain_aliases;
drop policy if exists "aliases_planner_admin_review" on domain_aliases;
drop policy if exists "field_site_engineer_insert_own" on field_updates;
drop policy if exists "field_site_engineer_select_own" on field_updates;
drop policy if exists "field_planner_admin_select_all" on field_updates;
drop policy if exists "field_planner_admin_update_review" on field_updates;
drop policy if exists "audit_authenticated_insert" on planner_audit_logs;
drop policy if exists "audit_planner_admin_select" on planner_audit_logs;
drop policy if exists "roles_authenticated_read_self" on user_roles;
drop policy if exists "roles_admin_manage" on user_roles;

create policy "schedule_authenticated_read"
on schedule_activities
for select
to authenticated
using (true);

create policy "schedule_planner_admin_write"
on schedule_activities
for all
to authenticated
using (public.current_user_role() in ('planner', 'admin'))
with check (public.current_user_role() in ('planner', 'admin'));

create policy "aliases_authenticated_read"
on domain_aliases
for select
to authenticated
using (true);

create policy "aliases_authenticated_propose"
on domain_aliases
for insert
to authenticated
with check (
    status = 'proposed'
    and public.current_user_role() in ('site', 'engineer', 'planner', 'admin')
    and proposed_by is not null
);

create policy "aliases_planner_admin_review"
on domain_aliases
for update
to authenticated
using (public.current_user_role() in ('planner', 'admin'))
with check (public.current_user_role() in ('planner', 'admin'));

create policy "field_site_engineer_insert_own"
on field_updates
for insert
to authenticated
with check (
    public.current_user_role() in ('site', 'engineer')
    and submitted_by_user_id = (select auth.uid())
    and status = 'pending'
);

create policy "field_site_engineer_select_own"
on field_updates
for select
to authenticated
using (
    submitted_by_user_id = (select auth.uid())
    or public.current_user_role() in ('planner', 'admin')
);

create policy "field_planner_admin_select_all"
on field_updates
for select
to authenticated
using (public.current_user_role() in ('planner', 'admin'));

create policy "field_planner_admin_update_review"
on field_updates
for update
to authenticated
using (public.current_user_role() in ('planner', 'admin'))
with check (public.current_user_role() in ('planner', 'admin'));

create policy "audit_authenticated_insert"
on planner_audit_logs
for insert
to authenticated
with check (
    public.current_user_role() in ('site', 'engineer', 'planner', 'admin')
);

create policy "audit_planner_admin_select"
on planner_audit_logs
for select
to authenticated
using (public.current_user_role() in ('planner', 'admin'));

-- No UPDATE/DELETE policies are created for audit logs: append-only for
-- browser users. service_role remains available to system workers.

create policy "roles_authenticated_read_self"
on user_roles
for select
to authenticated
using (
    user_id = (select auth.uid())
    or public.current_user_role() = 'admin'
);

create policy "roles_admin_manage"
on user_roles
for all
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

-- Stored procedure for semantic search remains available to authenticated
-- browser sessions and server-side service-role workers.
revoke execute on function match_schedule_activities(vector, float, int) from public, anon;
grant execute on function match_schedule_activities(vector, float, int) to authenticated, service_role;
