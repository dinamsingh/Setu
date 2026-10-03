# Phase 0.9B2/B3 local implementation and deployment boundary

This checkout implements worker-safe clarification processing and selected-target
remap validation. It does not apply migrations or deploy either application.

## Processing contract

No new columns. Migration 009 uses B1 evidence/workflow revisions, proposal
generations and resolved clarification history. A pending report with an active
request (open/responded) or active proposal is excluded from normal processing.
Work priority is pending proposals, material evidence revisions, then new reports.
Missing validation on a completed matching result is validated without rematching.

Effective text starts with original `field_text`. Material resolved rounds are
ordered by `(resolved_evidence_revision, created_at, id)` and append:

```text
[Resolved clarification <revision>]
Question: <question>
Response: <response>
```

Only resolved validation/mapping impacts contribute. Confirm-only rounds stay in
history, do not change evidence and do not cause processing. All original source
fields stay unchanged. Supplemental prose does not silently overwrite structured
date/location fields or extract START/FINISH/PROGRESS events.

Validation-input changes keep the existing target and rerun the six validators.
Mapping-input changes rerun the unchanged matcher and then validators. Successful
server-only report CAS updates validation freshness, increments workflow revision
and clears override scope. A duplicate or obsolete computation returns false.

Selected-target proposals never invoke the matcher to choose a target. Validators
use the exact selected baseline activity and effective evidence; the same report
is excluded from duplicate/sequence context. Candidate ambiguity remains a
warning/pass diagnostic about the prior AI ranking, not manual-target confidence.
Proposal results are stored on the proposal only. The planner must finalize after
current pass/warn validation, or a documented evidence/generation-scoped proposal
override. Finalization copies validation and materializes only that proposal's
override into the new target's report scope. Old overrides never transfer.

Parent locks precede child locks. Every planner mutation is authorized and audited
transactionally. Worker endpoints revoke PUBLIC/anon/authenticated EXECUTE and
grant only service_role. Existing 008 child-table read-only RLS remains unchanged.
The local mock's explicit server flag is test-only and never sent to Supabase.

## User-visible lifecycle

Resolve Now records question, communication method, response, supplier and impact.
Request Response addresses the immutable original submitter UUID. SETU does not
send external notifications. Field response is one-time; planner triage selects
impact explicitly. Active workflows and stale validation lock acceptance.

Blocked proposals can be cancelled before clarification or a different target.
Cancellation and subsequent clarification are separate audited transactions: if
another actor intervenes, the next revision-checked RPC fails visibly, not partly
merged or retried with guessed revisions. Close as Invalid requires a reason,
cancels active workflows and uses the existing terminal `rejected` storage state.
Technical Requeue remains separate from clarification.

Queue order: received responses, validation blocks, unmatched/low reviewable
reports, other reviewable/ready-to-confirm reports, awaiting field responses,
processing/AI/proposal-validation waits, finalized history. Equal-priority rows
sort newest first. Matched pending counts overlap workflow-specific counts.
One workflow poll runs every five seconds; failures are visible and actions fail
closed when workflow data is unavailable. AI confidence is not manual-target
confidence. The optional existing alias proposal is secondary and quarantined;
it is inserted only after proposal creation succeeds, never approved by remap.
An alias failure is visible and retries do not duplicate remap proposals. Alias
scoring, normalization and the separate Alias Governance controls are unchanged.

## Exact authorized deployment cutover (not executed here)

1. Verify 008 is present, rehearse 009 and role/RLS checks in staging. Stop the old
   deployed matching worker before introducing material clarification traffic.
2. Apply 009 after 008, keeping existing governance RPC signatures and permissions.
3. Start the new B2 service-role worker; verify its CAS/proposal endpoints with
   server credentials held only by the deployment environment.
4. Deploy B3 frontend. Verify planner Resolve Now, addressed field response/triage,
   material processing, proposal validation/override/finalization and invalid close.
5. Confirm all old browser bundles/clients have cut over. Only then, in a separate
   authorized migration, disable the legacy `review_field_update('remap')` branch.

009 deliberately leaves legacy terminal remap callable and marks it deprecated.
Until step 5, the known legacy old-target-validation gap remains for old clients.
Do not run the old worker or legacy batch-matching/import utilities against live
workflow rows. Those offline/baseline utilities are not redesigned in this phase.

## Verification and remaining gates before Phase 1

Run focused Python workflow/migration tests, the full Python suite, frontend
tests/build/lint and `git diff --check`. `jsdom` is a development-only DOM test
dependency; it does not enter the frontend production bundle.

Optional isolated PostgreSQL verification (no network/database URL):

```text
node scripts/verify_workflow_foundation.mjs <pglite/dist/index.js> --worker-workflow
```

PGlite executes the actual SQL, grants, RLS and audit rollback in a disposable
database. Its single connection does not prove multi-session row-lock behavior.
Before Phase 1: separately authorize deployment; test two workers and simultaneous
planner/field sessions in staging; verify production roles/grants/poll behavior;
complete legacy-client retirement; address pre-existing dependency advisories in
a separate change. No baseline write-back, event extraction, voice agent, actuals
or notifications are implemented here. Schedule Actuals stays an honest shell.

## Changed-file inventory

Database/worker:

- `database/migrations/009_worker_workflow_orchestration.sql`
- `database/supabase_client.py`
- `database/worker_workflow_mock.py`
- `engine/match_worker.py`
- `engine/workflow_processing.py`

Frontend:

- `frontend/package.json`, `frontend/package-lock.json` (development-only jsdom 27)
- `frontend/src/components/planner/RemapModal.tsx`
- `frontend/src/components/planner/ReviewCard.tsx`
- `frontend/src/components/planner/ReviewQueueItem.tsx`
- `frontend/src/components/planner/WorkflowActions.tsx`
- `frontend/src/components/supervisor/NeedsClarification.tsx`
- `frontend/src/hooks/useWorkflow.ts`
- `frontend/src/lib/plannerWorkspace.ts`, `frontend/src/lib/workflow.ts`
- `frontend/src/pages/planner/AuditExport.tsx`
- `frontend/src/pages/planner/CommandCenter.tsx`
- `frontend/src/pages/planner/ReviewQueue.tsx`
- `frontend/src/pages/supervisor/FieldCapture.tsx`
- `frontend/src/types/index.ts`, `frontend/src/types/workflow.ts`

Tests/verification/documentation:

- `frontend/src/components/planner/WorkflowActions.test.tsx`
- `frontend/src/lib/plannerWorkspace.test.ts`, `frontend/src/lib/workflow.test.ts`
- `frontend/src/test/workflowFixtures.ts`
- `scripts/verify_workflow_foundation.mjs`, `scripts/verify_worker_workflow.mjs`
- `tests/test_worker_workflow.py`, `tests/test_worker_workflow_migration.py`
- `docs/phase_0_9b2_b3_workflow.md`
