# SETU — Security & Deployment Boundary

## Prototype boundary

This repository is a hackathon prototype. The included Supabase schema is configured for easy demonstration and should **not** be treated as a production security configuration.

Before production deployment:

- enable and test PostgreSQL/Supabase Row Level Security;
- restrict database privileges to least privilege;
- keep service-role credentials server-side only;
- use organization-controlled SSO/OIDC and RBAC;
- validate file uploads and external inputs server-side;
- add rate limiting, secret rotation and centralized monitoring;
- isolate project/WBS data by tenant or organizational scope;
- test audit-log integrity and backup/restore procedures.

## Data

Only synthetic/sample data is included in the public prototype. Do not commit OIL confidential schedules, field reports, credentials or production exports.