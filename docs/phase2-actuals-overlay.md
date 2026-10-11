# Phase 2: planner actuals overlay

This overlay is derived and read-only. It does not update the imported schedule
baseline, approve field evidence, run another worker, or write to Primavera/MS
Project. Migration 011 is additive and contains only two live views, comments,
and explicit privileges. It must be deployed separately after review; it has not
been applied to live Supabase during implementation.

## Current governance contract

The implementation uses the existing 008/009 contract, not invented metadata:

- `_append_workflow_audit` writes `actor_user_id = auth.uid()` and merges numeric
  `evidence_revision` and `workflow_revision` into `metadata` **after** the parent
  workflow revision advances. The selected activity is the audit column
  `new_activity_id`, not a fabricated metadata key.
- Governed Accept writes action `accept`, parent status `approved`, and metadata
  `legacy_terminal_remap: false`. `accept_current_field_update` delegates to this
  revision-bound Accept. The audit does not distinguish this wrapper from the
  modern revision-bound `review_field_update` Accept; both use the same governed
  validation/authorization contract and are eligible.
- `finalize_field_update_remap` writes action `remap`, parent status `remapped`,
  and metadata `proposal_id`, `target_activity_id`, `validation_generation`,
  `validation_status`, `validation_results`, `validation_overridden`, and
  `override_by_user_id`, alongside the parent revisions.
- A proposal's original `workflow_revision` is a processing snapshot, not the
  final parent workflow revision. It must not be compared to the terminal audit
  revision. The final parent revision is bound by the audit instead.

Legacy approvals without these bindings and legacy terminal remaps (including
the callable compatibility path) are intentionally excluded. There is no
backfill, fabricated actor, or compatibility shortcut.

## Eligibility and provenance

`schedule_actuals_evidence` returns one row per eligible current event:

1. Parent status is `approved` or `remapped` and its mapping resolves to an
   existing schedule activity.
2. Event and completed extraction marker both match the parent evidence revision.
3. Event type is START, FINISH, or PROGRESS; UNKNOWN never contributes.
4. Validation revision is current. `pass`/`warn` contribute; `block` requires
   the existing current evidence/activity-scoped override.
5. A non-null authoritative audit actor, terminal action, selected activity,
   evidence revision, and workflow revision all bind the current parent state.
6. Remapped evidence also needs a finalized current proposal for that target,
   current validation generation and evidence revision, and current proposal
   override scope for blocked validation. The corresponding audit must bind its
   proposal ID, target, generation, status, and override state.

Audit/proposal selection happens together in a lateral subquery with `LIMIT 1`.
Matching audits are ordered by `created_at DESC NULLS LAST, id DESC`. Duplicated
matching audit records cannot multiply an event. Metadata revision equality uses
JSONB values rather than risky casts of legacy text.

Provenance exposes source report, immutable receipt date, evidence revision,
event index/date/percentage/text, extraction reason/version/time, authoritative
decision actor and audit/time, display-only planner label, and finalized proposal
ID. `chronology_date = coalesce(event_date, reported_date)` is an ordering aid for
PROGRESS only. It is never an inferred START/FINISH date.

## Selection and conflicts

`schedule_actuals_overlay` retains every visible baseline activity, including
activities without eligible events. Baseline identity and planned dates are
copied without mutation. Empty actuals are NULL; counts are zero.

- START: earliest non-null explicit START event date.
- FINISH: latest non-null explicit FINISH event date.
- START/FINISH source ties: report receipt time descending (nulls last), report
  UUID descending, event index descending, then event UUID descending.
- PROGRESS: latest non-null chronology date, then report receipt time descending
  (nulls last), report UUID descending, event index descending, event UUID
  descending. Percentage magnitude and approval/extraction time do not select
  progress. Events lacking both an event date and a reported date do not suppress
  the latest usable PROGRESS. They remain in provenance and event/report counts,
  and the unresolved-date warning remains visible. If all eligible PROGRESS events
  lack usable chronology, progress and its selected source event remain NULL.
  No date is invented for unanchored evidence.
- FINISH never forces 100%; PROGRESS 100 never creates FINISH or START.

Boolean flags are deterministic and disclosed without repairing source evidence:

