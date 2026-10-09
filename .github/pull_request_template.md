## Summary

<!-- What changed and why? -->

## Scope check

- [ ] This PR changes only the intended area.
- [ ] I did not change backend/database/matching/auth logic unless explicitly required.
- [ ] I did not intentionally change existing hooks/data behavior.

## UI PR checklist

> For Supervisor UI-only work, use a branch name starting with `ui/` (for example `ui/supervisor-redesign`).
> A `ui/*` PR is automatically scope-checked and will fail if it changes files outside the allowed Supervisor UI paths.

- [ ] Visual/layout changes are isolated from business logic.
- [ ] Responsive behavior checked where relevant.
- [ ] No production-only secrets or data were added.

## Verification

- [ ] GitHub Actions are green.
- [ ] Cloudflare Preview deployment is green.
- [ ] I manually tested the affected workflow in Preview.
- [ ] Existing critical workflows still work.

## Notes for reviewer

<!-- Mention any intentional behavior change or files that deserve special attention. -->
