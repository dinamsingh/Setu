# Phase 3: real PostgreSQL 17 bulk-import verification

Run from the requested worktree root:

```powershell
Set-Location D:\SETU-phase3
node scripts/verify_field_report_import_postgres.mjs
```

Requires **existing, running** `setu-phase3-pgtest` and database `setu_test`, with
PostgreSQL 17 and its configured test superuser. The harness has no container,
database, connection-string or credential overrides. It uses `docker exec` and
persistent `psql` over the container's Unix socket; no npm packages, exposed port,
password inspection, env-file reads, live Supabase connection or image download.
The configured non-secret POSTGRES_USER is referenced only inside the container.
Unavailable container, wrong database/version, non-superuser or wrong worktree
stops verification. No unrelated container is listed, stopped or changed.

## Fixture safety

A fresh database must have no user relations, extra schemas or Supabase fixture
roles. The harness refuses to reset an unmarked nonempty database. Initial setup
copies the necessary base tables from repository schema.sql and recreates the
test-only JWT functions/users/roles from the existing PGlite verifier. The minimal
schedule table and vector-domain/matcher-function stub satisfy pre-existing SQL
dependencies; this suite does **not** verify pgvector or matching behavior.

Migrations **005 through 013** are read from disk and executed unchanged in order,
only inside this database. A private harness marker records the base schema and
migration digest. Repeated runs reuse only a matching complete fixture, never
rewrite schema to make assertions pass. Incomplete setup or changed inputs require
separate operator-directed fixture recovery; there is no automatic reset/drop.
Every run uses new test actor UUIDs, request UUIDs and report narrative prefix.
Synthetic records/receipts remain in the isolated database for inspection. No
production role settings are changed; all application role simulation is session
local SET ROLE plus test JWT claims.

## Actual concurrency, not serialized promises

Three independent persistent psql processes connect to distinct PostgreSQL backend
PIDs: import A, import B, observer. Assertions query `pg_blocking_pids()` and
`pg_stat_activity.wait_event_type='Lock'` to prove the transactions overlap.
READ COMMITTED, statement/lock/idle-transaction timeouts and harness deadlines
bound failures. No timing-only sleep is accepted as proof of contention.

Scenarios:

1. Same request UUID: B waits for A's commit, returns replay/duplicate with the
   original report ID, one report/fingerprint/batch receipt persists.
2. Different UUIDs and source formats: same canonical report waits on fingerprint
   uniqueness, returns duplicate with original ID, two batch receipts persist.
3. Conflicting payload under one UUID: B waits, then raises SQLSTATE 22023;
   conflicting source-format reuse also fails; no extra report/receipt persists.
4. Same-key waiter after A rolls back: B creates one report and a complete receipt;
   uncommitted report ID from A does not survive.
5. Opposite-order batches: a **test-only** trigger pauses A after its first
   fingerprint reservation using an observer-held advisory lock. B's reversed
   input blocks on A's same first sorted fingerprint. Releasing the barrier lets
   both finish without deadlock, with only two reports. This changes no production
   function; it observes the real import function's ordering.
6. Authorization: anon/service_role/planner/admin/unassigned/missing JWT identity
   fail; site/engineer pass; different actors retain separate reports and RLS
   prevents reading another site's report. Ledger table/helper ACL and hardened
   RPC properties are inspected in the real catalogs.
7. Validation: invalid JSON types, fields, source row numbers, narrative, controls,
   text lengths, dates, discipline, envelopes and payload/batch limits write
   nothing, including valid siblings. Corrected rejected request keys remain usable.
8. Defaults/idempotency/immutability: pending/Pending, no AI/validation/approval;
   normalized cross-upload and in-file duplicates, calendar boundary dates,
   direct spreadsheet-tag bypass denial, immutable original fields including
   discipline NULL transitions. Service-role maintenance remains possible.
9. Mid-batch storage failure: a test-only trigger fails the second report in actual
   sorted fingerprint order. Earlier report and reservations/receipt all roll
   back; removing the fixture trigger permits the exact same request to succeed.
10. Final invariants: no orphan fingerprint rows, unfinished receipts, duplicate
    fingerprints, planner audit decisions or new deadlocks. Migration file inputs
    are unchanged and every frontend submission flag remains false.

The suite logs every scenario and exact assertion/pass/failure totals. It stops on
the first unexpected assertion/SQL error, without modifying production logic.
Finally it releases its own locks/transactions and removes only its registered
test helper triggers/functions. All test records and main fixture objects remain.

## What this verifies—and what it does not

This is real PostgreSQL 17 SQL execution, actual independent-session MVCC and
constraint/transaction behavior, unlike the preserved serialized PGlite verifier.
Auth.uid()/auth.role() are still simulated JWT functions: Supabase JWT validation,
PostgREST responses/timeouts, deployed-schema drift, frontend connectivity and
worker uptake need separately authorized staging checks. Passing this suite does
**not** enable the frontend gate or certify live migration deployment.

Existing `scripts/verify_field_report_import.mjs` and frontend tests remain
unchanged. This harness adds no application dependency or production SQL changes.
