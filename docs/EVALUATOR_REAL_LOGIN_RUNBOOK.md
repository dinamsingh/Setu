# SETU — SIH authenticated evaluator readiness gate

**Last checked:** 23 October 2026. This checklist is about **real application login**, not the already-working credential-free six-stage synthetic landing walkthrough. No existing application or PPT capability is being removed or reclassified.

## Verified baseline (read-only)

- Real app: https://setu-app.pages.dev/ — Supabase-authenticated and role-protected.
- Existing database has accounts in `site`, `engineer`, `planner` and `admin` roles; the team **reported successful Supervisor and Planner login and dashboard navigation in separate browsers** on 23 October 2026. This is user-reported browser evidence, not a captured independent browser QA session.
- `public.import_field_reports(uuid,text,jsonb)` exists; availability does not by itself prove full browser import success.
- **Blocker:** Migration 014 is not recorded in the production migration list; `public.submit_supervisor_field_update` and `public.supervisor_submission_receipts` are absent. The frontend safe-submission release gate is deliberately **off**.
- **Isolated PostgreSQL 17 is verified:** GitHub Actions on PR #21 executed **24/24 live SQL behavioral tests**, including real Migration 013 and 014, concurrent replay, role denials and CSV/XLSX import. Full CI also passed **436 frontend and 397 Python tests (1 skipped)**. The synthetic Auth schema does **not** replace testing against hosted Supabase Auth.
- **Read-only live production preflight:** `database/preflight/014_production_readonly.sql` returned **13/13 PASS** on 23 October 2026; existing triggers, report columns, RLS and import RPC are compatible at the metadata level.
- **Remaining blocking prerequisite:** there is **no verified private, restorable production database backup**. The Supabase organization is on **Free** plan and this connected Supabase integration does not offer a database backup/export or restore-test action.
- An older committed demo seed file contained predictable credentials. Removing those strings from HEAD cannot erase repository history or rotate existing accounts.

## Release plan (in order, stop on failed checks)

1. **Secure current accounts.** In Supabase Authentication > Users, revoke/rotate the passwords and sessions of any users previously created using repository demo credentials. Do **not** publish credentials or login links containing access tokens. Verify sign-in again after rotation.
2. **Protect recovery.** Before production schema changes, capture a private, restorable database export and verify a restore on a separate non-production PostgreSQL instance. Confirm where Auth and Storage recovery data will be maintained. Supabase Free does not provide downloadable managed backups as a substitute. Keep exports private.
3. **Prepare evaluator identities only after checking data scope.** Existing production RLS policy `field_planner_admin_select_all` allows a Planner account to read **all** `field_updates`, not just a synthetic evaluation subset; `schedule_authenticated_read` gives all authenticated roles baseline schedule visibility. **Do not give external evaluators temporary accounts on this shared production instance unless the entire visible dataset has been verified safe for their access.** If it contains restricted or non-synthetic data, use an isolated evaluator deployment with synthetic-only data and rechecked RLS instead. Where appropriate, create distinct Site/Engineer and Planner users through Supabase Auth administration, not by inserting into `auth.users`. The role-only `database/seed_demo_users.sql` requires existing Auth users, local placeholder replacement and authorization. Never give evaluators `admin` or `service_role`.
4. **Exercise logins in an isolated test setup.** Sign in as Site, verify Supervisor home and existing reports; sign out. Sign in as Planner, inspect read-only baseline, review queue, audit and approved-mapping CSV export. Verify role isolation: Site cannot visit Planner pages, Planner cannot visit Supervisor pages, anonymous cannot access either.
5. **Isolated PostgreSQL 17 runtime checks — PASS (24/24).** Migration 013 → 014, Site/Engineer submissions, valid defaults, idempotency, unauthorized roles, direct INSERT revocation, CSV/XLSX import and concurrent replay passed. CI's synthetic Auth/RLS fixture is **not** a cloned production database: hosted Auth, full report-processing workers, audit/worker workflows and live end-to-end browser behavior still require separate verification.
6. **Controlled production rollout only after gates pass.** Secure a reversible production deployment window, apply the reviewed migration with operator approval, verify deployed schema and access, deploy frontend with `migration014Verified` and `submissionEnabled` updated only after backend proof, and test a synthetic report all the way through matching/validation → Planner review → governed export. Do not auto-write to a Primavera P6 baseline.
7. **Deliver evaluator access safely.** Use an authorized SIH submission or organizer-provided private channel to deliver temporary credentials/instructions. If no private channel exists, do **not** expose a common username/password on the public landing page: the verified, read-only no-login walkthrough remains the guaranteed public evaluation path. Revoke evaluator sessions after the round.

## Required production release gate (do not bypass)

- **Verified recovery:** a private, complete database export and an independently completed restore rehearsal must exist before Migration 014 is applied. The connector used for these read-only checks has **no verified backup creation capability**, so no backup is claimed. Confirm Auth/Storage recovery separately.
- **Access classification:** decide whether every report and schedule available to Planner is permissible for external evaluators; if not, do not use a production Planner account for external review.
- **Migration approval:** only after the two gates above, review PR #21 and schedule the migration. Apply under explicit operator supervision and verify existing import, authentication, current submissions and role checks **before** changing the frontend release gate. If any assertion fails, leave submission disabled.
- **No Docker on the user's PC is needed for CI:** PR #21 has native PostgreSQL 17 testing on GitHub Actions. That synthetic CI database is **not a backup of production** and cannot restore the Supabase project.

## Short acceptance sheet (mark each with real evidence, not assumption)

| Evaluator action | Current readiness |
| --- | --- |
| Visit https://setu-1so.pages.dev/#product and inspect six-stage synthetic example | Verified by submitting team |
| Open live login | User reports success for Supervisor and Planner in separate browsers |
| Sign in as restricted Site/Engineer account | User reports Supervisor sign-in success; temporary evaluator credentials/data scope unverified |
| Enter a **new** manual Supervisor report | **Blocked** until tested Migration 014 and release-gate rollout |
| Upload CSV/XLSX under Site role | Import backend RPC present; actual UI + role test required |
| Sign in as Planner and inspect schedule/review/audit | User reports dashboard/page navigation works; new-report end-to-end not proven |
| Planner decides on new report then downloads mapping CSV | Live end-to-end check required |
| Sign out and verify anonymous/other-role denials | Live security test required |

**Hard stop:** No live Supabase migration, test data insertion, account/password change, P6 writeback or public credential publication may be assumed completed from this document. Do not promote the real app as fully verified until each relevant acceptance test is executed.
