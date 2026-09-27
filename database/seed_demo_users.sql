-- ============================================================================
-- SETU: Demo Accounts & Role Assignment Seeding Script
-- Creates 4 ready-to-use demo accounts for all roles with exact passwords.
-- Run this in your Supabase SQL Editor.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

do $$
declare
    v_users record;
    v_user_id uuid;
    v_encrypted_pw text;
begin
    -- Temporary table defining all 4 roles and credentials
    create temp table if not exists _demo_users (
        email text primary key,
        raw_password text,
        role text,
        full_name text
    ) on commit drop;

    delete from _demo_users;

    insert into _demo_users (email, raw_password, role, full_name) values
        ('supervisor@gmail.com', 'supervisor@123', 'site',     'Site Supervisor (Duliajan)'),
        ('engineer@gmail.com',   'engineer@123',   'engineer', 'Field Engineer (Pipeline)'),
        ('planner@gmail.com',    'planner@123',    'planner',  'Lead Project Planner'),
        ('admin@gmail.com',      'admin@123',      'admin',    'SETU System Administrator');

    for v_users in select * from _demo_users loop
        -- Generate bcrypt password hash using pgcrypto
        v_encrypted_pw := extensions.crypt(v_users.raw_password, extensions.gen_salt('bf', 10));

        -- 1. Insert or update auth.users
        select id into v_user_id from auth.users where email = v_users.email;

        if v_user_id is null then
            v_user_id := gen_random_uuid();
            insert into auth.users (
                instance_id,
                id,
                aud,
                role,
                email,
                encrypted_password,
                email_confirmed_at,
                raw_app_meta_data,
                raw_user_meta_data,
                created_at,
                updated_at,
                confirmation_token,
                recovery_token,
                email_change_token_new,
                email_change,
                is_super_admin
            ) values (
                '00000000-0000-0000-0000-000000000000'::uuid,
                v_user_id,
                'authenticated',
                'authenticated',
                v_users.email,
                v_encrypted_pw,
                now(),
                jsonb_build_object('provider', 'email', 'providers', array['email']),
                jsonb_build_object('name', v_users.full_name),
                now(),
                now(),
                '',
                '',
                '',
                '',
                false
            );
        else
            update auth.users
            set encrypted_password = v_encrypted_pw,
                email_confirmed_at = coalesce(email_confirmed_at, now()),
                raw_user_meta_data = jsonb_build_object('name', v_users.full_name),
                updated_at = now()
            where id = v_user_id;
        end if;

        -- 2. Insert or update auth.identities (required by Supabase GoTrue email sign-in)
        if exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'identities') then
            insert into auth.identities (
                id,
                user_id,
                identity_data,
                provider,
                provider_id,
                last_sign_in_at,
                created_at,
                updated_at
            ) values (
                v_user_id,
                v_user_id,
                jsonb_build_object('sub', v_user_id::text, 'email', v_users.email),
                'email',
                v_user_id::text,
                now(),
                now(),
                now()
            )
            on conflict do nothing;
        end if;

        -- 3. Assign role in public.user_roles
        insert into public.user_roles (user_id, role, updated_at)
        values (v_user_id, v_users.role, now())
        on conflict (user_id) do update set role = excluded.role, updated_at = now();

    end loop;
end $$;

-- Verify all 4 demo users and roles
select 
    u.email,
    ur.role,
    case 
        when ur.role in ('site', 'engineer') then '/supervisor/capture'
        when ur.role in ('planner', 'admin') then '/planner/command-center'
        else 'No route'
    end as landing_dashboard,
    u.email_confirmed_at is not null as is_confirmed,
    u.created_at
from auth.users u
join public.user_roles ur on u.id = ur.user_id
where u.email in (
    'supervisor@gmail.com', 
    'engineer@gmail.com', 
    'planner@gmail.com', 
    'admin@gmail.com'
)
order by ur.role;
