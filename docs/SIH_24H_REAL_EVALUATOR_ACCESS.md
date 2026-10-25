# SETU: private one-click, 48-hour, REAL evaluator access

Status: **proposed / gated — do not present as production-live until the migration,
Supabase Edge Function, frontend release, and independent security checks pass.**

## Evaluator experience (original SETU login page)

1. SETU team privately sends the invitation link:
   `https://setu-app.pages.dev/#invite=<single-use-random-secret>`.
2. Evaluator opens the **original SETU login page**, clicks **SIH Evaluator Login**.
   No signup, form-filling or password required to *generate* accounts.
3. A real Supabase Edge Function atomically consumes that invite and generates **two
   fresh email/password credential pairs**, shown on the login page: **Supervisor**
   and **Planner**. The private link cannot be redeemed twice.
4. Both credentials expire exactly **48 hours from redemption** at the PostgreSQL
   authorization boundary. Reviewer can click **Login as Supervisor** or
   **Login as Planner** directly, or copy/email/password into the unchanged sign-in form.
5. The original authenticated SETU Supervisor and Planner screens are used.
   Header also offers **Open Planner / Open Supervisor** for quick role switching
   within the same browser tab.
6. Evaluator can import clearly labelled **SIH EVALUATOR DEMO ONLY** CSV reports,
   inspect actual matching/validation results, planner review and export.
   Manual/voice submission remains release-gated until Migration 014.
7. The **SIH Evaluator Login** button is visible without a private invitation,
   but **does not issue accounts** without a valid high-entropy bearer link.
   It explains how the evaluator can obtain the private link.

## Security

- Private invitation is a **bearer credential**, single use, with 256-bit randomness.
  Link is placed in the URL **fragment** to avoid CDN request logs; frontend removes it
  promptly. No secret in source code or public PR.
- An invitation can be redeemed within **14 days**, and grants **48 hours from first use**.
  The token is stored as SHA-256 only; concurrent redemptions allow a single winner.
- The Edge Function is public solely for redemption. It holds the service-role key **server-side**;
  it will never return that key. It accepts requests only from official SETU Cloudflare origins.
- New Auth users have random passwords, confirmed non-deliverable `.invalid` addresses,
  and explicit `site`/`planner` role records. Credentials are held **only in sessionStorage**
  in the active evaluator browser tab to support one-click role switching.
- Expired evaluator roles resolve to NULL server-side and public RLS restricts schedule,
  roles, aliases, field reports and audit.
- Restrictive RLS hides all historical `field_updates`, downstream workflow rows and
  audit from evaluators except reports submitted by the same invitation's accounts.
- BEFORE triggers deny evaluator edits to other users' reports even when existing
  `SECURITY DEFINER` RPCs bypass RLS. Audit/workflow writes are likewise scoped.
  Global schedule and aliases cannot be changed by evaluator accounts.
- Existing named accounts keep their original role and RLS permissions.
- Scope limitations: Access is intentionally **real production API traffic** to a
  private synthetic-only slice; there is no live P6 writeback and the matching
  worker must be independently verified. An approved workflow decision is a DB write.

## Release gates (do in order)

1. Run CI: frontend TypeScript/Vitest/build and native PG17 migration/security tests.
   Inspect security warnings and adversarial RPC tests.
2. Verify a **restorable** production database backup, schema version and supported
   restore procedure. Migration changes the global `current_user_role()` resolver and
   introduces security triggers; do NOT apply blind/without backup.
3. Review role/RLS coverage, especially new SQL SECURITY DEFINER functions and
   all existing planner RPCs. Manually verify that existing supervisor and planner
   logins and reports continue working.
4. Apply `database/migrations/016_evaluator_48_hour_access.sql` using reviewed
   migration process. Verify migration in the live database.
5. Deploy `supabase/functions/redeem-evaluator-invite/index.ts` with
   `verify_jwt=false` (invitation token is authorization) and the default server-only
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` environment variables.
   Never use service-role keys in browser env.
6. Merge and deploy the frontend only when 4 and 5 are confirmed.
7. Using the Supabase SQL editor **as the project owner**, mint one invitation:

   ```sql
   SELECT public.issue_evaluator_invite();
   ```

   Send the URL privately, not in GitHub, logs, screenshots or a public PPT.
8. Validate as a fresh external evaluator: redeem once, Supervisor import a fictional
   CSV, let existing worker process it, Planner review/validation and audit/export,
   switch back, verify the same original UI. The worker cannot be assumed to have
   processed anything unless a report shows updated results.
9. Expiry test: use an isolated fresh invitation/account, advance expiration in
   nonproduction PG17 tests and verify new reads/decisions are denied.
10. Post-event revoke or delete temporary evaluator Auth users using admin controls.
    Database expiry already revokes app-data access at 48 hours; Auth user deletion
    cleans up persistent credentials and sessions.

## Recovery

- A consumed link cannot be retried after backend user provisioning fails; issue a
  new link. Failed Edge Function provisioning attempts delete partial users.
- No direct access to underlying production database is granted by the link.
- Closing the browser tab discards temporary credential pair, so another link is
  needed on a new device/tab.
- Original SETU email/password login stays unchanged.
- PR #21 / Migration 014 remains independent and **must not** be silently deployed
  just to make evaluator manual/voice submission work.

## Technical dependencies

- Existing SETU Supabase Auth, RLS, JWT role guard and Import 013.
- Supabase Edge Functions with server-side service role secrets and disabled automatic
  JWT verification on **this one redemption endpoint only**.
- PostgreSQL 17 for isolated native CI (no Docker).

**Do not merge or deploy based solely on a green frontend build.**
