# SETU evaluator guide

SETU links unstructured site observations to read-only Primavera P6 schedule activities. Matching suggests a connection; validation exposes uncertainty; a human planner owns the decision. The public demonstration requires no account and takes about three minutes.

## Open the walkthrough

On the submitted landing page, select **Explore SETU Demo**. Use **Next**, **Back**, stage buttons and **Restart**. The indicator shows the current stage out of six. Choose another example to restart with different evidence.

**Release status (23 October 2026):** [PR #19](https://github.com/dinamsingh/Setu/pull/19) has been merged into `main` at `412b849`, and both Cloudflare Pages deployment checks completed successfully. The six-stage demo is published at [the submitted SETU landing page](https://setu-1so.pages.dev/#product); its walkthrough has also been manually checked by the submitting team. The already-submitted PPT's page-5 link targets [`#prototype`](https://setu-1so.pages.dev/#prototype), where **Explore SETU Demo · No Login** leads to this same walkthrough. The PPT was not modified as part of this documentation update.

**Scope note:** This guide describes the public, read-only evaluator sample, not the full set of features described in the PPT or available through the authenticated SETU application. The public sample deliberately performs no backend operations. This clarification does not withdraw, remove, or reclassify any application feature; authenticated deployment capabilities must be verified on their own terms.

## Six-step text walkthrough: Spool fit-up

1. **Supervisor observation.** Synthetic report `UPD-2026-001`: “Spool erection and field fit-up successfully finished at Manifold A today.” Fixture date: 16 April 2026; location: Duliajan Manifold Area A. `DEMO-EVIDENCE-001` refers only to that text. No photo, identity, geolocation or completion certificate is verified.
2. **Interpretation.** Work: spool erection and field fit-up. Progress: reported completion. Location: Manifold A. “Today” uses the report date. Quantity and attachment are absent. This is an authored illustration, not a live model extraction.
3. **Matching.** Stored candidates: `OIL-PIP-202-A` 0.8354, `OIL-PIP-202-D` 0.8348, `OIL-PIP-202-B` 0.8323. Leading activity: “Piping Spool Erection and Field Fit-up - Manifold A”, WBS 1.2.2.1. Similar words and close scores do not prove the physical asset. Scores are historical synthetic ranking values, not probabilities.
4. **Validation.** Leading activity starts 22 May 2026 and finishes 20 June 2026. The observation claims completion before planned start. Date and ambiguity need investigation. Duplicate history, reporter authorization and predecessor completion are unavailable in the example and are not marked as passing. Findings illustrate reasoning; they are not live validator results.
5. **Planner review.** Fictional planner requests clarification of date, asset and supporting evidence. A near tie and early completion claim do not justify acceptance. Remap also needs a defensible alternative and validation. This is a predetermined sample decision; the evaluator cannot approve a real report.
6. **Audit and result.** Sample `DEMO-AUDIT-001`, fictional role Example Planner, fixed authored time `2026-04-20T10:00:00Z`, links observation → evidence → candidate → decision and reason. Result: on hold; no approved export row. Baseline dates stay 22 May to 20 June. No actual dates or percent complete are asserted. This audit was never saved to a database.

The ROW example illustrates a second date conflict. The NDT example rejects a suggested Line D link because Section B KP 16–30 does not identify Line D; claimed test completion also does not prove test acceptance. All examples retain uncertainty.

## Evidence map

| Claim | Repository evidence |
|---|---|
| Domain aliases and hybrid ranking | [alias_expander.py](../engine/alias_expander.py), [ensemble_matcher.py](../engine/ensemble_matcher.py) |
| Semantic embeddings | [embeddings.py](../engine/embeddings.py) |
| Validation checks | [validators.py](../engine/validators.py) |
| Planner workflow | [ReviewQueue.tsx](../frontend/src/pages/planner/ReviewQueue.tsx) |
| Audit and approved export | [AuditExport.tsx](../frontend/src/pages/planner/AuditExport.tsx) |
| Historical synthetic calibration | [BENCHMARK.md](BENCHMARK.md), [matching_results.json](../data/matching_results.json) |
| Public landing source, build and tests | [landing/README.md](../landing/README.md) |

## Live application and limits

[Authenticated SETU prototype](https://setu-app.pages.dev/) requires sign-in and an assigned role. It is separate from the public evaluator demo. Credentials are not supplied; evaluation of the public example does not require this application. Its public shell is reachable, but that does not verify authenticated operations, backend health or deployed migrations.

The repository implements Supabase Auth, RLS and role-aware workflows. This change neither bypasses nor modifies them. No production database, protected API, account, field report or migration is changed.

Designed for oil and gas construction review against imported schedules. Real use needs project terminology, reliable evidence and human review. No OIL operational pilot, production accuracy, live P6 write-back or autonomous approval is claimed. The historical 40-report / 220-activity benchmark describes synthetic fixtures, not production users or throughput.
