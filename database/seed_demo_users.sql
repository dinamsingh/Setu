-- SETU evaluator/demo ROLE ASSIGNMENT ONLY.
-- Do not create or modify Supabase Auth users by writing directly to auth.users.
-- IMPORTANT: Earlier repository history contained static demo credentials.
-- An administrator must rotate any accounts provisioned with that old script.
--
-- Secure workflow:
-- 1. Supabase Dashboard > Authentication > Users: create accounts / send invites
--    with unique passwords. Use distinct, temporary SIH evaluator identities.
-- 2. Replace the required placeholders below with those exact account emails.
-- 3. Run in SQL Editor as an administrator. A missing user aborts all role changes.
-- 4. Never publish passwords, Auth tokens, or privileged keys in this repository.
--
-- Site and Planner are required for the evaluator walkthrough. Engineer and Admin
-- are optional; setting those email variables to null skips those assignments.
-- Existing users and roles are NOT removed or reset by this script.

begin;

do $$
declare
    v_site_email text := 'REPLACE_WITH_EVALUATOR_SITE_EMAIL';
    v_planner_email text := 'REPLACE_WITH_EVALUATOR_PLANNER_EMAIL';
    v_engineer_email text := null;
    v_admin_email text := null;
    v_mapping record;
    v_user_id uuid;
begin
    if v_site_email like 'REPLACE_WITH_%'
       or v_planner_email like 'REPLACE_WITH_%'
       or nullif(pg_catalog.btrim(v_site_email), '') is null
       or nullif(pg_catalog.btrim(v_planner_email), '') is null then
        raise exception 'Specify existing Site and Planner Auth emails before assigning evaluator roles';
    end if;

    if lower(v_site_email) = lower(v_planner_email) then
        raise exception 'Site and Planner must use distinct Auth accounts';
    end if;

    for v_mapping in
        select x.email, x.role
        from (
            values
                (v_site_email, 'site'),
                (v_planner_email, 'planner'),
                (v_engineer_email, 'engineer'),
                (v_admin_email, 'admin')
        ) as x(email, role)
        where x.email is not null
    loop
        if v_mapping.email like 'REPLACE_WITH_%'
           or nullif(pg_catalog.btrim(v_mapping.email), '') is null then
            raise exception 'Invalid evaluator account email for role %', v_mapping.role;
        end if;

        select id into v_user_id
        from auth.users
        where lower(email) = lower(pg_catalog.btrim(v_mapping.email));

        if v_user_id is null then
            raise exception 'Auth account not found for role %; create/invite it using the Supabase Dashboard first', v_mapping.role;
        end if;

        if exists (
            select 1 from public.user_roles
            where user_id = v_user_id and role <> v_mapping.role
        ) then
            raise exception 'Account already has a different SETU role; do not overwrite it automatically';
        end if;

        insert into public.user_roles (user_id, role, updated_at)
        values (v_user_id, v_mapping.role, now())
        on conflict (user_id)
        do update set role = excluded.role, updated_at = excluded.updated_at;
    end loop;
end;
$$;

commit;
