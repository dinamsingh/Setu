# Credential-free interactive evaluator demo — PR review notes

## Target

The evaluator opens the SETU login page, clicks **Enter Interactive Demo · No Login**, and can interactively try Supervisor capture, CSV/XLSX upload preview and import, role switching, Planner queue, three-way decisions (approve / reject / remap), justified override, synthetic schedule viewing, audit trail and approved mapping CSV export.

## Security model

- `/demo` deliberately renders **outside** `AuthProvider`; the route does not load production sessions or invoke authenticated RPCs.
- The demo has **no authentication/account** and **no database-backed writes**. It uses local React state only and resets on refresh/restart. This is not a bypass of production role checks.
- The demo uses `parseFieldReportFile`, the actual client-side CSV/XLSX input parser, but **illustrative scoring and validation**. No claims are made about executing the live matching worker or Supabase RLS.
- Demo data is synthetic. Role switching is unrestricted **only in the demo**.
- Real production Supabase, migrations, release gates, and accounts remain untouched.
- Reviewer must not market the sandbox as production Auth or AI runtime verification.

## Interactive evaluator walkthrough

1. Go to **Login → Enter Interactive Demo · No Login**.
2. As Supervisor, **Submit to demo review queue** with a test note; a new `DEMO-###` appears.
3. Optionally test **CSV/XLSX Import**: use the existing intake format with `field_text` and `reported_date` plus optional `site_location,reported_by,discipline`.
4. Click **Planner** persona; inspect pending reports and sample match candidates / validation findings.
5. Approve the valid synthetic sample. For the deliberately blocked sample, first examine the date warning; a justified override is required before approval.
6. Try **Validate & remap** or **Reject** on another test report with an explanation.
7. Open **Schedule** and **Audit & Export**; download a demonstration CSV containing only finalized, synthetic mappings.
8. Click **Restart demo**. None of the demonstration changes are persisted.

## Acceptance gates before publication

- The existing password-based Supervisor and Planner login remains unchanged.
- `/demo` loads without credentials and without production network requests.
- Every demo action is locally scoped and clearly labeled simulated.
- Standard Python and frontend CI remains green. Add browser tests for actual UI and accessibility before merging.
- Present a **separate test of live backend functionality** (existing CSV import and logged-in review) if evaluators require actual authorization rather than interactive simulation.

## Current limitation

This is not a real pre-seeded Supabase demo account with isolated persistence. To achieve a no-password but *backend-connected* experience, deploy a **separate dedicated synthetic-data Supabase demo project**, review all RLS and worker privileges, then use managed anonymous auth or server-issued short-lived sessions. Enabling anonymous auth in shared production is **not safe** here because existing `authenticated` policies could reveal schedule and other shared data. Do not auto-enable it.
