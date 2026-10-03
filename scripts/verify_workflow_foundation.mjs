/**
 * Isolated PostgreSQL SQL/RLS smoke tests for 008. Never connects to Supabase.
 * Run: node scripts/verify_workflow_foundation.mjs /path/to/pglite/dist/index.js
 * Add --review-guard-only to execute the review guard without applying migrations.
 * PGlite is an optional test runtime, not an application dependency. Its single
 * connection cannot prove multi-session row-lock behavior; Python covers the
 * deterministic race model and production concurrency still needs staging QA.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const guardOnly = args.includes('--review-guard-only');
const runtimePath = args.find((arg) => !arg.startsWith('--'));
const { PGlite } = await import(runtimePath
  ? pathToFileURL(runtimePath).href : '@electric-sql/pglite');
const db = new PGlite();
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
let checks = 0;
const users = {
  planner: '00000000-0000-4000-8000-000000000001',
  admin: '00000000-0000-4000-8000-000000000002',
  site: '00000000-0000-4000-8000-000000000003',
  engineer: '00000000-0000-4000-8000-000000000004',
  other: '00000000-0000-4000-8000-000000000005',
};
async function actor(name) {
  await db.exec('reset role;');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [users[name] ?? '']);
  const role = name === 'owner' ? 'postgres' : name === 'anon' ? 'anon' : 'authenticated';
  await db.query("select set_config('request.jwt.claim.role', $1, false)", [role]);
  if (name !== 'owner') await db.exec(`set role ${role};`);
}
async function rpc(name, args) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(',');
  return (await db.query(`select * from public.${name}(${placeholders})`, args)).rows[0];
}
async function rejects(operation, message) {
  await assert.rejects(operation, message);
  checks += 1;
}
async function report(id) {
  await actor('owner');
  return (await db.query('select * from public.field_updates where id = $1', [id])).rows[0];
}
async function seed(submitter = users.site) {
  await actor('owner');
  return (await db.query(`insert into public.field_updates
    (update_id, field_text, source_type, submitted_by_user_id, matched_activity_id, confidence_level, validation_status)
    values (gen_random_uuid()::text, 'Original evidence', 'manual_text', $1, 'ACT-A', 'High', 'pass') returning id`,
  [submitter])).rows[0].id;
}

async function verifyReviewGuardOnly() {
  const sql = await read('database/migrations/008_workflow_foundation.sql');
  const body = sql.match(/create or replace function public\.review_field_update\([\s\S]*?as \$\$([\s\S]*?)\$\$;/)?.[1];
  assert.ok(body, 'Review function must exist');
  const start = body.indexOf("if v_action in ('accept', 'remap') then");
  const end = body.indexOf("if v_action = 'accept' then", start);
  assert.ok(start >= 0 && end > start, 'Review guard boundaries must exist');
  const guard = body.slice(start, end).trim();
  const text = (value) => value === null ? 'null::text' : `'${value.replaceAll("'", "''")}'::text`;
  const run = (action, state = {}) => {
    const row = { status: 'pass', evidence: 0, validationEvidence: 0, overridden: false,
      overrideEvidence: null, overrideActivity: null, activity: 'ACT-A', ...state };
    // Anonymous PL/pgSQL blocks execute only the source guard. No tables,
    // migration DDL, or governance RPCs are installed or deployed in this mode.
    return db.exec(`do $$ declare v_update record; v_action text := ${text(action)}; begin
      select ${text(row.status)} as validation_status,
        ${row.evidence}::bigint as evidence_revision,
        ${row.validationEvidence}::bigint as validation_evidence_revision,
        ${row.overridden}::boolean as validation_overridden,
        ${row.overrideEvidence ?? 'null'}::bigint as override_evidence_revision,
        ${text(row.overrideActivity)} as override_activity_id,
        ${text(row.activity)} as matched_activity_id into v_update;
      ${guard}
    end $$;`);
  };
  for (const action of ['accept', 'remap']) {
    for (const status of [null, 'unsupported', '']) {
      await rejects(() => run(action, { status }), /Current validation must complete before approval or remap/);
    }
    for (const status of ['pass', 'warn']) {
      await run(action, { status });
      checks += 1;
    }
    await rejects(() => run(action, { status: 'block' }), /current scoped override/);
    const scoped = { status: 'block', overridden: true, overrideEvidence: 0, overrideActivity: 'ACT-A' };
    await run(action, scoped);
    checks += 1;
    await rejects(() => run(action, { ...scoped, overrideEvidence: 1 }), /current scoped override/);
    await rejects(() => run(action, { ...scoped, overrideActivity: 'ACT-B' }), /current scoped override/);
    await rejects(() => run(action, { evidence: 1 }), /validation refresh/);
    // Requeue clears validation. Neither an absent link nor a subsequently
    // restored link may bypass the completed-validation requirement.
    await rejects(() => run(action, { status: null, activity: null }), /Current validation must complete/);
    await rejects(() => run(action, { status: null, activity: 'ACT-A' }), /Current validation must complete/);
  }
  await run('reject', { status: null });
  checks += 1;
  console.log(`PASS: ${checks} isolated PostgreSQL review-guard checks. Migration 008 not applied; no live connection.`);
}

try {
  if (guardOnly) {
    await verifyReviewGuardOnly();
  } else {
  // Only disposable fixture DDL is executed. Table definitions for evidence and
  // audit are extracted to match this checkout; schema.sql is never replayed.
  const schema = await read('database/schema.sql');
  const table = (name) => {
    const match = schema.match(new RegExp(`create table if not exists ${name} \\([\\s\\S]*?\\n\\);`));
    assert.ok(match, name);
    return match[0];
  };
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema extensions;
    create table auth.users(id uuid primary key);
    grant usage on schema auth, public to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as
      $$ select current_setting('request.jwt.claim.role', true) $$;
    create table public.schedule_activities(id uuid primary key default gen_random_uuid(), activity_id text unique not null);
    ${table('domain_aliases')}
    ${table('field_updates')}
    ${table('planner_audit_logs')}
    -- Vector search is unrelated to B1; a fixture signature lets 007 execute.
    create domain public.vector as double precision[];
    create function public.match_schedule_activities(vector, double precision, integer)
      returns integer language sql as $$ select 0 $$;
  `);
  await db.exec(await read('database/migrations/005_auth_rls.sql'));
  await db.exec(await read('database/migrations/006_transactional_planner_governance.sql'));
  await db.exec(await read('database/migrations/007_security_hardening.sql'));
  await db.query(`insert into auth.users(id) select unnest($1::uuid[])`, [Object.values(users)]);
  for (const [name, id] of Object.entries(users)) {
    await db.query('insert into public.user_roles(user_id, role) values ($1, $2)', [id, name === 'other' ? 'site' : name]);
  }
  await db.exec("insert into public.schedule_activities(activity_id) values ('ACT-A'), ('ACT-B');");
  const existing = await seed();
  await actor('planner');
  await rejects(() => rpc('override_field_update_validation', [existing, 'reason']), /Only blocked validation/);
  await actor('owner');
  await db.query("update public.field_updates set validation_status = 'block' where id = $1", [existing]);
  await actor('planner');
  await rpc('override_field_update_validation', [existing, 'Existing governed override']);
  await actor('owner');
  await db.exec(await read('database/migrations/008_workflow_foundation.sql'));
  const backfill = await report(existing);
  assert.equal(Number(backfill.override_evidence_revision), 0);
  assert.equal(backfill.override_activity_id, 'ACT-A');
  checks += 3; // migration execution and legacy override backfill

  const endpoints = ['request_field_update_clarification', 'respond_to_field_update_clarification',
    'resolve_field_update_clarification_now', 'triage_field_update_clarification', 'close_field_update_as_invalid',
    'review_field_update', 'override_field_update_validation', 'requeue_field_update'];
  const privileges = (await db.query(`select p.proname,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1::text[])`, [endpoints])).rows;
  assert.equal(privileges.length, 8);
  for (const privilege of privileges) {
    assert.equal(privilege.anon_execute, false, privilege.proname);
    assert.equal(privilege.authenticated_execute, true, privilege.proname);
    checks += 1;
  }

  // Exact current browser payload, including explicit empty machine fields.
  await actor('site');
  const inserted = (await db.query(`insert into public.field_updates
    (update_id, source_type, field_text, site_location, reported_by, reported_date,
     status, confidence_level, confidence_score, matched_activity_id, expanded_text,
     matched_layer, candidate_matches, submitted_by_user_id)
    values ('UI-COMPAT', 'manual_text', 'Captured evidence', 'Area A', 'Display only', current_date,
     'pending', 'Pending', 0, null, null, null, '[]', $1) returning id`, [users.site])).rows[0];
  assert.ok(inserted.id);
  checks += 1;
  for (const [column, value] of [
    ['matched_activity_id', "'ACT-A'"], ['validation_status', "'pass'"],
    ['validation_overridden', 'true'], ['status', "'approved'"],
    ['planner_remarks', "'forged'"], ['evidence_revision', '1'], ['workflow_revision', '1'],
    ['override_reason', "'forged'"], ['confidence_level', "'High'"],
  ]) {
    await rejects(() => db.query(`insert into public.field_updates
      (field_text, submitted_by_user_id, ${column}) values ('Forged', $1, ${value})`, [users.site]), /row-level security/);
  }

  const id = await seed();
  await actor('planner');
  await rejects(() => rpc('request_field_update_clarification', [id, '   ']), /non-empty clarification/);
  const round = await rpc('request_field_update_clarification', [id, 'Confirm area?', 0]);
  assert.equal(round.recipient_user_id, users.site);
  await rejects(() => rpc('request_field_update_clarification', [id, 'Second request']), /active clarification/);
  await rejects(() => rpc('request_field_update_clarification', [id, 'Stale request', 0]), /Workflow changed/);
  await rejects(() => rpc('review_field_update', [id, 'accept']), /active clarification/);
  await rejects(() => rpc('requeue_field_update', [id]), /active clarification/);
  await actor('other');
  assert.equal((await db.query('select * from public.field_update_clarifications')).rows.length, 0);
  await rejects(() => rpc('respond_to_field_update_clarification', [round.id, 'Correction']), /unavailable to this submitter/);
  await actor('site');
  assert.equal((await db.query('select * from public.field_update_clarifications')).rows.length, 1);
  await rejects(() => db.query("update public.field_update_clarifications set response = 'forged' where id = $1", [round.id]), /permission denied/);
  await rejects(() => db.query("insert into public.field_update_clarifications(field_update_id) values ($1)", [id]), /permission denied/);
  await rejects(() => db.query('delete from public.field_update_clarifications where id = $1', [round.id]), /permission denied/);
  await rejects(() => rpc('request_field_update_clarification', [id, 'Forged planner action']), /Planner or administrator/);
  const response = await rpc('respond_to_field_update_clarification', [round.id, 'Area confirmed', 1]);
  assert.equal(response.status, 'responded');
  await rejects(() => rpc('respond_to_field_update_clarification', [round.id, 'Second response']), /not open/);
  await actor('planner');
  await rejects(() => rpc('review_field_update', [id, 'accept']), /active clarification/);
  const triaged = await rpc('triage_field_update_clarification', [round.id, 'confirm_only', 'Confirmed', 2]);
  assert.equal(triaged.status, 'resolved');
  const accepted = await rpc('review_field_update', [id, 'accept']);
  assert.equal(accepted.status, 'approved');
  assert.equal(Number(accepted.evidence_revision), 0);
  await rejects(() => rpc('request_field_update_clarification', [id, 'Again']), /finalized/);
  await rejects(() => rpc('requeue_field_update', [id]), /finalized/);
  checks += 6; // routing, RLS reads, response, triage, legacy accept
  await actor('owner');
  await rejects(() => db.query("update public.field_update_clarifications set response = 'rewritten' where id = $1", [round.id]), /history is immutable/);

  for (const impact of ['validation_inputs_changed', 'mapping_inputs_changed']) {
    const changed = await seed();
    await actor('planner');
    const direct = await rpc('resolve_field_update_clarification_now', [changed, 'Confirm context?', 'phone', 'Corrected area', 'Supervisor', impact]);
    assert.equal(direct.status, 'resolved');
    await rejects(() => rpc('review_field_update', [changed, 'accept']), /validation refresh/);
    await rejects(() => rpc('requeue_field_update', [changed]), /B2 processing/);
    const state = await report(changed);
    assert.equal(state.field_text, 'Original evidence');
    assert.equal(Number(state.evidence_revision), 1);
    assert.equal(state.confidence_level, 'High');
    assert.equal(state.validation_status, null);
    checks += 2;
  }
  const unroutable = await seed(null);
  await actor('planner');
  await rejects(() => rpc('request_field_update_clarification', [unroutable, 'Who?']), /Original submitter/);
  await rpc('resolve_field_update_clarification_now', [unroutable, 'Context?', 'phone', 'Confirmed', 'Supervisor', 'confirm_only']);

  // Real PostgreSQL transaction rollback when audit insertion fails.
  const closeId = await seed();
  await actor('planner');
  const closing = await rpc('request_field_update_clarification', [closeId, 'Context?']);
  await rejects(() => rpc('close_field_update_as_invalid', [closeId, ' ']), /invalid-close reason/);
  await actor('owner');
  await db.exec(`create function public.fixture_fail_audit() returns trigger language plpgsql as $$
    begin if current_setting('test.fail_audit', true) = 'on' then raise exception 'test audit failure'; end if; return new; end $$;
    create trigger fixture_fail_audit before insert on public.planner_audit_logs for each row execute function public.fixture_fail_audit();`);
  await db.query("select set_config('test.fail_audit', 'on', false)");
  await actor('planner');
  await rejects(() => rpc('close_field_update_as_invalid', [closeId, 'Duplicate']), /test audit failure/);
  const rolledBack = await report(closeId);
  assert.equal(rolledBack.status, 'pending');
  assert.equal(Number(rolledBack.workflow_revision), 1);
  assert.equal((await db.query('select status from public.field_update_clarifications where id = $1', [closing.id])).rows[0].status, 'open');
  await db.query("select set_config('test.fail_audit', 'off', false)");
  await actor('admin');
  const closed = await rpc('close_field_update_as_invalid', [closeId, 'Duplicate']);
  assert.equal(closed.status, 'rejected');
  const audit = (await db.query("select * from public.planner_audit_logs where field_update_id = $1 and action = 'reject'", [closeId])).rows[0];
  assert.equal(audit.actor_user_id, users.admin);
  assert.equal(audit.metadata.decision, 'close_as_invalid');
  assert.deepEqual(audit.metadata.cancelled_clarification_ids, [closing.id]);
  checks += 5;
  await actor('owner');
  await rejects(() => db.query("update public.field_update_clarifications set question = 'rewritten' where id = $1", [closing.id]), /history is immutable/);
  await rejects(() => db.query('delete from public.field_update_clarifications where id = $1', [closing.id]), /cannot be deleted/);
  await rejects(() => db.query("update public.planner_audit_logs set remarks = 'rewritten' where field_update_id = $1", [closeId]), /append-only/);

  // Proposal constraints, uniqueness, browser deny, and cancellation.
  const proposalId = await seed();
  const proposal = (await db.query(`insert into public.field_update_remap_proposals
    (field_update_id, target_activity_id, proposed_by_user_id, evidence_revision, workflow_revision)
    values ($1, 'ACT-B', $2, 0, 0) returning id`, [proposalId, users.planner])).rows[0];
  await rejects(() => db.query(`insert into public.field_update_remap_proposals
    (field_update_id, target_activity_id, proposed_by_user_id, evidence_revision, workflow_revision)
    values ($1, 'ACT-A', $2, 0, 0)`, [proposalId, users.planner]), /unique constraint/);
  await rejects(() => db.query("update public.field_update_remap_proposals set status = 'validated' where id = $1", [proposal.id]), /check constraint/);
  await actor('site');
  assert.equal((await db.query('select * from public.field_update_remap_proposals')).rows.length, 0);
  await rejects(() => db.query("update public.field_update_remap_proposals set status = 'validated' where id = $1", [proposal.id]), /permission denied/);
  await actor('planner');
  await rejects(() => rpc('request_field_update_clarification', [proposalId, 'Context?']), /Active remap proposal/);
  await rejects(() => rpc('review_field_update', [proposalId, 'remap', 'ACT-B']), /Active remap proposal/);
  await rpc('close_field_update_as_invalid', [proposalId, 'Wrong context']);
  await actor('owner');
  assert.equal((await db.query('select status from public.field_update_remap_proposals where id = $1', [proposal.id])).rows[0].status, 'cancelled');
  checks += 2;

  // Legacy remap and override/requeue continue to use their original signatures.
  await actor('planner');
  const remapped = await rpc('review_field_update', [existing, 'remap', 'ACT-B']);
  assert.equal(remapped.status, 'remapped');
  assert.equal(remapped.validation_overridden, false);
  const requeueId = await seed();
  await actor('owner');
  await db.query("update public.field_updates set validation_status = 'block' where id = $1", [requeueId]);
  await actor('planner');
  await rpc('override_field_update_validation', [requeueId, 'Verified']);
  const requeued = await rpc('requeue_field_update', [requeueId]);
  assert.equal(requeued.matched_activity_id, null);
  assert.equal(requeued.validation_overridden, false);
  assert.equal(requeued.validation_status, null);
  assert.equal(Number(requeued.workflow_revision), 2);
  checks += 2;

  await actor('anon');
  await rejects(() => rpc('request_field_update_clarification', [requeueId, 'Forbidden']), /permission denied/);
  await rejects(() => db.query('select * from public.field_update_clarifications'), /permission denied/);
  await actor('site');
  await rejects(() => rpc('_lock_pending_workflow_report', [requeueId]), /permission denied/);
  console.log(`PASS: migration 005/006/007/008 executes locally; ${checks} PostgreSQL workflow/security checks. No live connection.`);
  }
} finally {
  await db.close();
}
