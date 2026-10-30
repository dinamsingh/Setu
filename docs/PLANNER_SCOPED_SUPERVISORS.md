# Planner-scoped supervisors

## The model, in one paragraph

A schedule upload is a **baseline**, owned by the planner who uploaded it.
A planner **assigns supervisors to a baseline**, and a supervisor sees,
reports against, and is matched against **only** the baselines they are
assigned to. There is no longer a single global schedule that every user
sees. The old 220 activities are not deleted and are not a live project:
they become the labelled **Sample Baseline** — demo and training data only.

## What the old 220 is now used for

The live `schedule_activities` count is 220 and its IDs match
`data/synthetic_p6_schedule.csv` exactly, so the old 220 is synthetic
sample data, not original company data. Its best use is:

- **Training and evaluator demos.** A new planner or evaluator can see how
  matching, validation, review and audit work against a realistic schedule
  without touching any live project.
- **Format checking.** The Schedule Onboarding page validates a local CSV
  against the sample structure before any real import is attempted.
- **Nothing else.** It must never be presented as a live project baseline,
  and no live report should be judged against it as if it were a real job.

Migration 017 backfills all 220 existing activities to the Sample Baseline
and labels them as such in the UI. No activity row is deleted.

## How a planner adds a supervisor

1. On the planner dashboard, open **Supervisors**.
2. Enter the supervisor's name and work email, and pick a baseline:
   the Sample Baseline (labelled demo) or one of the planner's own baselines.
3. Press **Create supervisor**. The planner's browser calls the
   `create-planner-supervisor` Edge Function with the planner's own JWT.
4. The Edge Function — and only the Edge Function — verifies the caller is
   a planner or admin, verifies the baseline is owned by the caller or is
   the Sample Baseline, generates a strong password server-side, creates
   the Auth user, inserts `user_roles` (`site`) and inserts the assignment.
5. The planner sees the email and generated password **once**, with Copy
   buttons, and a warning to share it securely. The password is never
   stored in the database, never written to git, and never shown again.
   The assignment list afterwards shows the supervisor assignment, not
   the password.

If the supervisor's work email is already registered, creation fails with
a clear "already registered" error and no account or assignment is created.

## The same scoped model for evaluators

Evaluator accounts use exactly the same tables and policies. An evaluator
planner and evaluator supervisor share an evaluator workspace, but for
schedule reads they may see **only the Sample Baseline** — never another
planner's baseline. Evaluator supervisors therefore demo the same
Supervisor → Planner review flow, against sample data, in an isolated
workspace, without seeing or polluting any live project.

## What is NOT live yet (read before testing on production)

This branch alone changes **nothing** live. These steps are still needed,
in this order, and are deliberately not done by the branch:

1. **Backup first.** Validate a restorable Supabase database backup.
   Migration 017 changes RLS policies, including replacing the old global
   `schedule_authenticated_read` policy on `schedule_activities` with
   scoped policies. A failed or partial apply could lock planners and
   supervisors out of schedule reads until it is fixed.
2. **Apply Migration 017** through an authorized, audited route. It
   creates two tables, adds one column, backfills that column to the
   Sample Baseline, and replaces the schedule read policies. It deletes
   no rows and no tables.
3. **Deploy `supabase/functions/create-planner-supervisor`** with
   `verify_jwt = true` and the server-only `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` environment values. The service_role key
   must never appear in frontend code, in git history, or in a screenshot.
4. **Merge this branch, then deploy.** Only then will **Supervisors** on
   the planner dashboard create real accounts. On a preview without steps
   1–3, pressing Create supervisor will show a setup error — that is the
   expected, safe failure, not a bug to work around by putting a key in
   the frontend.
5. **Follow-up work, not in this branch:** the matching worker must filter
   candidates by the report submitter's assigned baseline. The scoped
   read policies in this migration are the UI access boundary; until the
   worker is scoped, do not claim matching itself is fully scoped.
   Likewise, a real planner schedule-upload (import) flow is still
   preview-only on the Onboarding page; new scoped baselines are created
   by an admin import until that flow exists.

## Rollback

Drop only the new policies and the two new tables, in reverse order.
Never drop `schedule_activities`, never delete its rows, and never drop
the `baseline_id` column or the Sample Baseline row — they are metadata
only and keep the backfill intact. Restoring the old global read policy
is a separate, reviewed decision, not an automatic side effect of
reverting this file.
