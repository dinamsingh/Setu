/** Actual 010 SQL/grants/RLS in the disposable fixture. Never connects to Supabase. */
import assert from 'node:assert/strict';

export async function verifyProgressEvents({ db, read, actor, rpc, seed, report, users }) {
  await actor('owner');
  await db.exec(await read('database/migrations/010_progress_events.sql'));
  let checks = 0;
  const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const denied = async (op, message = /permission denied/) => { await assert.rejects(op, message); checks++; };
  const server = async () => { await actor('owner'); await db.exec('set role service_role'); };
  const event = (type = 'START', changes = {}) => ({ event_index: 0, event_type: type,
    event_date: '2026-10-03', progress_percent: null, evidence_text: 'Welding started today',
    extraction_reason: 'Explicit actual wording anchored to reported_date.', extraction_version: 'phase1_rules_v1', ...changes });
  const complete = async (id, revision, events = [event()]) => {
    await server();
    return (await rpc('complete_field_update_progress_extraction', [id, revision, JSON.stringify(events)]))
      .complete_field_update_progress_extraction;
  };
  const history = async id => {
    await actor('owner');
    return (await db.query('select * from public.progress_events where field_update_id=$1 order by evidence_revision,event_index', [id])).rows;
  };
  const retrySignatures = [
    'public.fail_field_update_progress_extraction(uuid,bigint,text)',
    'public.list_field_updates_for_progress_extraction(integer)',
    'public.progress_extraction_ready()',
  ];
  for (const signature of retrySignatures) {
    await actor('owner');
    for (const role of ['anon', 'authenticated', 'service_role']) {
      check((await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, signature])).rows[0].allowed,
        role === 'service_role');
    }
    const info = (await db.query('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure', [signature])).rows[0];
    check(info.prosecdef, !signature.includes('progress_extraction_ready'));
    check(info.proconfig.map(c => c.replaceAll('"', '')), ['search_path=']);
    check((await db.query(`select count(*)::integer as n from pg_proc p,
      lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=$1::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'`, [signature])).rows[0].n, 0);
  }
  await server();
  check((await rpc('progress_extraction_ready', [])).progress_extraction_ready, true);
  check((await db.query('select * from public.list_field_updates_for_progress_extraction(0)')).rows, []);
  const batch = [];
  for (let i = 0; i < 26; i++) batch.push(await seed());
  await actor('owner');
  await db.query("update public.field_updates set created_at='1900-01-01' where id=any($1::uuid[])", [batch]);
  batch.sort();
  await server();
  const selected = (await db.query('select * from public.list_field_updates_for_progress_extraction(999)')).rows;
  check(selected.length, 25);
  check(selected.map(r => r.id), batch.slice(0, 25));
  for (const id of batch) check(await complete(id, 0), true);

  const poison = await seed();
  await actor('owner');
  await db.query("update public.field_updates set created_at='1800-01-01' where id=$1", [poison]);
  const beforeFailure = await report(poison);
  const fail = async (revision = 0) => {
    await server();
    return (await rpc('fail_field_update_progress_extraction', [poison, revision, 'ValueError'])).fail_field_update_progress_extraction;
  };
  for (const [index, seconds] of [30, 60, 120, 240, 480, 960, 1800, 1800].entries()) {
    check(await fail(), true);
    const current = await report(poison);
    check(current.progress_extraction_attempts, index + 1);
    check(current.progress_extraction_last_error, 'ValueError');
    check(Number(current.progress_extraction_retry_revision), 0);
    check(current.progress_extraction_revision, null);
    const delay = (await db.query(`select extract(epoch from progress_extraction_next_attempt_at-now())::float8 as delay
      from public.field_updates where id=$1`, [poison])).rows[0].delay;
    check(delay <= seconds && delay > seconds - 2, true);
    await server();
    check((await db.query('select id from public.list_field_updates_for_progress_extraction(25) where id=$1', [poison])).rows, []);
  }
  await actor('owner');
  const failed = await report(poison);
  check(failed, { ...beforeFailure, progress_extraction_retry_revision: failed.progress_extraction_retry_revision,
    progress_extraction_attempts: 8, progress_extraction_last_error: 'ValueError',
    progress_extraction_next_attempt_at: failed.progress_extraction_next_attempt_at });
  await db.query("update public.field_updates set progress_extraction_next_attempt_at=now()-interval '1 second' where id=$1", [poison]);
  await server();
  check((await db.query('select id from public.list_field_updates_for_progress_extraction(25) where id=$1', [poison])).rows.length, 1);
  await actor('planner');
  await rpc('resolve_field_update_clarification_now', [poison, 'Actual state?', 'phone', 'Finished today', 'Supervisor', 'mapping_inputs_changed']);
  // Old deadlines cannot suppress the new revision; stale failures cannot write.
  await actor('owner');
  await db.query("update public.field_updates set progress_extraction_next_attempt_at=now()+interval '30 minutes' where id=$1", [poison]);
  await server();
  check((await db.query('select id from public.list_field_updates_for_progress_extraction(25) where id=$1', [poison])).rows.length, 1);
  check(await fail(0), false);
  check(await fail(1), true);
  check((await report(poison)).progress_extraction_attempts, 1);
  check(await complete(poison, 1), true);
  const recovered = await report(poison);
  check([recovered.progress_extraction_retry_revision, recovered.progress_extraction_attempts,
    recovered.progress_extraction_last_error, recovered.progress_extraction_next_attempt_at], [null, 0, null, null]);
  check(await fail(1), false);
  for (const role of ['anon', 'planner']) {
    await actor(role);
    await denied(() => rpc('fail_field_update_progress_extraction', [poison, 1, 'error']));
    await denied(() => rpc('list_field_updates_for_progress_extraction', [25]));
    await denied(() => rpc('progress_extraction_ready', []));
  }
  await actor('site');
  for (const [column, value] of [
    ['progress_extraction_retry_revision', '0'], ['progress_extraction_attempts', '1'],
    ['progress_extraction_last_error', "'injected'"], ['progress_extraction_next_attempt_at', 'now()'],
  ]) {
    await denied(() => db.query(`insert into public.field_updates
      (update_id,field_text,submitted_by_user_id,status,confidence_level,confidence_score,candidate_matches,${column})
      values (gen_random_uuid()::text,'Evidence',$1,'pending','Pending',0,'[]',${value})`, [users.site]), /row-level security/);
  }
  await actor('owner');
  const signature = 'public.complete_field_update_progress_extraction(uuid,bigint,jsonb)';
  for (const role of ['anon', 'authenticated', 'service_role']) {
    check((await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, signature])).rows[0].allowed, role === 'service_role');
  }
  check((await db.query(`select count(*)::integer as n from pg_proc p,
    lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid=$1::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'`, [signature])).rows[0].n, 0);
  const functionInfo = (await db.query('select prosecdef,proconfig from pg_proc where oid=$1::regprocedure', [signature])).rows[0];
  check(functionInfo.prosecdef, true); check(functionInfo.proconfig.map(c => c.replaceAll('"', '')), ['search_path=']);
  const id = await seed();
  const before = await report(id);
  check(before.progress_extraction_revision, null);
  check(await complete(id, 0), true);
  const after = await report(id);
  check(after, { ...before, progress_extraction_revision: 0 });
  const original = await history(id);
  check(original.length, 1);
  check(await complete(id, 0, [event('FINISH')]), true);
  check(await history(id), original);
  await actor('planner');
  await rpc('resolve_field_update_clarification_now', [id, 'Actual state?', 'phone', '60% complete today', 'Supervisor', 'validation_inputs_changed']);
  check(await complete(id, 0), false);
  check((await report(id)).progress_extraction_revision, 0);
  check(await complete(id, 1, [event('START'), event('PROGRESS', { event_index: 1, progress_percent: 60 })]), true);
  const revisions = await history(id);
  check(revisions.slice(0, 1), original);
  check(revisions.map(e => [Number(e.evidence_revision), e.event_index, e.event_type]), [[0, 0, 'START'], [1, 0, 'START'], [1, 1, 'PROGRESS']]);
  // An invalid later event rolls back the earlier insert and marker atomically.
  const rollback = await seed();
  await denied(() => complete(rollback, 0, [event(), event('PROGRESS', { event_index: 1, progress_percent: 101 })]), /check constraint/);
  check(await history(rollback), []); check((await report(rollback)).progress_extraction_revision, null);
  check(await complete(rollback, 0), true);
  for (const invalid of [[], [event('UNKNOWN')], [event('START', { event_index: 1 })],
    [event('START', { event_date: 'today' })], [event('START', { event_date: '2026-02-30' })],
    [event('START', { progress_percent: 60 })], [event('PROGRESS')],
    [event('START'), event('UNKNOWN', { event_index: 1, event_date: null })]]) {
    const badId = await seed(); await denied(() => complete(badId, 0, invalid), /./);
    check(await history(badId), []); check((await report(badId)).progress_extraction_revision, null);
  }
  const unknown = await seed();
  check(await complete(unknown, 0, [event('UNKNOWN', { event_date: null })]), true);
  const terminal = await seed(); await actor('planner'); await rpc('review_field_update', [terminal, 'accept']);
  check(await complete(terminal, 0), true); check((await report(terminal)).status, 'approved');
  // Read visibility follows the parent field_updates RLS, including owner binding.
  const visibility = await seed(users.other); check(await complete(visibility, 0), true);
  for (const who of ['planner', 'admin', 'site', 'engineer', 'other']) {
    await actor(who);
    const visible = (await db.query('select distinct field_update_id from public.progress_events where field_update_id=any($1::uuid[])', [[id, visibility]])).rows.map(r => r.field_update_id).sort();
    check(visible, (['planner', 'admin'].includes(who) ? [id, visibility] : who === 'site' ? [id] : who === 'other' ? [visibility] : []).sort());
    await denied(() => rpc('complete_field_update_progress_extraction', [id, 1, '[]']));
    for (const sql of ["insert into public.progress_events(field_update_id) values ($1)",
      "update public.progress_events set extraction_reason='tampered' where field_update_id=$1",
      'delete from public.progress_events where field_update_id=$1']) await denied(() => db.query(sql, [id]));
  }
  await actor('anon'); await denied(() => db.query('select * from public.progress_events'));
  await denied(() => rpc('complete_field_update_progress_extraction', [id, 1, '[]']));
  await actor('site');
  const submitted = (await db.query(`insert into public.field_updates
    (update_id,field_text,submitted_by_user_id,status,confidence_level,confidence_score,candidate_matches)
    values ('PHASE1-CANONICAL','Welding started today',$1,'pending','Pending',0,'[]') returning progress_extraction_revision`, [users.site])).rows[0];
  check(submitted.progress_extraction_revision, null);
  await denied(() => db.query(`insert into public.field_updates
    (update_id,field_text,submitted_by_user_id,status,confidence_level,confidence_score,candidate_matches,progress_extraction_revision)
    values ('MARKER-INJECTION','Evidence',$1,'pending','Pending',0,'[]',0)`, [users.site]), /row-level security/);
  await actor('planner');
  await denied(() => db.query('update public.field_updates set progress_extraction_revision=0 where id=$1', [id]));
  // Even a privileged direct history update/delete is rejected by the trigger.
  await actor('owner');
  await denied(() => db.query("update public.progress_events set extraction_reason='tampered' where field_update_id=$1", [id]), /append-only/);
  await denied(() => db.query('delete from public.progress_events where field_update_id=$1', [id]), /append-only/);
  check(await history(id), revisions);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    check((await db.query("select has_function_privilege($1,'public.protect_progress_event_history()','EXECUTE') as allowed", [role])).rows[0].allowed, false);
  }
  console.log(`PASS: Phase 1 progress events: ${checks} isolated PostgreSQL/security checks.`);
  return checks;
}
