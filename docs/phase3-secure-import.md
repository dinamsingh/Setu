# Phase 3 Part 3A: secure import foundation (not deployed)

Migration order: existing 005–011 → **012_field_report_intake.sql** →
**013_secure_field_report_import.sql**. 012 stays unchanged. Apply only after a
separate authorized deployment and PostgreSQL concurrency verification. Part 3B
adds confirmation and a typed RPC adapter, but real submission remains off by
default. The attachment entry and manual composer behavior remain unchanged.

## RPC contract and authority

`public.import_field_reports(p_request_id uuid, p_source_format text, p_rows jsonb)`
returns JSON. The caller generates one request UUID per reviewed payload and keeps
it unchanged on transport retries. Source format is exactly `csv` or `xlsx`.
Each row contains an integer `row_number` (original record/worksheet row, 2–1001),
required text `field_text`, required ISO calendar `reported_date`, and optional
text/null `site_location`, `reported_by`, `discipline`. Source row numbers must be
unique. Unknown keys are rejected, including identity, IDs, AI data, validation,
planner decisions and approval fields. Future UI must send normalized dates, not
regional display strings. These are report dates, not approved schedule actuals.

Only `authenticated` receives EXECUTE; the RPC also requires `auth.uid()`, an
authenticated JWT role and authoritative `current_user_role()` site/engineer
membership. Planner/admin, unassigned, anon and service-role callers are denied.
Authorization assumes Supabase validates JWTs and protects the `user_roles`
authority; user metadata is never used. SECURITY DEFINER is deliberately needed
for owner-only receipts and controlled inserts, not a general RLS bypass API.
The empty search path and qualified objects prevent object-shadowing attacks.

Server checks every JSON type, nonblank narrative, strict valid YYYY-MM-DD date
(years 0001–9999), supported discipline, unsafe controls, 10,000-character text
limits, 1–1,000-row bounds and a 16 MiB serialized JSON cap. Discipline normalizes
case to the same six parser values; optional blank text becomes null. Narrative
case/content is retained after trimming. PostgreSQL character limits count Unicode
characters; browser limits count UTF-16 units and can be stricter for emoji. File,
ZIP, formula and XML safety remain browser-parser responsibilities: this RPC
accepts report data, not raw files, and cannot attest the original workbook bytes.

New reports get server UUID/update IDs, spreadsheet_csv/spreadsheet_xlsx source,
`submitted_by_user_id = auth.uid()`, pending/Pending, zero matching score, no link,
no candidates/validation/override. Existing revision defaults are untouched.
The current worker fetches pending evidence without filtering source tags and
processes these reports normally. Extraction/matching do not imply human approval.

## Atomicity and summaries

Invalid envelope/authorization raises an RPC error with no writes. Row-validation
errors return `status: rejected`, zero imports/duplicates, error_count = number of
invalid rows, and an errors list with source row, input index, field/code/message.
**Valid siblings are not inserted.** Validation failures do not consume request IDs.

Success returns `status: completed`, total_rows, imported_count, duplicate_count,
zero errors, replayed, and row-number-ordered outcomes with server IDs. Duplicate
counts count input rows, not distinct reports. New requests may contain existing
reports; only genuinely new reports are inserted. Duplicate reports are never
overwritten/rematched/reapproved. Unexpected storage, uniqueness, FK or timeout
errors propagate; reports, fingerprint reservations and the receipt roll back
together. Never display a validation error or RPC failure as completed success.

Retrying a completed identical request returns the same IDs, **zero new imports**,
all input rows marked duplicate, and replayed=true. Reusing that UUID with different
valid rows or a different source format raises an error. A corrected rejected
payload can reuse its key because it previously wrote nothing. After a transport
timeout, retry exactly the original payload/key; do not generate a fresh key.

## Deduplication and concurrency

Two owner-only, RLS-enabled tables have no direct client grants/policies:

- Batch receipt: primary key `(actor_user_id, request_id)`, exact payload/source,
  summary. A unique insert claims the receipt; conflicts wait, then a separate
  statement reads it. A receipt is never committed without a completed summary.
- Report fingerprint: primary key `(actor_user_id, fingerprint)`, SHA-256 of the
  JSON array `[field_text, site_location, reported_date, reported_by, discipline]`,
  plus exact canonical data for collision detection and unique report UUID/ID.
  Row numbers, filename and CSV/XLSX format do not affect cross-upload identity.
  Trim/canonical-discipline differences dedupe; narrative case differences do not.

Same-user identical reports, including repeated rows in one file, are duplicates.
Other submitters retain separate evidence; no cross-user existence leak or silent
merging. Near-duplicate or same-work-different-wording detection is intentionally
not added. Manual reports predating this path are not backfilled or deduplicated.
This can suppress an intentional identical re-report by one user; product policy
must be reviewed before confirmation is enabled, not bypassed with random hashes.

Fingerprint insertions run in a consistent sorted order to avoid opposite-order
overlap deadlocks. Unique constraints arbitrate both same-request and different-
request concurrent retries. The reserved UUID uses a deferred FK until the report
is inserted in the same transaction. Missing conflict receipts cause SQLSTATE
40001, not a busy loop or fabricated success. Assumes normal READ COMMITTED RPC
transactions; stricter isolation may require whole-request retry on serialization
failure. No client-side check is relied on for concurrency safety.

## Immutability and compatibility

