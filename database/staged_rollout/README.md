# SETU Database Staged Rollout Guide

## Supervisor Safe Submission Boundary: Stage C Lockdown

This directory contains database release artifacts that are **intentionally excluded** from the automatic migration directory (`database/migrations/`).

### Why is Stage C behind a manual release barrier?
In a zero-downtime distributed system, revoking database privileges before all client browsers have loaded the updated application bundle will cause immediate `42501 permission denied` failures for supervisors running legacy sessions.

To ensure continuous operation:
1. **Stage A (Migration 014)**: Deployed first. Installs the authoritative `submit_supervisor_field_update` RPC and idempotency receipts table. Legacy table `INSERT` privileges remain active.
2. **Stage B (Frontend Transition)**: Deployed to production. All active supervisors transition to the secure RPC.
3. **Stage C (Lockdown - This Directory)**: Applied manually by an authorized operator once legacy client traffic has ceased.

### How to apply Stage C (Lockdown)

Connect to the target PostgreSQL / Supabase project as an administrator (`postgres` role or via Supabase SQL Editor) and execute:

```sql
\i database/staged_rollout/015_lockdown_direct_field_update_inserts.sql
```

Or copy and run the contents of `015_lockdown_direct_field_update_inserts.sql`.

### Verification checklist after Stage C
1. Verify direct client insert is blocked:
   ```sql
   set role authenticated;
   -- Should fail with 42501 permission denied for table field_updates:
   insert into public.field_updates (field_text, site_location) values ('test', 'loc');
   reset role;
   ```
2. Verify supervisor RPC continues to work:
   ```sql
   select public.submit_supervisor_field_update(
       p_field_text := 'Verified piping progress at manifold area',
       p_site_location := 'Duliajan Manifold Area A',
       p_reported_date := (timezone('Asia/Kolkata', now()))::date,
       p_reported_by := 'Site Supervisor',
       p_discipline := 'Piping',
       p_source_type := 'manual_text'
   );
   ```
3. Verify spreadsheet import (`import_field_reports`) continues to work.

### Safe Rollback Procedure
If unexpected legacy client traffic or an unmigrated script requires temporary direct `INSERT` access:

```sql
begin;
grant insert on table public.field_updates to authenticated;
create policy "field_site_engineer_insert_own" on public.field_updates
for insert to authenticated
with check (
    auth.uid() = submitted_by_user_id
    and status = 'pending'
    and (validation_status is null or validation_status = 'pending')
    and coalesce(validation_overridden, false) = false
);
commit;
```
