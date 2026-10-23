# Evaluator demonstration verification — 23 October 2026

Status: local independent walkthrough passes the automated checks below. **The submitted live URL is not yet evaluator-ready for this change:** it has not been deployed, the PPT was unavailable, and the final published artifact must be checked after approved deployment.

Repository: `dinamsingh/Setu`. Branch: `feat/sih-evaluator-demo`, based on `120b5e7`. Worktree: `D:\SETU\.worktrees\sih-evaluator`. Existing staged/unstaged work in `D:\SETU` was preserved. Scope: public landing, evaluator documentation, test fixtures and screenshots only.

## Source and deployment verification

The submitted page returned HTTP 200. Its HTML matched `landing/index.html` on base commit `120b5e7` after newline normalization. `c18bf0b`, the latest landing change, has successful public check runs for separate Cloudflare Pages projects `setu` and `setu-app`. The repository's static `landing/build.js` creates `landing/dist`. README deployment settings specify root `landing`, build `npm run build`, output `dist`. Cloudflare dashboard settings were not inspected.

No merge or deploy was performed. Feature commits use `[CF-Pages-Skip]` to suppress Pages deployment. [Cloudflare documents this prefix](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/). Merge/deployment needs explicit approval and subsequent fresh-browser acceptance checks at the submitted URL.

## Results

- `npm run build`: passed; static HTML, local script, images and headers copied to `dist`.
- `npm run lint`: passed, no warnings for active demo, build, test/configuration scripts.
- `node tests/verify-fixtures.mjs`: passed; all **3** example texts, candidate arrays and combined scores match `data/matching_results.json`; duplicate header files match; no credential patterns found in demo script.
- `npm test`: **20 passed, 0 failed, 0 skipped, 0 flaky**, 74.9 seconds. Real installed Google Chrome, fresh isolated incognito-equivalent contexts, no login. Two projects: desktop 1440×1000 and mobile 390×844.
- All 3 examples × both projects completed observation → interpretation → matching → validation → planner review → audit, including Back, Restart and reset after selecting another report.
- All homepage internal anchors and useful CTA destinations checked; every live-app link explains sign-in. Source links and unique element IDs checked. External destination evidence is recorded separately in `evaluator-public-links.json`.
- **10 unique public homepage destinations returned HTTP 200**. GitHub initially rate-limited the benchmark page (429); a fresh browser navigation returned 200, recorded with both statuses. Fresh Chrome navigations also confirmed the live application's sign-in screen and public source repository. No login was performed.
- **12 axe WCAG A/AA scans**, six stages in each project, **0 violations**. Initial toolbar contrast defect was fixed. Automated checks do not establish full accessibility conformance; no assistive-technology user study was performed.
- Responsive overflow checked at **320, 390, 768 and 1440 pixels** in both projects. Keyboard activation, focus transfer, skip link, mobile menu and Escape tested.
- Healthy local flow: **0 console errors, 0 failed assets, 0 backend requests**; only same-origin GETs. **0 cookies, 0 localStorage/sessionStorage entries**. Reload resets the example.
- Malformed fixture displays honest failure and recovery guidance. Script-unavailable / JavaScript-disabled context retains original observation and an always-visible text walkthrough link. Chrome's JavaScript-disable setting alone did not suppress the script during the first run; the fallback test additionally blocks the script request explicitly.
- Screenshots inspected: desktop homepage and desktop/mobile audit. Component screenshots hide sticky navigation only while capturing, to prevent a screenshot stitching overlay.

## Acceptance and boundaries

The first screen states the purpose and offers a credential-free public demo. The workflow displays original evidence, score components, uncertainty, sample planner rationale and resulting unchanged schedule. Audit IDs, actors, times and outcomes are labeled fictional/simulated. No success message claims a real backend decision.

No Supabase configuration, Auth, RLS, RBAC, API, migration, account or report was modified or bypassed. This demonstration never accesses the protected application's records. Its CSP disallows connections and forms. The live application's sign-in shell can be inspected without credentials; authenticated functions and backend health remain unverified.

No human timed comprehension/usability study, real-device test, screen-reader study, Firefox/Safari run, production end-to-end authorization test, or PPT review was performed. Dependencies retained from the existing landing reported **9 npm audit findings (2 moderate, 7 high)** at install; dependency remediation is outside this static-demo change. The deployed static page does not ship those npm packages.

## Review screenshots

- [Desktop homepage](evaluator-screenshots/desktop-home.png)
- [Mobile homepage](evaluator-screenshots/mobile-home.png)
- [Desktop demo](evaluator-screenshots/desktop-demo.png)
- [Mobile demo](evaluator-screenshots/mobile-demo.png)
- [Desktop audit](evaluator-screenshots/desktop-audit.png)
- [Mobile audit](evaluator-screenshots/mobile-audit.png)
- [Live prototype sign-in boundary](evaluator-screenshots/live-prototype-sign-in.png)

All modified paths are listed in [EVALUATOR_CHANGED_FILES.txt](EVALUATOR_CHANGED_FILES.txt). Machine-readable evidence: [test counts](evaluator-test-summary.json) and [public destination checks](evaluator-public-links.json).

## Local walkthrough

```sh
cd D:\SETU\.worktrees\sih-evaluator\landing
npm run build
npm run serve:demo
```

Open http://127.0.0.1:4178/#product. No environment configuration or credentials are required. Stop this server before running tests, which manage their own server.
