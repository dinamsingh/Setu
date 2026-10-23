# SETU public evaluator landing page

## Current release status (23 October 2026)

[PR #19](https://github.com/dinamsingh/Setu/pull/19) was merged into `main` at commit `412b849`. GitHub reports successful Cloudflare Pages checks for the submitted [landing page](https://setu-1so.pages.dev/) and the separate authenticated application. The submitting team confirmed the published six-step walkthrough works. The PPT's link to [`#prototype`](https://setu-1so.pages.dev/#prototype) points to a section with a direct link to the no-login demo at [`#product`](https://setu-1so.pages.dev/#product).

The **public demo** is a read-only synthetic illustration. It is intentionally distinct from the authenticated application's production feature set; this README does not reclassify or remove any feature described in the PPT. Authenticated end-to-end operations require separate verification.

The deployed entry point is **static `index.html`**, with `assets/evaluator-demo.js` and local images. `src/` contains earlier React components and is not used by `npm run build`. No environment variables, credentials, model downloads or database access are required by the public demo.

## Local preview and verification

```sh
cd landing
npm ci
npm run build
npm run serve:demo
# http://127.0.0.1:4178/#product
```

Stop the preview before `npm test`, which starts its own server on port 4178.

```sh
npm run lint
npm test
```

Tests use installed Google Chrome with a fresh isolated context per test, desktop and mobile viewports, and axe WCAG A/AA scans. Install Google Chrome from its official distribution if unavailable. Test reports go to ignored `test-results/`; review screenshots go to `docs/evaluator-screenshots/`.

## Source and deployment provenance

Original pre-merge source/deployment verification from 23 October 2026 (preserved for provenance):

- Submitted URL: https://setu-1so.pages.dev/
- Repository: https://github.com/dinamsingh/Setu, directory `landing/`.
- Public HTML matched `origin/main` commit `120b5e7e991530bcf27d1dc63a7778796cb22bf4` after newline normalization. The latest landing change was `c18bf0b`.
- Public commit checks for `c18bf0b` include successful **Cloudflare Pages: setu** and **Cloudflare Pages: setu-app** checks. These are separate Pages projects sharing the repository.
- Build entry point: `node build.js`, copies `index.html`, `_headers`, `assets/`, then `public/` into `dist/`. Duplicate `public/_headers` must stay synchronized with `_headers`.
- Documented Pages settings: root `landing`, command `npm run build`, output `dist`. Dashboard settings and production branch configuration were not directly inspected. There is no repository Pages deploy workflow; `.github/workflows/phase5-verification.yml` runs application checks.
- The authenticated prototype's public shell returned HTTP 200 at https://setu-app.pages.dev/. Authenticated/backend behavior was not tested.

Historical context: the evaluator demo branch used the commit prefix `[CF-Pages-Skip]` to suppress automatic Pages builds, per [Cloudflare documentation](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/). PR #19 was subsequently merged and the submitted public walkthrough was checked by the submitting team, as noted above. Do not infer authenticated application readiness from that public check.

## Reproducible demo data and boundary

The embedded `landing-samples` JSON contains the first three synthetic examples already published by the landing page. Text and candidate scores come from `data/matching_results.json`; schedule context comes from synthetic schedule fixtures. No protected records or `local_supabase_mock.json` are used. Interpretation, findings, decisions and `DEMO-*` audit identifiers are authored illustrations, not current engine outputs.

All three examples have evidence problems. Two illustrate clarification; the NDT example rejects an unsupported link. The resulting schedule stays unchanged and no approved export row is invented. The public experience cannot submit reports or make planner decisions. CSP blocks network connections and forms; tests verify no backend requests, storage or cookies. Supabase, migrations, accounts and real reports are outside this change.
