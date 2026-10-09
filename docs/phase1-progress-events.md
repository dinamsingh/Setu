# Phase 1: structured progress evidence

## Boundaries

This layer interprets actual-progress wording independently of schedule matching. It does not change scoring, candidates, thresholds, validation, planner decisions, baseline dates or schedule progress. No external AI API or machine clock is used for event dates. Migration 010 is a local review artifact; deployment requires separate authorization.

## Extraction

`engine/progress_events.py` returns deterministic, zero-based ordered dictionaries under `phase1_rules_v1`:

- START: explicit past wording `started`, `commenced`, `began`.
- FINISH: explicit `completed`, `finished`. Completion does not imply a percentage.
- PROGRESS: explicit numeric `% complete`, `% completed`, `% done`, including decimals, within 0–100. Decimal bounds are checked before JSON-number conversion. A percentage-bearing clause does not produce an unqualified FINISH, including unsupported/invalid percentage grammar. Comma-formatted values and signed percentages are conservatively unsupported.
- UNKNOWN: exactly one fallback when no supported actual event is found. It preserves evidence and is not an error.

Planning, future, modal, negated and question-mark clauses are conservatively excluded. Sentence punctuation, commas, semicolons, newlines and `and/but/while/then` scope clauses. Non-actual wording carries conservatively across `and`, including a comma followed by `and`; sentence punctuation and contrasting/new-clause separators reset it. Comma-plus-conjunction is one boundary, so an empty intermediate clause cannot erase inherited planning or negation. Duplicate rule hits within a clause are removed. Distinct clauses can describe distinct events; the layer does not infer whether they refer to the same sub-task.

The manner phrases `without delay`, `without issues`, `as per plan`, and `according to plan` do not suppress otherwise actual statements. Other planning, future and negation terms remain effective, including when those manner phrases occur. A spaced hyphen after a report label permits a percentage list item (`Task 1 - 60% done`); adjacent signs and standalone signed percentages remain unsupported. Evidence text is preserved unchanged.

`today/yesterday` resolve only against a valid canonical `reported_date`. Explicit ISO dates are supported. Missing/invalid anchors, absent dates and ambiguous date scope remain NULL with a reason. Named dates, complex tense/scope, quantities, implied percentages and language translation are outside these rules. Conservative false negatives are preferable to invented actuals.

## Evidence and revisions

`engine/progress_processing.py` reuses B2 `material_rounds`: original evidence first, followed by resolved material responses in the existing deterministic order. It excludes confirm-only, open, responded, cancelled and future-revision rounds. Planner questions and generated provenance headers are not field assertions. Each event retains its supporting clause and records original-report or clarification ID/revision provenance in its reason. Relative words in clarification responses still use the original report's `reported_date`, as required; they do not borrow response timestamps.

Responses supplement historical evidence; Phase 1 does not adjudicate contradictory reports or collapse their events into a single authoritative schedule actual. That remains a human/workflow concern. Stored events are machine evidence, even when their parent mapping is approved.

## Storage and security

`public.progress_events` columns:

- `id uuid` primary key, generated UUID.
- `field_update_id uuid` non-null restrictive foreign key to `field_updates.id`.
- `evidence_revision bigint` non-negative.
- `event_index integer` non-negative, stable zero-based ordering.
- `event_type text`: START, FINISH, PROGRESS, UNKNOWN only.
- `event_date date` nullable; UNKNOWN always NULL.
- `progress_percent numeric` nullable, bounded 0–100, required only for PROGRESS.
- `evidence_text text`, `extraction_reason text`: non-empty.
- `extraction_version text`: non-null, default `phase1_rules_v1`.
- `created_at timestamptz`: database creation timestamp, not event-date inference.

Unique `(field_update_id, evidence_revision, event_index)` provides idempotency and the report/revision read index. Historical revisions are not overwritten. A trigger prevents UPDATE/DELETE, including privileged direct modifications.

Nullable `field_updates.progress_extraction_revision` indicates extraction completion and cannot exceed the current evidence revision. NULL permits safe backfill of existing reports, including finalized reports. Authenticated INSERT has an additive restrictive policy requiring an empty marker; existing canonical submission behavior remains valid. Existing authenticated UPDATE revocation is unchanged.

SELECT on events follows an EXISTS query through the parent's existing RLS. Authenticated clients receive SELECT only. Anonymous clients have no access. Service-role workers receive SELECT/INSERT and sole API EXECUTE permission for `complete_field_update_progress_extraction(uuid,bigint,jsonb)`. The internal history trigger helper has no direct role EXECUTE grants. Both functions have an empty search path and schema-qualified objects.

## Worker integration

