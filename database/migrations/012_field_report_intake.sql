-- Phase 3 Part 1: optional intake metadata only. Do not apply as part of parsing.
-- No defaults/backfill, grant, RLS, or workflow changes.
begin;

alter table public.field_updates
    add column if not exists discipline text;

comment on column public.field_updates.discipline is
    'Optional reported discipline; nullable for existing/manual submissions. Does not select a schedule activity or imply planner approval.';

-- Separate guard: leave the existing original-submission trigger unchanged.
create or replace function public.protect_field_update_discipline()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    -- Preserve the original-submission guard's service-role maintenance exception.
    if auth.role() = 'service_role' then
        return new;
    end if;

    -- NULL-to-value and value-to-NULL changes are also original-evidence changes.
    if old.discipline is distinct from new.discipline then
        raise exception 'Immutable field: discipline cannot be modified after submission';
    end if;

    return new;
end;
$$;

create or replace trigger trg_protect_field_update_discipline
before update on public.field_updates
for each row execute function public.protect_field_update_discipline();

commit;
