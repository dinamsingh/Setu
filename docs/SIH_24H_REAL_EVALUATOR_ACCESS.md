# SETU: private one-click, 24-hour, REAL evaluator access

Status: **proposed / gated — do not present as production-live until the migration,
Supabase Edge Function, frontend release, and independent security checks pass.**

## Evaluator experience

1. SETU team privately sends one high-entropy invitation URL: `https://setu-app.pages.dev/evaluator#invite=...`.
2. Evaluator opens it and clicks **Start 24-Hour Evaluation** (no signup, email or password entry).
3. Backend atomically consumes that invitation and provisions **two real Supabase Auth users**:
   one `site` Supervisor and one `planner`. The site user signs in automatically.
4. The original authenticated SETU Supervisor and Planner dashboards are used.
   The SETU header offers **Open Planner / Open Supervisor** (real Supabase session switch).
5. Access is automatically restricted by PostgreSQL authorization 24 hours after
   invitation redemption, including for an existing cached JWT.
6. Evaluator must label imported text **SIH EVALUATOR DEMO ONLY** and use fictional data.
   The original manual/voice submission feature remains release-gated until Migration 014.

## Security

- Private invitation is a **bearer credential**, single use, with 256-bit randomness.
  Link is placed in the URL **fragment** to avoid CDN request logs; frontend removes it
  promptly. No secret in source code or public PR.
- An invitation can be redeemed within **14 days**, and grants **24 hours from first use**.
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
4. Apply `database/migrations/016_evaluator_24_hour_access.sql` using reviewed
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
    Database expiry already revokes app-data access at 24 hours; Auth user deletion
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