- `finish_before_start`: selected finish precedes selected start.
- `multiple_start_dates` / `multiple_finish_dates`: more than one distinct explicit
  dated event of that type; earliest START/latest FINISH still win.
- `progress_regression`: any later chronology day contains a percentage below a
  prior day's highest percentage. Historical regressions remain visible even
  after recovery. Same-day tie-breaks do not invent an earlier/later relationship.
- `progress_after_finish`: any PROGRESS chronology date exceeds selected finish.
- `ambiguous_progress_order`: any chronology day contains distinct percentages;
  deterministic selection remains visible, not silently presented as certainty.
- `unresolved_event_date`: any eligible event has no explicit event date, including
  PROGRESS ordered by reported date. This warning does not erase other dated events.
- `start_not_evidenced`: FINISH exists without any explicit START event. An undated
  START instead produces the unresolved-date warning.

Counts include eligible undated events and distinct contributing reports. Summary
timestamps are metadata only. No server clock supplies an actual date. No giant
evidence JSON array is aggregated into activity rows. The `MATERIALIZED` CTE is
request-local query evaluation, **not** a persistent/materialized view or refresh
job. No speculative index is added; existing report/revision and audit-parent
indexes are reused. Large production datasets still need representative plan QA.

## Security

Both views use `security_invoker = true, security_barrier = true`, supported by
PostgreSQL 17. Both explicitly gate `current_user_role()` to planner/admin.
Underlying SELECT permissions and RLS still apply. PUBLIC, anon, authenticated,
and service_role privileges on the new views are revoked before granting only
SELECT to authenticated. Site/engineer receive zero rows; anon has no view access.
Browser INSERT/UPDATE/DELETE are denied. There are no new functions, SECURITY
DEFINER objects, baseline write grants, write RPCs, or source-policy changes.

## Planner UI

The existing Schedule Actuals route shows grouped Baseline / SETU actuals headers,
explicit dates, chronological progress, evidence counts, and icon-plus-text
warnings. A bounded scrolling table keeps grouped headers visible; opening
provenance brings the panel into view. Empty activities say “No approved actuals”; unresolved approved events
say “Approved evidence; date unresolved”. No charts or edit/requeue controls exist.

Summary reads occur on entry and explicit Refresh, using 200-row response pages
to avoid API truncation. There is no timer, subscription, or workflow polling.
Provenance is queried only for the selected activity, with 100-row pages and an
extra row to determine whether another page exists. Selection, user/role, page,
and request keys suppress obsolete responses and hide old results immediately.
Refresh closes provenance and reloads the summary. Loading, errors, empty results,
and retry controls remain distinct. Selected source UUIDs remain visible even if
their rows are on another provenance page.

Views are live at each database read; the browser is intentionally not real-time.
Paged requests are separate snapshots, not an atomic export. Concurrent source
changes can require Refresh. No deployment fallback pretends migration 011 exists;
a missing view becomes a visible read error.

## Local verification

Run the exact migration in the existing disposable fixture:

```powershell
node scripts/verify_workflow_foundation.mjs C:/Users/singh/AppData/Local/Temp/setu-phase1-pglite-20261005/node_modules/@electric-sql/pglite/dist/index.js --actuals-overlay
python -B -m pytest -q -p no:cacheprovider tests/test_actuals_overlay_migration.py --basetemp=D:/SETU/.pytest_temp/phase2-static-20261010
```

The actuals verifier is exported from `scripts/verify_actuals_overlay.mjs`; the
foundation runner supplies 005–010 and invokes it. It extends only the disposable
fixture's previously minimal schedule table with baseline display columns. Real
Accept, extraction, proposal validation, and finalized Remap RPCs create positive
cases; privileged malformed/legacy rows are negative fixtures only. Verification
checks all required eligibility, selection, conflict, provenance, privilege and
role cases, including underlying permission revocation. No live database is used.
The installed PGlite runtime reports PostgreSQL 18.3; PostgreSQL 17 deployment
compatibility is documented from current PostgreSQL 17 CREATE VIEW guidance, not
misrepresented as a completed native PostgreSQL 17 execution test.

Matching, Phase 1 extraction, worker processing, validators, governance RPCs,
mapping export, migrations 005–010, landing, secrets, and stash remain unchanged.
