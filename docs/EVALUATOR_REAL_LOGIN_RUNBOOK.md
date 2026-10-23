# SETU — SIH authenticated evaluator readiness gate

**Last checked:** 23 October 2026. This checklist is about **real application login**, not the already-working credential-free six-stage synthetic landing walkthrough. No existing application or PPT capability is being removed or reclassified.

## Verified baseline (read-only)

- Real app: https://setu-app.pages.dev/ — Supabase-authenticated and role-protected.
- Existing database has accounts in `site`, `engineer`, `planner` and `admin` roles; their login passwords and functional sessions have **not** been verified.
- `public.import_field_reports(uuid,text,jsonb)` exists; availability does not by itself prove full browser import success.
- **Blocker:** Migration 014 is not recorded in the production migration list; `public.submit_supervisor_field_update` and `public.supervisor_submission_receipts` are absent. The frontend safe-submission release gate is deliberately **off**.
- There is no verified independent test database or restorable database backup. The Supabase organization reports **Free** plan.
- An older committed demo seed file contained predictable credentials. Removing those strings from HEAD cannot erase repository history or rotate existing accounts.

## Release plan (in order, stop on failed checks)

1. **Secure current accounts.** In Supabase Authentication > Users, revoke/rotate the passwords and sessions of any users previously created using repository demo credentials. Do **not** publish credentials or login links containing access tokens. Verify sign-in again after rotation.
2. **Protect recovery.** Before production schema changes, capture a private, restorable database export and verify a restore on a separate non-production PostgreSQL instance. Confirm where Auth and Storage recovery data will be maintained. Supabase Free does not provide downloadable managed backups as a substitute. Keep exports private.
3. **Prepare limited evaluator identities.** Create **separate**, temporary Site/Engineer and Planner users through Supabase Auth administration, with strong unique passwords; do not directly insert password hashes into `auth.users`. Assign their roles using reviewed administrator-only SQL or the role-only `database/seed_demo_users.sql` helper after replacing its placeholders **locally**, not in a commit. Give access only to **synthetic, non-sensitive** test data and the corresponding project scope. Do not grant `admin` or `service_role` to evaluators.
4. **Exercise logins in an isolated test setup.** Sign in as Site, verify Supervisor home and existing reports; sign out. Sign in as Planner, inspect read-only baseline, review queue, audit and approved-mapping CSV export. Verify role isolation: Site cannot visit Planner pages, Planner cannot visit Supervisor pages, anonymous cannot access either.
5. **Test Migration 014 against isolated PostgreSQL.** Run `database/migrations/014_supervisor_safe_submission.sql` and verify (a) legitimate Site/Engineer manual submission succeeds once, (b) identical idempotency replay does not create a second report, (c) missing/invalid fields are rejected, (d) Planner and anonymous RPC submissions are denied, (e) direct client INSERT is blocked irrespective of source type, (f) existing authorized CSV/XLSX import RPC still succeeds, (g) audit/RLS/worker behavior is unchanged. An automated static CI test is **not** a replacement for these runtime checks.
6. **Controlled production rollout only after gates pass.** Secure a reversible production deployment window, apply the reviewed migration with operator approval, verify deployed schema and access, deploy frontend with `migration014Verified` and `submissionEnabled` updated only after backend proof, and test a synthetic report all the way through matching/validation → Planner review → governed export. Do not auto-write to a Primavera P6 baseline.
7. **Deliver evaluator access safely.** Use an authorized SIH submission or organizer-provided private channel to deliver temporary credentials/instructions. If no private channel exists, do **not** expose a common username/password on the public landing page: the verified, read-only no-login walkthrough remains the guaranteed public evaluation path. Revoke evaluator sessions after the round.

## Short acceptance sheet (mark each with real evidence, not assumption)

| Evaluator action | Current readiness |
| --- | --- |
| Visit https://setu-1so.pages.dev/#product and inspect six-stage synthetic example | Verified by submitting team |
| Open live login | Login UI implemented, actual sign-in not tested here |
| Sign in as restricted Site/Engineer account | Account/role records exist; login/session test required |
| Enter a **new** manual Supervisor report | **Blocked** until tested Migration 014 and release-gate rollout |
| Upload CSV/XLSX under Site role | Import backend RPC present; actual UI + role test required |
| Sign in as Planner and inspect schedule/review/audit | Implemented; authenticated live verification required |
| Planner decides on new report then downloads mapping CSV | Live end-to-end check required |
| Sign out and verify anonymous/other-role denials | Live security test required |

**Hard stop:** No live Supabase migration, test data insertion, account/password change, P6 writeback or public credential publication may be assumed completed from this document. Do not promote the real app as fully verified until each relevant acceptance test is executed.
