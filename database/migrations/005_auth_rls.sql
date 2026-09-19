-- SETU Phase 5 — Auth + RLS migration
-- Apply this migration to an existing Supabase project after backing up the schema.
-- This file mirrors the security section of database/schema.sql.

create table if not exists public.user_roles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    role text not null check (role in ('site', 'engineer', 'planner', 'admin')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_user_roles_role on public.user_roles(role);

alter table public.field_updates
    add column if not exists submitted_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists idx_field_updates_submitted_by
    on public.field_updates(submitted_by_user_id);

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select role from public.user_roles
    where user_id = (select auth.uid())
    limit 1;
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

revoke all on table public.schedule_activities from anon, authenticated;
revoke all on table public.domain_aliases from anon, authenticated;
revoke all on table public.field_updates from anon, authenticated;
revoke all on table public.planner_audit_logs from anon, authenticated;
revoke all on table public.user_roles from anon, authenticated;

grant select on public.schedule_activities to authenticated;
grant select, insert, update on public.domain_aliases to authenticated;
grant select, insert, update on public.field_updates to authenticated;
grant insert, select on public.planner_audit_logs to authenticated;
grant select on public.user_roles to authenticated;

grant all on public.schedule_activities to service_role;
grant all on public.domain_aliases to service_role;
grant all on public.field_updates to service_role;
grant all on public.planner_audit_logs to service_role;
grant all on public.user_roles to service_role;

alter table public.schedule_activities enable row level security;
alter table public.domain_aliases enable row level security;
alter table public.field_updates enable row level security;
alter table public.planner_audit_logs enable row level security;
alter table public.user_roles enable row level security;

drop policy if exists "schedule_authenticated_read" on public.schedule_activities;
drop policy if exists "schedule_planner_admin_write" on public.schedule_activities;
drop policy if exists "aliases_authenticated_read" on public.domain_aliases;
drop policy if exists "aliases_authenticated_propose" on public.domain_aliases;
drop policy if exists "aliases_planner_admin_review" on public.domain_aliases;
drop policy if exists "field_site_engineer_insert_own" on public.field_updates;
drop policy if exists "field_site_engineer_select_own" on public.field_updates;
drop policy if exists "field_planner_admin_select_all" on public.field_updates;
drop policy if exists "field_planner_admin_update_review" on public.field_updates;
drop policy if exists "audit_authenticated_insert" on public.planner_audit_logs;
drop policy if exists "audit_planner_admin_select" on public.planner_audit_logs;
drop policy if exists "roles_authenticated_read_self" on public.user_roles;
drop policy if exists "roles_admin_manage" on public.user_roles;

create policy "schedule_authenticated_read" on public.schedule_activities
for select to authenticated using (true);

create policy "schedule_planner_admin_write" on public.schedule_activities
for all to authenticated
using (public.current_user_role() in ('planner','admin'))
with check (public.current_user_role() in ('planner','admin'));

create policy "aliases_authenticated_read" on public.domain_aliases
for select to authenticated using (true);

create policy "aliases_authenticated_propose" on public.domain_aliases
for insert to authenticated
with check (
    status = 'proposed'
    and proposed_by is not null
    and public.current_user_role() in ('site','engineer','planner','admin')
);

create policy "aliases_planner_admin_review" on public.domain_aliases
for update to authenticated
using (public.current_user_role() in ('planner','admin'))
with check (public.current_user_role() in ('planner','admin'));

create policy "field_site_engineer_insert_own" on public.field_updates
for insert to authenticated
with check (
    public.current_user_role() in ('site','engineer')
    and submitted_by_user_id = (select auth.uid())
    and status = 'pending'
);

create policy "field_site_engineer_select_own" on public.field_updates
for select to authenticated
using (
    submitted_by_user_id = (select auth.uid())
    or public.current_user_role() in ('planner','admin')
);

create policy "field_planner_admin_select_all" on public.field_updates
for select to authenticated
using (public.current_user_role() in ('planner','admin'));

create policy "field_planner_admin_update_review" on public.field_updates
for update to authenticated
using (public.current_user_role() in ('planner','admin'))
with check (public.current_user_role() in ('planner','admin'));

create policy "audit_authenticated_insert" on public.planner_audit_logs
for insert to authenticated
with check (public.current_user_role() in ('site','engineer','planner','admin'));

create policy "audit_planner_admin_select" on public.planner_audit_logs
for select to authenticated
using (public.current_user_role() in ('planner','admin'));

create policy "roles_authenticated_read_self" on public.user_roles
for select to authenticated
using (user_id = (select auth.uid()) or public.current_user_role() = 'admin');

create policy "roles_admin_manage" on public.user_roles
for all to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

revoke execute on function public.match_schedule_activities(vector, float, int) from public, anon;
grant execute on function public.match_schedule_activities(vector, float, int) to authenticated, service_role;
