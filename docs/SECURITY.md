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

## Planner governance boundary

Migration `006_transactional_planner_governance.sql` makes planner decisions,
validation overrides, and requeue operations authenticated PostgreSQL RPCs.
Each RPC locks the target report and writes the report change plus audit record
in one database transaction. Browser sessions cannot directly update governed
`field_updates` columns or insert `planner_audit_logs` rows.

`planner_audit_logs.actor_user_id`, derived from `auth.uid()`, is the
authoritative actor identity. `planner_name` and `field_updates.override_by`
remain non-authoritative display labels for compatibility with existing UI and
exports. The RPC derives these labels from the trusted database role; it does
not accept them from browser input.

Authenticated users retain read-only access to `schedule_activities`.
Service-role processes retain baseline ingestion and maintenance access. Never
expose the service-role credential to a browser.
