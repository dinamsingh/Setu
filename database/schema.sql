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
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_field_updates_status 
on field_updates (status);

create index if not exists idx_field_updates_confidence 
on field_updates (confidence_level);


-- 4. Planner Audit Logs Table (Full decision trail for compliance)
create table if not exists planner_audit_logs (
    id uuid primary key default gen_random_uuid(),
    field_update_id uuid references field_updates(id) on delete cascade,
    action text not null,                            -- 'auto_link', 'accept', 'reject', 'remap'
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

-- 6. Permissions for PostgREST / Supabase Client Access
grant all on table schedule_activities to anon, authenticated, service_role;
grant all on table domain_aliases to anon, authenticated, service_role;
grant all on table field_updates to anon, authenticated, service_role;
grant all on table planner_audit_logs to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

-- Disable Row Level Security (RLS) so the anon key can insert and update
alter table schedule_activities disable row level security;
alter table domain_aliases disable row level security;
alter table field_updates disable row level security;
alter table planner_audit_logs disable row level security;

