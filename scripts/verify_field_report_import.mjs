/** Actual 005–013 SQL on an in-memory PostgreSQL WASM fixture; no network/env.
 * node scripts/verify_field_report_import.mjs <optional pglite/dist/index.js>
 * PGlite has ONE serialized connection. Queued retry tests are not multi-session
 * locking tests; production PostgreSQL contention verification remains required.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite');
const db = new PGlite();
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const rejected = async (operation, pattern) => { await assert.rejects(operation, pattern); checks++; };
const users = Object.fromEntries(['site', 'engineer', 'planner', 'admin', 'other', 'unassigned'].map(name => [name, randomUUID()]));
async function actor(name) {
  await db.exec('reset role');
  const role = name === 'owner' ? 'postgres' : ['anon', 'service_role'].includes(name) ? name : 'authenticated';
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role',$2,false)", [users[name] ?? '', role]);
  if (name !== 'owner') await db.exec(`set role ${role}`);
}
const row = (text = 'Rack B welding finished', number = 2, changes = {}) => ({ row_number: number,
  field_text: text, reported_date: '2026-10-11', site_location: null, reported_by: null, discipline: null, ...changes });
async function rpc(rows, key = randomUUID(), format = 'csv') {
  return (await db.query('select public.import_field_reports($1,$2,$3::jsonb) as result', [key, format, JSON.stringify(rows)])).rows[0].result;
}
async function counts() {
  await actor('owner');
  return (await db.query(`select (select count(*)::int from public.field_updates) as reports,
    (select count(*)::int from public.field_report_import_rows) as fingerprints,
    (select count(*)::int from public.field_report_import_batches) as batches`)).rows[0];
}

try {
  const schema = await read('database/schema.sql');
  const table = name => {
    const match = schema.match(new RegExp(`create table if not exists ${name} \\([\\s\\S]*?\\n\\);`));
    assert.ok(match, name); return match[0];
  };
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create table auth.users(id uuid primary key);
    grant usage on schema auth, public to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as
      $$ select current_setting('request.jwt.claim.role',true) $$;
    create table public.schedule_activities(id uuid primary key default gen_random_uuid(), activity_id text unique not null,
      activity_name text, wbs_code text, wbs_name text, discipline text, planned_start_date date, planned_finish_date date);
    ${table('domain_aliases')} ${table('field_updates')} ${table('planner_audit_logs')}
    create domain public.vector as double precision[];
    create function public.match_schedule_activities(vector,double precision,integer) returns integer language sql as $$ select 0 $$;`);
  for (const name of ['005_auth_rls', '006_transactional_planner_governance', '007_security_hardening',
    '008_workflow_foundation', '009_worker_workflow_orchestration', '010_progress_events', '011_actuals_overlay',
    '012_field_report_intake', '013_secure_field_report_import']) {
    await db.exec(await read(`database/migrations/${name}.sql`));
  }
  await db.query('insert into auth.users select unnest($1::uuid[])', [Object.values(users)]);
  for (const [name, id] of Object.entries(users)) {
    if (name !== 'unassigned') await db.query('insert into public.user_roles(user_id,role) values ($1,$2)', [id, name === 'other' ? 'site' : name]);
  }
  await db.exec("insert into public.schedule_activities(activity_id) values ('ACT-A')");
  const privileges = (await db.query(`select prosecdef, proconfig,
    has_function_privilege('anon',oid,'execute') as anon,
    has_function_privilege('authenticated',oid,'execute') as authenticated,
    has_function_privilege('service_role',oid,'execute') as service
    from pg_proc where proname='import_field_reports'`)).rows[0];
  check([privileges.prosecdef, privileges.anon, privileges.authenticated, privileges.service], [true, false, true, false]);
  check(privileges.proconfig.some(value => value.replaceAll('"','') === 'search_path='), true);
  for (const role of ['anon', 'service_role', 'planner', 'admin', 'unassigned']) {
    await actor(role); await rejected(() => rpc([row()]), /permission denied|Only authenticated/);
  }
  await actor('site'); await db.query("select set_config('request.jwt.claim.sub','',false)");
  await rejected(() => rpc([row()]), /Only authenticated/);
  await actor('site'); await db.query("select set_config('request.jwt.claim.role','',false)");
  await rejected(() => rpc([row()]), /Only authenticated/);

  const key = randomUUID(); const payload = [row('Rack A complete', 2), row('Rack B complete', 3, { discipline: ' piping ', reported_by: ' R. Das ' })];
  await actor('site'); const initial = await rpc(payload, key);
  check([initial.status, initial.imported_count, initial.duplicate_count, initial.error_count], ['completed', 2, 0, 0]);
  check(initial.rows.map(r => [r.row_number, r.outcome]), [[2,'imported'], [3,'imported']]);
  const reportId = initial.rows[1].field_update_id;
  const imported = (await db.query('select * from public.field_updates where id=$1', [reportId])).rows[0];
  check([imported.submitted_by_user_id, imported.status, imported.confidence_level, imported.source_type,
    imported.discipline, imported.reported_by], [users.site,'pending','Pending','spreadsheet_csv','Piping','R. Das']);
  check([imported.matched_activity_id, imported.expanded_text, imported.matched_layer, imported.validation_status,
    imported.validation_overridden, imported.candidate_matches, imported.validation_results], [null,null,null,null,false,[],[]]);
  check([Number(imported.evidence_revision), Number(imported.workflow_revision), imported.progress_extraction_revision], [0,0,null]);
  const retry = await rpc(payload, key);
  check([retry.imported_count, retry.duplicate_count, retry.replayed], [0,2,true]);
  check(retry.rows.map(r => [r.field_update_id, r.outcome]), initial.rows.map(r => [r.field_update_id,'duplicate']));
  await rejected(() => rpc([row('Changed payload')], key), /already used/);
  await rejected(() => rpc(payload, key, 'xlsx'), /already used/);
  const anotherUpload = await rpc(payload, randomUUID(), 'xlsx');
  check([anotherUpload.imported_count, anotherUpload.duplicate_count, anotherUpload.replayed], [0,2,false]);
  check(anotherUpload.rows.map(r => r.field_update_id), initial.rows.map(r => r.field_update_id));
  const within = await rpc([row('Duplicate inside file',2), row('Duplicate inside file',3)]);
  check([within.imported_count, within.duplicate_count], [1,1]);
  check(within.rows[0].field_update_id, within.rows[1].field_update_id);
  check(within.rows.map(r => r.outcome), ['imported','duplicate']);
  await actor('other'); const separateActor = await rpc(payload, key);
  check(separateActor.imported_count, 2);
  check((await db.query('select * from public.field_updates where id=$1', [reportId])).rows.length, 0);
  await actor('engineer'); check((await rpc([row('Engineer evidence')])).imported_count, 1);

  const beforeInvalid = await counts();
  const invalid = [
    null, [], 42, row('',2), row(' \t\n\u00a0',2), row('a'.repeat(10001)), row('bad\u0001text'),
    row('Narrative',2,{field_text:42}), row('Narrative',2,{site_location:[]}), row('Narrative',2,{reported_by:false}),
    row('Narrative',2,{reported_date:null}), row('Narrative',2,{reported_date:'2026-02-29'}),
    row('Narrative',2,{reported_date:'0000-01-01'}), row('Narrative',2,{reported_date:'11/10/2026'}),
    row('Narrative',2,{reported_date:'2026-10-11T00:00:00Z'}), row('Narrative',2,{discipline:'Mining'}),
    row('Narrative',2,{discipline:4}), row('Narrative',1), row('Narrative',1002), row('Narrative',2.5),
    { field_text:'Missing source number', reported_date:'2026-10-11' },
    ...['status','confidence_level','confidence_score','matched_activity_id','candidate_matches','submitted_by_user_id',
      'validation_status','validation_overridden','planner_remarks','audit_decision'].map(field => row('Forbidden input',2,{[field]:'injected'})),
  ];
  for (const bad of invalid) {
    await actor('site'); const summary = await rpc([row('Valid sibling',1000), bad]);
    check([summary.status, summary.imported_count, summary.duplicate_count, summary.error_count], ['rejected',0,0,1]);
    check(summary.rows, []); check(summary.errors.length > 0, true);
  }
  await actor('site'); check((await rpc([row('A',2),row('B',2)])).status, 'rejected');
  check(await counts(), beforeInvalid);
  for (const [rows, request, format] of [[[],randomUUID(),'csv'], [null,randomUUID(),'csv'], [{},randomUUID(),'csv'],
    [[row()],null,'csv'], [[row()],randomUUID(),'xls'], [Array.from({length:1001},(_,i)=>row(`Row ${i}`,i+2)),randomUUID(),'csv']]) {
    await actor('site'); await rejected(() => rpc(rows,request,format), /required|Import limit/);
  }
  await actor('site');
  await rejected(() => db.query(`select public.import_field_reports($1,'csv',jsonb_build_array(jsonb_build_object(
    'row_number',2,'field_text',repeat('x',16777217),'reported_date','2026-10-11')))`,[randomUUID()]), /Import limit/);
  const correctedKey = randomUUID();
  check((await rpc([row('',2)],correctedKey)).status,'rejected');
  check((await rpc([row('Corrected report',2)],correctedKey)).imported_count,1);
  check((await rpc([row('v',2,{reported_date:'0001-01-01'}),row('Ends in v',3,{reported_date:'9999-12-31'})])).imported_count,2);
  const maxBatch = await rpc(Array.from({length:1000},(_,i)=>row(`Boundary report ${i}`,i+2)));
  check([maxBatch.total_rows,maxBatch.imported_count], [1000,1000]);

  // Concurrent JS calls queue on ONE connection: tests retries, not MVCC waits.
  const queuedKey = randomUUID();
  const queued = await Promise.all(Array.from({length:4},()=>rpc([row('Queued retries')],queuedKey)));
  check(queued.reduce((n,r)=>n+r.imported_count,0),1);
  check(queued.reduce((n,r)=>n+r.duplicate_count,0),3);
  check(new Set(queued.map(r=>r.rows[0].field_update_id)).size,1);
  const crossKeys = await Promise.all(Array.from({length:4},()=>rpc([row('Queued cross-upload')] )));
  check(crossKeys.reduce((n,r)=>n+r.imported_count,0),1);
  check(crossKeys.reduce((n,r)=>n+r.duplicate_count,0),3);

  for (const role of ['site','engineer','planner','admin','anon','service_role']) {
    await actor(role);
    for (const tableName of ['field_report_import_batches','field_report_import_rows']) {
      await rejected(()=>db.query(`select * from public.${tableName}`), /permission denied/);
      await rejected(()=>db.query(`delete from public.${tableName}`), /permission denied/);
    }
    await rejected(()=>db.query('select public.protect_spreadsheet_field_update()'), /permission denied/);
  }
  await actor('owner');
  check((await db.query(`select count(*)::int as n from pg_class where relname in
    ('field_report_import_batches','field_report_import_rows') and relrowsecurity`)).rows[0].n,2);
  await rejected(()=>db.exec(`insert into public.field_report_import_rows select * from public.field_report_import_rows limit 1`), /duplicate key/);
  await actor('site');
  await rejected(()=>db.query(`insert into public.field_updates(field_text,submitted_by_user_id,source_type,status)
    values ('Bypass', $1,'spreadsheet_csv','pending')`,[users.site]), /secure import RPC/);
  const manual = (await db.query(`insert into public.field_updates(update_id,field_text,submitted_by_user_id,source_type,status,confidence_level)
    values ($1,'Ordinary manual report',$2,'manual_text','pending','Pending') returning *`, [randomUUID(),users.site])).rows[0];
  check(manual.discipline,null); check(manual.source_type,'manual_text');
  // Execute trigger checks as owner with authenticated JWT claims, independent
  // of whether site/planner UPDATE RLS would deny the operation first.
  await actor('owner'); await db.query("select set_config('request.jwt.claim.role','authenticated',false)");
  for (const [assignment,pattern] of [["discipline='Civil'",/discipline/], ["reported_by='Changed'",/reported_by/],
    ["field_text='Changed'",/field_text/], ["site_location='Changed'",/site_location/],
    ["reported_date='2026-10-10'",/reported_date/], ["source_type='manual_text'",/source_type/],
    ["update_id='Changed'",/update_id/], ["submitted_by_user_id=null",/submitted_by/]]) {
    await rejected(()=>db.query(`update public.field_updates set ${assignment} where id=$1`,[reportId]),pattern);
  }
  await rejected(()=>db.query('update public.field_updates set discipline=null where id=$1',[reportId]), /discipline/);
  await rejected(()=>db.query("update public.field_updates set discipline='Civil' where id=$1",[manual.id]), /discipline/);
  // Manual reporter behavior is intentionally not globally changed by 013.
  await db.query("update public.field_updates set reported_by='Manual correction' where id=$1",[manual.id]); checks++;
  await actor('service_role');
  await db.query("update public.field_updates set reported_by='Maintenance',discipline='Civil' where id=$1",[reportId]); checks++;
  await db.query("update public.field_updates set reported_by='R. Das',discipline='Piping' where id=$1",[reportId]);
  const completed = (await db.query(`select public.complete_field_update_processing($1,0,0,'match',$2::jsonb) as done`, [reportId,
    JSON.stringify({validation_status:'pass',validation_results:[],confidence_level:'High',confidence_score:0.9,
      matched_activity_id:'ACT-A',candidate_matches:[],expanded_text:'Worker evidence',matched_layer:'hybrid'})])).rows[0].done;
  check(completed,true);
  await actor('site'); await rpc(payload,key);
  const matched = (await db.query('select * from public.field_updates where id=$1',[reportId])).rows[0];
  check([matched.status,matched.confidence_level,matched.matched_activity_id],['pending','High','ACT-A']);
  check(Number(matched.evidence_revision),0);
  await actor('owner'); check((await db.query('select count(*)::int as n from public.planner_audit_logs')).rows[0].n,0);

  // Force failure on the SECOND fingerprint in the sorted lock order. Verify
  // that an already inserted sibling and both receipts roll back together.
  const texts = ['Rollback evidence A','Rollback evidence B'];
  const sorted = (await db.query(`select t from unnest($1::text[]) as t order by encode(sha256(convert_to(
    jsonb_build_array(t,null,'2026-10-11',null,null)::text,'UTF8')),'hex')`,[texts])).rows.map(r=>r.t);
  const beforeRollback = await counts(); const rollbackKey = randomUUID();
  await db.exec(`create function public.fixture_import_failure() returns trigger language plpgsql as $$
    begin if new.field_text='${sorted[1]}' then raise exception 'Fixture storage failure'; end if; return new; end $$;
    create trigger zz_fixture_import_failure before insert on public.field_updates for each row execute function public.fixture_import_failure();`);
  await actor('site');
  await rejected(()=>rpc(sorted.map((text,i)=>row(text,i+2)),rollbackKey),/Fixture storage failure/);
  check(await counts(),beforeRollback);
  await db.exec('drop trigger zz_fixture_import_failure on public.field_updates; drop function public.fixture_import_failure();');
  await actor('site'); check((await rpc(sorted.map((text,i)=>row(text,i+2)),rollbackKey)).imported_count,2);
  const version = (await db.query('show server_version')).rows[0].server_version;
  console.log(`PASS: ${checks} actual PostgreSQL ${version} SQL/security/rollback checks in disposable PGlite. No live DB. Multi-session MVCC concurrency NOT verified.`);
} finally { await db.close(); }