The existing matching/proposal/validation pass is unchanged. A separate extraction pass runs afterwards and processes mismatched/NULL markers. The service RPC locks the parent, compares the expected evidence revision, validates the entire ordered payload, inserts history and advances the marker in one transaction. Stale results return false. A completed retry returns true without changing the first stored extraction. A malformed later event rolls back earlier inserts and the marker. Extraction failures are caught separately; successful matching is not rolled back. The worker fetches at most 25 eligible reports per cycle through a service-only RPC, ordered by `(created_at, id)`, after all matching/proposal/validation work. A partial index covers incomplete revisions. The existing matching fetch remains unchanged; extraction does not scan that collection. After fetching the bounded report batch, extraction performs one fresh clarification query filtered to those report IDs. It never receives the matching pass's older clarification snapshot. Existing material-response ordering and revision filtering remain unchanged. A resolution committed before the report batch is read is visible to the later clarification query; a resolution after that batch advances the revision and completion CAS rejects the stale result. A failed clarification query cannot advance extraction markers.

Durable retry fields are `progress_extraction_retry_revision`, `progress_extraction_attempts`, `progress_extraction_last_error`, and `progress_extraction_next_attempt_at`. Failure writeback locks the parent and checks the expected evidence revision. Delays are 30, 60, 120, 240, 480, 960 seconds, then a 1,800-second cap. Old-revision deadlines do not block new evidence. Success resets all retry fields. A failing row does not block later eligible rows. Error summaries expose only the exception class and a safe database error code, never raw exception messages or credentials. If batch reads or durable failure writeback fail, extraction is disabled until worker restart; matching continues.

The extraction marker does not bump `workflow_revision`, alter matching/validation/override fields or create a planner decision/audit action. Technical requeue without an evidence change does not duplicate extraction. Rule-version upgrades will require an explicit history/version strategy rather than rewriting an existing revision.

## Planner surface

A compact Progress Events section sits under Field Evidence in the existing ReviewCard. It shows only the selected report's current evidence revision, dates/percentages, and expandable evidence/rules. Pending extraction hides stale events. UNKNOWN says “Needs planner interpretation.” Loading, read failure, missing rows and read-only retry states are explicit. Fetch cleanup and render keys prevent stale report/revision/user results from appearing. While the selected report's extraction revision differs from its evidence revision, a sequential five-second timer calls the existing quiet parent refetch. Only one extra request can be in flight. The timer stops on completion, report/identity change, or unmount. The refreshed marker triggers a current-revision event read without manual reload. Finalized reports remain read-only; no event editing or schedule writeback is introduced.

## Verification and deployment

Run the Python suite, frontend tests/build/lint, static migration contracts and the disposable PostgreSQL fixture:

```text
python -m pytest -q -p no:cacheprovider
npm --prefix frontend run test
npm --prefix frontend run build
npm --prefix frontend run lint
node scripts/verify_workflow_foundation.mjs /path/to/pglite/dist/index.js --progress-events
git diff --check
```

PGlite executes real SQL, ACLs and RLS in memory; it does not prove multi-session production lock behavior. The optional test runtime is not an application dependency. Migration 010 must be reviewed/applied separately before deploying the updated worker. At startup the worker checks a service-only readiness RPC plus a zero-row batch query. Missing Phase 1 table/RPC capability logs one actionable message and disables only extraction until restart. Matching/validation remains available, and the frontend shows pending extraction rather than stale data. No live migration, worker restart or frontend deployment is part of this implementation.

## File inventory

Modified integration files:

- `database/supabase_client.py`: mock table/marker defaults and dedicated RPC dispatch only.
- `engine/match_worker.py`: separate extraction pass only; matching loop unchanged.
- `frontend/src/types/index.ts`: optional extraction revision marker.
- `frontend/src/components/planner/ReviewCard.tsx`: read-only section and props.
- `frontend/src/pages/planner/ReviewQueue.tsx`: selected-report hook/props.
- `scripts/verify_workflow_foundation.mjs`: optional isolated Phase 1 verification flag.

New files:

- `database/migrations/010_progress_events.sql`
- `database/progress_mock.py`
- `engine/progress_events.py`
- `engine/progress_processing.py`
- `frontend/src/types/progressEvents.ts`
- `frontend/src/hooks/useProgressEvents.ts`
- `frontend/src/hooks/useProgressEvents.test.tsx`
- `frontend/src/components/planner/ProgressEventsSection.tsx`
- `frontend/src/components/planner/ProgressEventsSection.test.tsx`
- `scripts/verify_progress_events.mjs`
- `tests/test_progress_events.py`
- `tests/test_progress_events_migration.py`
- `tests/test_progress_processing.py`
- `docs/phase1-progress-events.md`

Unrelated pre-existing brag output remains untouched. Migrations 005–009, matching/embedding/fuzzy/alias/validator code, benchmark data, landing and environment files are unchanged. No Git stash access, staging, commit or push is performed.


## Non-blocking follow-ups deliberately deferred

- Privileged `service_role` direct marker tampering.
- Extraction-version replay and migration policy.
- Broader natural-language coverage.
- A full two-session PostgreSQL concurrency harness.
- Horizontal multi-worker claiming / `SKIP LOCKED`; the current worker keeps its bounded 25-report extraction pass.

These are outside this Phase 1 blocker fix. Migration 010 remains an unapplied review artifact.