012 and the original-submission trigger remain unchanged. An additional guard
requires a matching protected fingerprint reservation for browser spreadsheet-tag
inserts and protects imported `reported_by` (not covered by the old trigger).
The guard's direct EXECUTE is revoked. Existing immutable fields and nullable
discipline stay protected; the established JWT service-role maintenance exception
is preserved. It is a trusted exception, not an import API permission.

Existing manual RLS/grants/INSERT behavior are intentionally not hardened globally
in this phase. They are not a server-validated bulk-import endpoint and do not use
the new ledgers. Direct manual report writes remain an existing security boundary
to review separately. Dedup ledgers retain original canonical snapshots even if
trusted maintenance rewrites a report; such maintenance needs an operational audit
policy. FK restrict prevents deletion of imported reports while receipts refer to
them. Receipt storage/retention and per-user rate limiting need deployment planning.

## Verification

Static Vitest contracts are in `fieldReportImportMigration.test.ts`. They do not
prove SQL execution or concurrency. `scripts/verify_field_report_import.mjs` runs
the actual migrations 005–013 in **in-memory PGlite**, using existing source schema
and mocked JWT functions/roles. It checks authorization/ACL/RLS, validation bounds,
duplicates, queued retries, original fields, worker CAS compatibility and rollback
after a forced second-row storage failure. It never reads env files or connects
to Supabase. Optional existing runtime example:

```powershell
node scripts/verify_field_report_import.mjs C:/Users/singh/AppData/Local/Temp/setu-phase1-pglite-20261005/node_modules/@electric-sql/pglite/dist/index.js
```

PGlite runs real PostgreSQL SQL, but has **one serialized connection**. Queued
Promise.all retries cannot verify independent MVCC sessions. Before deployment,
test two separate PostgreSQL sessions: identical request/key simultaneously;
different keys with identical rows; opposite-order overlapping batches; rollback
of a blocked first contender; and different valid payloads with one key. Verify
one report per actor/fingerprint, no orphan reservations, exact summaries and
unchanged evidence/worker state. Supabase JWT/PostgREST integration and deployed
schema/privilege drift remain unverified until explicitly authorized staging QA.

## Part 3B: confirmation and release gate

The existing review step now leads to explicit confirmation. All preview rows
must be locally valid, including duplicate checks; no subset is silently sent.
The adapter whitelists only original report fields and row_number from corrected,
normalized preview data. Server validation remains authoritative. The user must
acknowledge that reports enter matching and planner review, not approval.

`frontend/src/lib/fieldReportImportDeployment.ts` contains three release-controlled
flags, all **false**: migration012Verified, migration013Verified, submissionEnabled.
All three must be true for both the UI and adapter to permit submission. There is
no browser toggle, schema probe or automatic enablement. This gate is a deployment
safety control, **not** authorization: a modified browser cannot bypass RPC role
checks. Do not enable it simply because SQL files exist or static tests pass.

Before a separately authorized release enables it:

1. Independently verify deployment of 012, nullable discipline, and NULL/value
   immutability including the established service maintenance exception.
2. Independently verify 013 RPC signature, authoritative roles, protected ledger
   ACL/RLS, helper grants, search paths, atomic validation/rollback and uniqueness.
3. Run the independent PostgreSQL-session contention cases above. Serialized
   PGlite checks are not sufficient concurrency evidence.
4. Verify staging JWT/PostgREST behavior, own-report visibility and worker uptake;
   no automatic planner approval or baseline writes. Confirm existing manual
   submission and clarification/remap behavior remain intact.
5. Record verification evidence and deployment target, then explicitly enable all
   three flags in an approved frontend release. Disable submissionEnabled to close
   intake without changing manual submission. No env/secrets are added here.

Confirmation creates a cryptographic UUID and freezes a whitelist payload. Exactly
one RPC POST is issued per click; rapid duplicate clicks are guarded synchronously.
Manual retry reuses the identical UUID and payload. Preview edits, Back, Cancel,
file changes and Site Log/account navigation are locked until confirmation is
cancelled **before sending**, or a definitive server result permits returning to
review. In-flight/uncertain outcomes also install a browser unload warning.

Completed responses must match the UUID, row numbers, IDs and counts before success
is displayed. Imported and duplicate counts/row outcomes are shown separately;
replays explicitly say zero additional reports. Rejected batches show zero imports
and structured row errors. Structured SQL/PostgREST errors surface as failed
requests. Fetch failures, ambiguous HTTP failures, missing or malformed successful
replies mean **outcome unknown**, not success or cancellation. They preserve the
request for explicit retry; no automatic retry or optimistic success exists.
A 30-second response deadline also produces an uncertain outcome. It does not
claim to cancel the server transaction. Late responses cannot replace the displayed
uncertainty; the user verifies completion by retrying the original request.

Request state lives in the active wizard, not localStorage/sessionStorage. No
personal report data is persisted on the device. Forced page reload/closure can
discard the request despite the warning; re-uploading identical normalized reports
is still protected by server actor-scoped fingerprints, but cannot reconstruct the
original receipt. Durable retry recovery would require a separately designed
privacy/retention policy. Account changes block retry under a different actor.

After confirmed completion the Site Log refreshes using its existing read hook;
refresh failure does not negate the verified import. Manual composer draft fields
are neither submitted nor cleared. Cancel/close returns to that draft.

All Part 3B tests mock Supabase and forbid network fetches. They verify gate
combinations, explicit acknowledgement/cancellation, corrected rows, stable retries,
duplicates, batch rejection, RPC errors and ambiguous/malformed responses. They
do not validate live deployment, RPC permissions or production connectivity.
