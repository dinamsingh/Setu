/** Called by the isolated fixture runner. No network or Supabase connection. */
import assert from 'node:assert/strict';

export async function verifyWorkerWorkflow({ db, read, actor, rpc, seed, report, users }) {
  await actor('owner');
  await db.exec(await read('database/migrations/009_worker_workflow_orchestration.sql'));
  let checks = 0;
  const reject = async (op, message) => { await assert.rejects(op, message); checks++; };
  const server = async () => { await actor('owner'); await db.exec('set role service_role'); };
  const payload = (status = 'pass') => JSON.stringify({ validation_status: status,
    validation_results: [{ check: 'fixture', outcome: status === 'block' ? 'fail' : status }],
    confidence_level: 'High', confidence_score: 0.9, matched_activity_id: 'ACT-A',
    candidate_matches: [], expanded_text: 'Computed evidence', matched_layer: 'semantic' });
  const complete = async (id, snapshot, intent = 'match') => {
    await server();
    const row = await rpc('complete_field_update_processing', [id, snapshot.workflow_revision, snapshot.evidence_revision, intent, payload()]);
    return row.complete_field_update_processing;
  };
  const proposalResult = async (p, status = 'pass', generation = p.validation_generation) => {
    await server();
    const row = await rpc('complete_field_update_remap_validation', [p.id, p.target_activity_id,
      p.workflow_revision, p.evidence_revision, generation, payload(status)]);
    return row.complete_field_update_remap_validation;
  };
  const propose = async id => { await actor('planner'); return rpc('propose_field_update_remap', [id, 'ACT-B']); };
  const functions = ['complete_field_update_processing', 'complete_field_update_remap_validation',
    'propose_field_update_remap', 'override_field_update_remap_proposal', 'cancel_field_update_remap_proposal', 'finalize_field_update_remap',
    'accept_current_field_update', 'override_current_field_update_validation', 'requeue_current_field_update'];
  const grants = (await db.query(`select proname, prosecdef, proconfig,
    has_function_privilege('anon', oid, 'EXECUTE') as anon,
    has_function_privilege('authenticated', oid, 'EXECUTE') as browser,
    has_function_privilege('service_role', oid, 'EXECUTE') as server
    from pg_proc where proname = any($1::text[])`, [functions])).rows;
  assert.equal(grants.length, 9);
  for (const g of grants) {
    assert.equal(g.anon, false);
    assert.equal(g.browser, !g.proname.startsWith('complete_'));
    if (g.proname.startsWith('complete_')) assert.equal(g.server, true);
    if (g.proname.includes('_current_field_update')) assert.equal(g.server, false);
    assert.ok(g.prosecdef && g.proconfig.some(c => c.replaceAll('"', '') === 'search_path='));
    checks += 4;
  }
  const wrappers = ['accept_current_field_update', 'override_current_field_update_validation', 'requeue_current_field_update'];
  const logs = async id => {
    await actor('owner');
    return (await db.query('select * from public.planner_audit_logs where field_update_id=$1 order by id', [id])).rows;
  };
  const prepare = async name => {
    const id = await seed();
    if (name === 'override_current_field_update_validation') {
      await actor('owner'); await db.query("update public.field_updates set validation_status='block' where id=$1", [id]);
    }
    return id;
  };
  for (const name of wrappers) {
    const id = await prepare(name);
    await actor('planner');
    await reject(() => rpc(name, [id, 'Reviewed note']), /Expected workflow revision is required/);
    await reject(() => rpc(name, [id, 'Reviewed note', null]), /Expected workflow revision is required/);
    // Another planner advances the report after the original browser displayed revision zero.
    await actor('admin');
    await rpc('resolve_field_update_clarification_now', [id, 'Context?', 'phone', 'Confirmed', 'Supervisor', 'confirm_only', 0]);
    const before = await report(id); const auditBefore = await logs(id);
    await actor('planner');
    await assert.rejects(() => rpc(name, [id, 'Reviewed note', 0]), error => {
      assert.equal(error.code, '40001'); assert.match(error.message, /Workflow changed; refresh before acting/); return true;
    });
    assert.deepEqual(await report(id), before); assert.deepEqual(await logs(id), auditBefore);
    await actor('planner'); const current = await rpc(name, [id, 'Reviewed note', before.workflow_revision]);
    assert.equal(Number(current.workflow_revision), 2);
    if (name.startsWith('accept_')) assert.equal(current.status, 'approved');
    if (name.startsWith('override_')) {
      assert.equal(current.validation_overridden, true); assert.equal(current.override_activity_id, 'ACT-A');
      assert.equal(Number(current.override_evidence_revision), Number(current.evidence_revision));
    }
    if (name.startsWith('requeue_')) {
      assert.equal(current.confidence_level, 'Pending'); assert.equal(current.validation_status, null);
      assert.equal(current.matched_activity_id, null);
    }
    const afterLogs = await logs(id);
    assert.equal(afterLogs.length, auditBefore.length + 1);
    const decision = afterLogs.find(log => log.action === ({
      accept_current_field_update: 'accept', override_current_field_update_validation: 'override', requeue_current_field_update: 'requeue',
    })[name]);
    assert.equal(decision.actor_user_id, users.planner);
    assert.equal(decision.previous_activity_id, 'ACT-A');
    assert.equal(decision.new_activity_id, name.startsWith('requeue_') ? null : 'ACT-A');
    checks += 10;
    for (const who of ['site', 'engineer', 'anon']) {
      const denied = await prepare(name); await actor(who);
      await reject(() => rpc(name, [denied, 'Reviewed note', 0]), who === 'anon' ? /permission denied/ : /Planner or administrator/);
    }
    const adminId = await prepare(name); await actor('admin');
    assert.equal(Number((await rpc(name, [adminId, 'Admin reviewed', 0])).workflow_revision), 1); checks++;
    // A delegated audit failure rolls the entire nested decision back.
    const rollbackId = await prepare(name); const original = await report(rollbackId);
    await db.query("select set_config('test.fail_audit', 'on', false)"); await actor('planner');
    await reject(() => rpc(name, [rollbackId, 'Reviewed note', 0]), /test audit failure/);
    assert.deepEqual(await report(rollbackId), original); assert.equal((await logs(rollbackId)).length, 0);
    await db.query("select set_config('test.fail_audit', 'off', false)"); checks += 2;
  }
  // PUBLIC must not confer EXECUTE; old client signatures/grants remain present.
  await actor('owner');
  const publicGrants = (await db.query(`select count(*)::integer as count from pg_proc p,
    lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.proname = any($1::text[]) and a.grantee=0 and a.privilege_type='EXECUTE'`, [wrappers])).rows[0];
  assert.equal(publicGrants.count, 0); checks++;
  for (const signature of ['review_field_update(uuid,text,text,text)', 'override_field_update_validation(uuid,text)', 'requeue_field_update(uuid,text)']) {
    const permission = (await db.query("select has_function_privilege('authenticated', $1, 'EXECUTE') as allowed", [`public.${signature}`])).rows[0];
    assert.equal(permission.allowed, true); checks++;
  }
  // Two decisions using the same displayed revision cannot silently compose.
  const conflict = await prepare('override_current_field_update_validation'); await actor('planner');
  await rpc('override_current_field_update_validation', [conflict, 'Signed exception', 0]);
  const afterOverride = await report(conflict); await actor('admin');
  await reject(() => rpc('requeue_current_field_update', [conflict, 'Older browser', 0]), /Workflow changed/);
  assert.deepEqual(await report(conflict), afterOverride); await actor('admin');
  await rpc('requeue_current_field_update', [conflict, 'Refreshed browser', 1]); checks++;
  // A worker completion also invalidates the planner's older displayed revision.
  const workerRace = await seed(); await actor('planner'); await rpc('requeue_current_field_update', [workerRace, null, 0]);
  const workerSnapshot = await report(workerRace); assert.equal(await complete(workerRace, workerSnapshot), true);
  const workerCurrent = await report(workerRace); await actor('planner');
  await reject(() => rpc('accept_current_field_update', [workerRace, null, workerSnapshot.workflow_revision]), /Workflow changed/);
  assert.deepEqual(await report(workerRace), workerCurrent); await actor('planner');
  assert.equal((await rpc('accept_current_field_update', [workerRace, null, workerCurrent.workflow_revision])).status, 'approved'); checks += 3;
  // Each planner/field mutation makes the original computation obsolete.
  for (const mutation of ['clarification', 'finalize', 'requeue', 'evidence', 'proposal']) {
    const id = await seed();
    await actor('planner'); await rpc('requeue_field_update', [id]);
    const snapshot = await report(id);
    await actor('planner');
    if (mutation === 'clarification') await rpc('request_field_update_clarification', [id, 'Confirm context?']);
    if (mutation === 'finalize') await rpc('close_field_update_as_invalid', [id, 'Duplicate']);
    if (mutation === 'requeue') await rpc('requeue_field_update', [id]);
    if (mutation === 'evidence') await rpc('resolve_field_update_clarification_now', [id, 'Work?', 'phone', 'Different work', 'Supervisor', 'mapping_inputs_changed']);
    if (mutation === 'proposal') await propose(id);
    const before = await report(id);
    assert.equal(await complete(id, snapshot), false);
    assert.deepEqual(await report(id), before);
    checks += 2;
  }
  for (const impact of ['confirm_only', 'validation_inputs_changed', 'mapping_inputs_changed']) {
    const id = await seed(); await actor('planner');
    await rpc('resolve_field_update_clarification_now', [id, 'Work?', 'phone', 'Confirmed context', 'Supervisor', impact]);
    const snapshot = await report(id);
    if (impact === 'confirm_only') {
      assert.equal(await complete(id, snapshot), false);
    } else {
      assert.equal(await complete(id, snapshot, impact === 'validation_inputs_changed' ? 'revalidate' : 'rematch'), true);
      const current = await report(id);
      assert.equal(Number(current.validation_evidence_revision), Number(current.evidence_revision));
      assert.equal(current.field_text, 'Original evidence');
      assert.equal(await complete(id, current, 'revalidate'), false);
    }
    checks += 4;
  }
  const matching = await seed(); await actor('planner'); await rpc('requeue_field_update', [matching]);
  await reject(() => rpc('review_field_update', [matching, 'accept']), /Current validation must complete/);
  const matchingSnapshot = await report(matching);
  assert.equal(await complete(matching, matchingSnapshot), true);
  assert.equal(await complete(matching, matchingSnapshot), false);
  await actor('planner'); assert.equal((await rpc('review_field_update', [matching, 'accept'])).status, 'approved');
  checks += 3;
  for (const status of ['pass', 'warn', 'block']) {
    const id = await seed();
    // Old report-level override never supplies proposal authority.
    await actor('owner'); await db.query("update public.field_updates set validation_status = 'block' where id=$1", [id]);
    await actor('planner'); await rpc('override_field_update_validation', [id, 'Old target exception']);
    const p = await propose(id);
    await reject(() => rpc('finalize_field_update_remap', [p.id]), /must complete/);
    assert.equal(await proposalResult(p, status, 2), false);
    assert.equal(await proposalResult(p, status), true);
    assert.equal((await report(id)).matched_activity_id, 'ACT-A');
    await actor('planner');
    if (status === 'block') {
      await reject(() => rpc('finalize_field_update_remap', [p.id]), /proposal-scoped override/);
      await reject(() => rpc('override_field_update_remap_proposal', [p.id, ' ']), /non-empty/);
      await rpc('override_field_update_remap_proposal', [p.id, 'Signed evidence exception']);
    }
    const finalized = await rpc('finalize_field_update_remap', [p.id, 'Selected target reviewed']);
    assert.equal(finalized.status, 'remapped'); assert.equal(finalized.matched_activity_id, 'ACT-B');
    assert.equal(finalized.validation_status, status); assert.equal(finalized.validation_overridden, status === 'block');
    assert.equal(finalized.override_activity_id, status === 'block' ? 'ACT-B' : null);
    assert.equal(await proposalResult(p, status), false);
    await actor('owner');
    const log = (await db.query("select * from public.planner_audit_logs where field_update_id=$1 and action='remap'", [id])).rows[0];
    assert.equal(log.metadata.proposal_id, p.id); assert.equal(log.previous_activity_id, 'ACT-A');
    assert.equal(log.metadata.validation_status, status); assert.equal(log.actor_user_id, users.planner);
    checks += 11;
  }
  const id = await seed(); const p = await propose(id);
  await actor('site');
  for (const name of ['override_field_update_remap_proposal', 'cancel_field_update_remap_proposal']) {
    await reject(() => rpc(name, [p.id, 'Not authorized']), /planner or administrator/);
  }
  await reject(() => rpc('complete_field_update_remap_validation', [p.id, 'ACT-B', p.workflow_revision, 0, 1, payload()]), /permission denied/);
  await actor('planner');
  await reject(() => rpc('request_field_update_clarification', [id, 'Conflicting?']), /Active remap proposal/);
  await rpc('cancel_field_update_remap_proposal', [p.id, 'Clarification needed']);
  assert.equal(await proposalResult(p), false);
  await actor('planner'); await rpc('request_field_update_clarification', [id, 'Context?']);
  checks += 2;
  // Audit failure must roll back parent and proposal creation atomically.
  const rollback = await seed(); await actor('owner');
  await db.query("select set_config('test.fail_audit', 'on', false)"); await actor('planner');
  await reject(() => rpc('propose_field_update_remap', [rollback, 'ACT-B']), /test audit failure/);
  const rolledBack = await report(rollback); assert.equal(Number(rolledBack.workflow_revision), 0);
  assert.equal((await db.query('select * from public.field_update_remap_proposals where field_update_id=$1', [rollback])).rows.length, 0);
  await db.query("select set_config('test.fail_audit', 'off', false)"); checks += 2;
  console.log(`PASS: 009 SQL, CAS, target validation, grants and transactional audit: ${checks} isolated PostgreSQL checks.`);
  return checks;
}
