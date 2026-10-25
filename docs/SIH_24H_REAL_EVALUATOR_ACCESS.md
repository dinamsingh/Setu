# SETU public 48-hour evaluator workspaces

Status: **IMPLEMENTED IN DRAFT PR ONLY. NOT ACTIVE ON THE LIVE WEBSITE.**
This feature uses original SETU Supervisor and Planner pages and existing Supabase
workflows, NOT a simulated browser demo.

## One-click experience

1. Any visitor opens the original login page: https://setu-app.pages.dev/
2. Presses **SIH Evaluator Login**. Cloudflare Turnstile normally verifies in
   the background; an interactive challenge can appear for suspicious traffic.
3. The server creates a new **evaluator_workspaces.id** with a hard **48-hour**
   expiry and TWO actual Supabase Auth users linked to the same workspace:
   - Supervisor role: site
   - Planner role: planner
4. The frontend displays both generated emails/passwords in separate cards,
   with Copy and Login as buttons. Readable but strong examples:
   `supervisor-26afe3a8b8ed@setu.invalid` and `planner-26afe3a8b8ed@setu.invalid`
   (both share the same short workspace alias); passwords look like
   `SETU-XXXX-XXXX-XXXX-XXXX`, with 80 bits of independently generated randomness.
   The reserved .invalid domain is a login identifier, not a real inbox.
   Only the current browser tab stores these temporary credentials in sessionStorage.
5. Signing out of Supervisor signs out just the active Supabase session: the
   evaluator credential pair stays available in the **same tab** and appears
   automatically on the login page. Or use **Open Planner / Open Supervisor**
   in the protected header to switch without manually signing out. The login
   page has a separate confirmation-controlled **End demo & forget credentials**
   action; browser-tab closure and expiry clear or invalidate access.
6. As Supervisor, import a fictional CSV/XLSX field report and run available
   workflows. As Planner, review those reports, validations and audit/export.
   The SETU header can switch between the two actual authenticated accounts.
7. If another visitor clicks, they get a **different workspace ID** and cannot
   see the first visitor's reports or audit history, even if IDs are guessed.
   Original Planner accounts also cannot see or modify evaluator reports.

### Isolation model

The linking key is **workspace_id on evaluator_accounts**, not matching display
email addresses. Each CSV import records submitted_by_user_id of the generated
Supervisor. A restrictive SELECT policy on field_updates looks up that submitter
in evaluator_accounts and returns rows only to an unexpired account from the
same workspace. Related audit, clarifications, remap proposals and progress
events are restricted by the same report access predicate.

All existing planner RPCs that modify reports may bypass RLS (SECURITY DEFINER),
so BEFORE triggers check the actor's workspace for writes, including
non-evaluator -> evaluator attempts and cross-workspace attempts. Reference
schedule activities and the global aliases dictionary remain shared read-only
to evaluator accounts (not per-workspace data).

This does **not** provide separate databases; trusted service-role workers can
process all reports in order to run the real matching/evaluation pipeline.

## Abuse limits

Public signup must NEVER directly expose auth.admin.createUser. The
\`create-evaluator-workspace\` Edge Function is the only entrypoint.

- **Mandatory Cloudflare Turnstile verification** via Siteverify, with
  hostname/action checks. This protects against automated repeated clicks.
- PostgreSQL atomic creation limits: **2 groups per IP per hour, 5 per IP in
  24 hours, and 40 groups total over a rolling 24 hours**.
- IP digest stored using a secret pepper; raw IP is not persisted.
- Reservation and both Auth users must succeed before credentials are returned.
- A partial provisioning failure attempts to delete temporary users.
- Server-side expiry denies role, report and schedule access even for a cached
  JWT. Background Auth account cleanup is a separate maintenance action.

The global cap is deliberate: a bot cannot mint unlimited temporary accounts.
This is a prototype-size deployment. The cap may reject legitimate extra
visitors when already reached.

## Required deployment configuration

1. Create a Cloudflare Turnstile **Managed** widget for:
   \`setu-app.pages.dev\` and the applicable preview hostnames.
   Its action is \`setu_evaluator\`.
2. Add **frontend Cloudflare Pages build variable**:
   \`VITE_EVALUATOR_TURNSTILE_SITE_KEY\` = widget's **public sitekey**.
3. Add **server-only Supabase Edge Function secrets**:
   - \`EVALUATOR_TURNSTILE_SECRET\`: the private Turnstile secret.
   - \`EVALUATOR_RATE_LIMIT_PEPPER\`: a unique 32+ character secret.
   - \`SUPABASE_URL\` and \`SUPABASE_SERVICE_ROLE_KEY\` are supplied only in the
     Edge Function runtime, **never** to the Vite frontend.
4. Run native PG17 CI with the actual migration and user/role isolation tests;
   check frontend tests and Deno type-check; review all privileged RPCs.
5. Before any production SQL change, validate a **restorable database backup**.
   Migration 016 changes shared role resolution, RLS policies and triggers; a
   failed rollout could affect original SETU users.
6. Apply \`database/migrations/016_evaluator_48_hour_access.sql\` through an
   authorized, audited migration after security review.
7. Deploy \`supabase/functions/create-evaluator-workspace/index.ts\` with
   \`verify_jwt=false\` (public request authorized by Turnstile + DB quota).
8. Merge/deploy frontend only after steps 1-7 are verified. On the original
   login page test new group A and group B in separate browsers:
   - each receives a fresh Supervisor/Planner credential pair;
   - A's Supervisor import appears only to A's Planner;
   - B's pair does not see A's records and vice versa;
   - original Planner does not see test reports;
   - after 48 hours expired accounts lose backend access;
   - normal production Supervisor/Planner logins still work.

## Limitations

- Manual/voice supervisor submission is still gated on Migration 014; a public
  demo account cannot bypass that feature gate. CSV/XLSX import is available.
- Validations can produce BLOCK outcomes for intentionally impossible dates.
- Two accounts share one workspace ID, but they are **two Supabase Auth sessions**;
  logging in as the other account signs out/replaces the first session in the
  same tab. Both original workspaces work in separate browsers.
- The real AI worker's successful execution must be verified on a submitted
  report, not inferred solely from account generation or TypeScript tests.
- Treat generated passwords as secrets. The user can copy them but should not
  publish them in the PPT or source code.
- A green CI test against synthetic PostgreSQL fixture does not prove production
  migration safety or that an external signup request was successfully handled.
- Preview includes UI while the production DB/Edge endpoint and Turnstile keys
  remain intentionally unconfigured. Thus clicking the button there currently
  yields a setup error rather than credentials.

**Do not release this publicly until all deployment prerequisites pass.**
