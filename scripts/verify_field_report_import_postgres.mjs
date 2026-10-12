/** Real PG17 tests. Fixed isolated Docker target only; no env files/network client.
 * Run from D:\SETU-phase3: node scripts/verify_field_report_import_postgres.mjs
 * Creates a marked test fixture in setu_test, never resets/deletes existing data.
 * Existing fixtures are reusable only when their schema/migration digest matches.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const container = 'setu-phase3-pgtest';
const database = 'setu_test';
const runId = randomUUID();
const fixtureSchema = 'setu_pgtest_harness';
const names = ['005_auth_rls', '006_transactional_planner_governance', '007_security_hardening',
  '008_workflow_foundation', '009_worker_workflow_orchestration', '010_progress_events',
  '011_actuals_overlay', '012_field_report_intake', '013_secure_field_report_import'];
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const literal = value => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const jsonLiteral = value => `${literal(JSON.stringify(value))}::jsonb`;
let checks = 0; let scenarios = 0;
const check = (actual, expected, label = '') => { assert.deepEqual(actual, expected, label); checks++; };
async function reject(operation, code) {
  await assert.rejects(operation, error => error.code === code); checks++;
}
async function scenario(name, body) {
  try { await body(); scenarios++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); throw error; }
}

// Independent docker exec + persistent psql processes = independent PG backends.
// Merge psql stderr inside the container so errors precede the end marker.
class Session {
  constructor(name) {
    this.name = name; this.buffer = ''; this.tail = Promise.resolve(); this.pending = null;
    this.process = spawn('docker', ['exec', '-i', container, 'sh', '-c',
      `exec psql -X -qAt -P pager=off -v ON_ERROR_STOP=0 -v VERBOSITY=verbose -U "$POSTGRES_USER" -d ${database} 2>&1`],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', chunk => {
      this.buffer += chunk;
      while (this.buffer.includes('\n')) {
        const end = this.buffer.indexOf('\n'); const line = this.buffer.slice(0, end).replace(/\r$/, '');
        this.buffer = this.buffer.slice(end + 1);
        if (!this.pending) continue;
        if (line === this.pending.marker) {
          const { lines, resolve, reject: fail, timeout } = this.pending; this.pending = null; clearTimeout(timeout);
          const output = lines.join('\n'); const errorLine = output.match(/^(?:ERROR|FATAL):\s+([0-9A-Z]{5}):\s*(.*)$/m);
          if (errorLine) { const error = new Error(`${this.name}: ${errorLine[2]}`); error.code = errorLine[1]; fail(error); }
          else resolve(output);
        } else this.pending.lines.push(line);
      }
    });
    this.process.stderr.setEncoding('utf8');
    this.process.stderr.on('data', chunk => { this.dockerError = (this.dockerError ?? '') + chunk; });
    this.process.on('error', error => this.fail(error));
    this.process.on('exit', code => { this.exited = true; this.fail(new Error(`${name}: psql exited (${code}); ${this.dockerError ?? ''}`)); });
  }
  fail(error) { if (this.pending) { clearTimeout(this.pending.timeout); this.pending.reject(error); this.pending = null; } }
  exec(sql) {
    const result = this.tail.then(() => new Promise((resolve, reject) => {
      if (this.exited) return reject(new Error(`${this.name}: session already exited`));
      const marker = `SETU_END_${randomUUID()}`;
      const timeout = setTimeout(() => { this.fail(new Error(`${this.name}: harness command deadline`)); this.process.kill(); }, 45000);
      this.pending = { marker, timeout, resolve, reject, lines: [] };
      this.process.stdin.write(`${sql}\n;\n\\echo ${marker}\n`);
    }));
    this.tail = result.catch(() => {}); return result;
  }
  async json(expression) {
    const prefix = `SETU_JSON_${randomUUID()}:`;
    const output = await this.exec(`select ${literal(prefix)} || (${expression})::text`);
    const matches = output.split('\n').filter(line => line.startsWith(prefix));
    assert.equal(matches.length, 1, `${this.name}: expected one JSON result; ${output}`);
    return JSON.parse(matches[0].slice(prefix.length));
  }
  async close() { if (!this.exited) this.process.stdin.end('ROLLBACK;\n\\q\n'); }
}

const users = Object.fromEntries(['site', 'engineer', 'planner', 'admin', 'other', 'unassigned'].map(name => [name, randomUUID()]));
async function actor(session, name, jwtRole) {
  const role = ['anon', 'service_role'].includes(name) ? name : name === 'owner' ? null : 'authenticated';
  await session.exec(`reset role; select set_config('request.jwt.claim.sub', ${literal(users[name] ?? '')}, false);
    select set_config('request.jwt.claim.role', ${literal(jwtRole ?? role ?? '')}, false);
    ${role ? `set role ${role};` : ''}`);
}
const row = (text, number = 2, changes = {}) => ({ row_number: number, field_text: `${runId} ${text}`,
  reported_date: '2026-10-12', site_location: null, reported_by: null, discipline: null, ...changes });
const rpc = (session, rows, key = randomUUID(), format = 'csv') => session.json(
  `public.import_field_reports(${literal(key)}::uuid, ${literal(format)}, ${jsonLiteral(rows)})`);

const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
assert.equal(projectRoot.toLowerCase().replaceAll('\\','/').replace(/\/$/, ''), 'd:/setu-phase3', 'Worktree must be D:\\SETU-phase3');
assert.equal((await realpath(process.cwd())).toLowerCase(), projectRoot.toLowerCase(), 'Run only from this worktree root');
const inspected = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', container], { encoding: 'utf8', windowsHide: true });
if (inspected.status !== 0 || inspected.stdout.trim() !== 'true') throw new Error('Isolated test container unavailable; STOP. No fixture changes.');

const sessions = ['observer', 'import-A', 'import-B'].map(name => new Session(name));
const [observer, a, b] = sessions;
let fixtureReady = false; const createdTriggers = [];
async function counts() {
  return observer.json(`jsonb_build_object('reports',(select count(*) from public.field_updates),
    'rows',(select count(*) from public.field_report_import_rows),'batches',(select count(*) from public.field_report_import_batches),
    'audits',(select count(*) from public.planner_audit_logs))`);
}
async function invariants() {
  const state = await observer.json(`jsonb_build_object(
    'orphan_rows',(select count(*) from public.field_report_import_rows r left join public.field_updates u on u.id=r.field_update_id where u.id is null),
    'unfinished_batches',(select count(*) from public.field_report_import_batches where summary is null),
    'duplicate_fingerprints',(select count(*) from (select actor_user_id,fingerprint from public.field_report_import_rows group by 1,2 having count(*)>1) q))`);
  check(state, { orphan_rows: 0, unfinished_batches: 0, duplicate_fingerprints: 0 });
}
async function waitBlocked(waiter, blocker) {
  const start = Date.now();
  while (Date.now() - start < 12000) {
    const state = await observer.json(`jsonb_build_object('blocked', ${blocker}=any(pg_blocking_pids(${waiter})),
      'wait', (select wait_event_type from pg_stat_activity where pid=${waiter}))`);
    if (state.blocked) { check(state.wait, 'Lock'); checks++; return; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Backend ${waiter} never demonstrably blocked on ${blocker}`);
}
async function trigger(name, body, text = '') {
  // Helper objects are test-only, never edits to a production function/migration.
  await observer.exec(`create function ${fixtureSchema}.${name}() returns trigger language plpgsql as $$ begin ${body} return new; end $$;
    create trigger ${name} before insert on public.field_updates for each row execute function ${fixtureSchema}.${name}(${literal(text)});`);
  createdTriggers.push(name);
}
async function removeTrigger(name) {
  await observer.exec(`drop trigger ${name} on public.field_updates; drop function ${fixtureSchema}.${name}()`);
  createdTriggers.splice(createdTriggers.indexOf(name),1);
}

try {
  const runtime = await observer.json(`jsonb_build_object('database', current_database(), 'version', current_setting('server_version'),
    'major', current_setting('server_version_num')::int / 10000, 'superuser',(select rolsuper from pg_roles where rolname=current_user))`);
  check(runtime.database, database); check(runtime.major,17); check(runtime.superuser,true);
  console.log(`TARGET ${container}/${database} PostgreSQL ${runtime.version}`);
  const schema = await read('database/schema.sql'); const migrations = await Promise.all(names.map(n => read(`database/migrations/${n}.sql`)));
  const digest = createHash('sha256').update('docker-fixture-v1').update(schema).update(migrations.join('\n')).digest('hex');
  const exists = await observer.json(`to_jsonb(to_regclass('${fixtureSchema}.fixture') is not null)`);
  if (exists) {
    check(await observer.json(`(select to_jsonb(digest) from ${fixtureSchema}.fixture where singleton)`), digest, 'Existing fixture digest mismatch: stop, do not modify schema');
    console.log('FIXTURE reused (matching migration/schema digest)');
  } else {
    const objects = await observer.json(`jsonb_build_object('relations',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'),
      'auth_roles',(select count(*) from pg_roles where rolname in ('anon','authenticated','service_role')),
      'schemas',(select count(*) from pg_namespace where nspname not like 'pg_%' and nspname not in ('public','information_schema')))`);
    check(objects,{ relations:0,auth_roles:0,schemas:0 }, 'Unmarked database must be empty; no destructive reset permitted');
    const table = name => { const match = schema.match(new RegExp(`create table if not exists ${name} \\([\\s\\S]*?\\n\\);`)); assert.ok(match,name); return match[0]; };
    await observer.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema extensions; create table auth.users(id uuid primary key);
      grant usage on schema auth,public to anon,authenticated,service_role;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select current_setting('request.jwt.claim.role',true) $$;
      create table public.schedule_activities(id uuid primary key default gen_random_uuid(), activity_id text unique not null,
        activity_name text,wbs_code text,wbs_name text,discipline text,planned_start_date date,planned_finish_date date);
      ${table('domain_aliases')} ${table('field_updates')} ${table('planner_audit_logs')}
      create domain public.vector as double precision[];
      create function public.match_schedule_activities(vector,double precision,integer) returns integer language sql as $$ select 0 $$;`);
    for (let i = 0; i < names.length; i++) { await observer.exec(migrations[i]); console.log(`MIGRATION ${names[i]} applied unchanged to isolated fixture`); }
    await observer.exec(`create schema ${fixtureSchema}; create table ${fixtureSchema}.fixture(singleton boolean primary key check(singleton),digest text not null);
      insert into ${fixtureSchema}.fixture values (true,${literal(digest)})`);
  }
  fixtureReady = true;
  for (const [name,id] of Object.entries(users)) {
    await observer.exec(`insert into auth.users values (${literal(id)});
      ${name !== 'unassigned' ? `insert into public.user_roles(user_id,role) values (${literal(id)},${literal(name === 'other' ? 'site' : name)});` : ''}`);
  }
  for (const s of sessions) await s.exec(`set statement_timeout='30s'; set lock_timeout='15s'; set idle_in_transaction_session_timeout='40s'; set default_transaction_isolation='read committed'`);
  const pids = await Promise.all(sessions.map(s => s.json('to_jsonb(pg_backend_pid())')));
  check(new Set(pids).size,3); console.log(`SESSIONS observer=${pids[0]} A=${pids[1]} B=${pids[2]} (independent backends)`);
  await actor(a,'site'); await actor(b,'site');
  const deadlocksBefore = await observer.json(`(select to_jsonb(deadlocks) from pg_stat_database where datname='${database}')`);

  await scenario('same UUID concurrent retry waits for commit; one receipt/report', async () => {
    const before = await counts(); const key = randomUUID(); const payload = [row('same key')];
    await a.exec('begin'); const first = await rpc(a,payload,key);
    const pending = rpc(b,payload,key); pending.catch(() => {});
    await waitBlocked(pids[2],pids[1]); await a.exec('commit'); const second = await pending;
    check([first.imported_count,second.imported_count,second.duplicate_count,second.replayed],[1,0,1,true]);
    check(first.rows[0].field_update_id,second.rows[0].field_update_id);
    const after = await counts(); check([after.reports-before.reports,after.rows-before.rows,after.batches-before.batches],[1,1,1]); await invariants();
  });
  await scenario('different UUID concurrent uploads deduplicate same canonical report', async () => {
    const before = await counts(); const payload = [row('cross key')];
    await a.exec('begin'); const first = await rpc(a,payload);
    const pending = rpc(b,payload,randomUUID(),'xlsx'); pending.catch(() => {});
    await waitBlocked(pids[2],pids[1]); await a.exec('commit'); const second = await pending;
    check([first.imported_count,second.imported_count,second.duplicate_count,second.replayed],[1,0,1,false]);
    check(first.rows[0].field_update_id,second.rows[0].field_update_id);
    const after = await counts(); check([after.reports-before.reports,after.rows-before.rows,after.batches-before.batches],[1,1,2]); await invariants();
  });
  await scenario('concurrent conflicting UUID reuse rejects loser with 22023', async () => {
    const before = await counts(); const key = randomUUID();
    await a.exec('begin'); await rpc(a,[row('conflict original')],key);
    const pending = rpc(b,[row('conflict different')],key); pending.catch(() => {});
    await waitBlocked(pids[2],pids[1]); await a.exec('commit'); await reject(() => pending,'22023');
    await reject(() => rpc(b,[row('conflict original')],key,'xlsx'),'22023');
    const after = await counts(); check([after.reports-before.reports,after.rows-before.rows,after.batches-before.batches],[1,1,1]); await invariants();
  });
  await scenario('waiting same-key contender succeeds after first transaction rollback', async () => {
    const before = await counts(); const key = randomUUID(); const payload = [row('rolled back contender')];
    await a.exec('begin'); const discarded = await rpc(a,payload,key);
    const pending = rpc(b,payload,key); pending.catch(() => {});
    await waitBlocked(pids[2],pids[1]); await a.exec('rollback'); const winner = await pending;
    check([winner.imported_count,winner.duplicate_count,winner.replayed],[1,0,false]);
    check(winner.rows[0].field_update_id !== discarded.rows[0].field_update_id,true);
    const after = await counts(); check([after.reports-before.reports,after.rows-before.rows,after.batches-before.batches],[1,1,1]); await invariants();
  });
  await scenario('opposite-order batches overlap after first reservation without deadlock', async () => {
    const before = await counts(); const payload = [row('opposite A',2),row('opposite B',3)];
    const firstText = await observer.json(`(select to_jsonb(value->>'field_text') from jsonb_array_elements(${jsonLiteral(payload)})
      order by encode(sha256(convert_to(jsonb_build_array(value->>'field_text',null,'2026-10-12',null,null)::text,'UTF8')),'hex') limit 1)`);
    const lockKey = 7313013;
    await trigger('fixture_pause_import', `if new.field_text = tg_argv[0] then perform pg_advisory_xact_lock(${lockKey}); end if;`,firstText);
    await observer.exec(`select pg_advisory_lock(${lockKey})`);
    const firstPending = rpc(a,payload); firstPending.catch(() => {});
    await waitBlocked(pids[1],pids[0]);
    const secondPending = rpc(b,[{...payload[1],row_number:2},{...payload[0],row_number:3}]); secondPending.catch(() => {});
    await waitBlocked(pids[2],pids[1]); await observer.exec(`select pg_advisory_unlock(${lockKey})`);
    const [first,second] = await Promise.all([firstPending,secondPending]);
    check([first.imported_count,second.imported_count,second.duplicate_count],[2,0,2]);
    check(first.rows.map(r=>r.field_update_id).sort(),second.rows.map(r=>r.field_update_id).sort());
    const after = await counts(); check([after.reports-before.reports,after.rows-before.rows,after.batches-before.batches],[2,2,2]);
    await removeTrigger('fixture_pause_import'); await invariants();
  });

  await scenario('authorization, own-row RLS, grants and helper isolation', async () => {
    const before = await counts();
    for (const role of ['anon','service_role','planner','admin','unassigned']) { await actor(a,role); await reject(()=>rpc(a,[row('unauthorized')]),'42501'); }
    await actor(a,'site',''); await reject(()=>rpc(a,[row('missing jwt role')]),'42501');
    await actor(a,'site'); await a.exec("select set_config('request.jwt.claim.sub','',false)"); await reject(()=>rpc(a,[row('missing uid')]),'42501');
    check(await counts(),before);
    await actor(a,'site'); const site = await rpc(a,[row('shared actors')]);
    await actor(b,'other'); const other = await rpc(b,[row('shared actors')]);
    check(other.imported_count,1); check(site.rows[0].field_update_id !== other.rows[0].field_update_id,true);
    check(await b.json(`(select to_jsonb(count(*)) from public.field_updates where id=${literal(site.rows[0].field_update_id)})`),0);
    await actor(a,'engineer'); check((await rpc(a,[row('engineer')])).imported_count,1);
    for (const role of ['site','engineer','planner','admin','anon','service_role']) {
      await actor(a,role);
      for (const table of ['field_report_import_batches','field_report_import_rows']) {
        await reject(()=>a.exec(`select * from public.${table}`),'42501');
        await reject(()=>a.exec(`delete from public.${table}`),'42501');
        check(await observer.json(`to_jsonb(has_table_privilege(${literal(['site','engineer','planner','admin'].includes(role) ? 'authenticated' : role)},
          'public.${table}', 'SELECT,INSERT,UPDATE,DELETE'))`),false);
      }
      await reject(()=>a.exec('select public.protect_spreadsheet_field_update()'),'42501');
    }
    const privileges = await observer.json(`(select jsonb_build_object('security_definer',prosecdef,'config',proconfig,
      'anon',has_function_privilege('anon',oid,'execute'),'auth',has_function_privilege('authenticated',oid,'execute'),
      'service',has_function_privilege('service_role',oid,'execute')) from pg_proc where proname='import_field_reports')`);
    check([privileges.security_definer,privileges.anon,privileges.auth,privileges.service],[true,false,true,false]);
    check(privileges.config.some(v=>v.replaceAll('"','')==='search_path='),true);
    check(await observer.json(`(select to_jsonb(count(*)) from pg_class where relname in ('field_report_import_batches','field_report_import_rows') and relrowsecurity)`),2);
    await actor(a,'site'); await actor(b,'site');
  });
  await scenario('invalid rows/envelopes are atomic; corrected rejected key reusable', async () => {
    const before = await counts();
    const badRows = [null, [], 42, row('blank',2,{field_text:''}),row('spaces',2,{field_text:' \t\u00a0'}),
      row('type',2,{field_text:42}),row('type',2,{site_location:[]}),row('type',2,{reported_by:false}),
      row('control',2,{field_text:'bad\u0001text'}),row('length',2,{field_text:'a'.repeat(10001)}),
      row('date',2,{reported_date:null}),row('date',2,{reported_date:'2026-02-29'}),row('date',2,{reported_date:'0000-01-01'}),
      row('date',2,{reported_date:'12/10/2026'}),row('date',2,{reported_date:'2026-10-12T00:00:00Z'}),
      row('discipline',2,{discipline:'Mining'}),row('discipline',2,{discipline:4}),row('number',1),row('number',1002),row('number',2.5),
      ...['status','confidence_score','matched_activity_id','submitted_by_user_id','validation_overridden','audit_decision'].map(k=>row('forbidden',2,{[k]:'injected'}))];
    for (const bad of badRows) {
      const result = await rpc(a,[row('valid sibling',1000),bad]);
      check([result.status,result.imported_count,result.duplicate_count,result.error_count],['rejected',0,0,1]);
      check(result.rows,[]); check(result.errors.length>0,true); check(await counts(),before);
    }
    check((await rpc(a,[row('numbers A',2),row('numbers B',2)])).status,'rejected');
    for (const [rows,key,format] of [[[],randomUUID(),'csv'],[null,randomUUID(),'csv'],[{},randomUUID(),'csv'],[[row('key')],null,'csv'],[[row('format')],randomUUID(),'xls'],[Array.from({length:1001},(_,i)=>row(`limit ${i}`,i+2)),randomUUID(),'csv']]) {
      await reject(()=>rpc(a,rows,key,format),'22023'); check(await counts(),before);
    }
    await reject(()=>a.json(`public.import_field_reports('${randomUUID()}'::uuid,'csv',jsonb_build_array(jsonb_build_object('row_number',2,'field_text',repeat('x',16777217),'reported_date','2026-10-12')))`),'22023');
    check(await counts(),before);
    const key = randomUUID(); check((await rpc(a,[row('invalid',2,{field_text:''})],key)).status,'rejected');
    check((await rpc(a,[row('corrected rejected')],key)).imported_count,1); await invariants();
  });
  await scenario('pipeline defaults, duplicates, boundary dates and original immutability', async () => {
    const payload = [row('original',2,{discipline:' piping ',reported_by:' R. Das '})]; const key = randomUUID();
    const initial = await rpc(a,payload,key); const id = initial.rows[0].field_update_id;
    const saved = await a.json(`(select to_jsonb(u) from public.field_updates u where id=${literal(id)})`);
    check([saved.submitted_by_user_id,saved.source_type,saved.status,saved.confidence_level,saved.discipline,saved.reported_by],
      [users.site,'spreadsheet_csv','pending','Pending','Piping','R. Das']);
    check([saved.matched_activity_id,saved.validation_status,saved.validation_results,saved.validation_overridden,saved.candidate_matches,
      saved.evidence_revision,saved.workflow_revision,saved.progress_extraction_revision],[null,null,[],false,[],0,0,null]);
    const replay = await rpc(a,payload,key); check([replay.imported_count,replay.duplicate_count,replay.replayed],[0,1,true]);
    const across = await rpc(a,[row('original',2,{discipline:'Piping',reported_by:'R. Das'})],randomUUID(),'xlsx');
    check([across.imported_count,across.duplicate_count],[0,1]); check(across.rows[0].field_update_id,id);
    const repeated = await rpc(a,[row('inside file',2),row('inside file',3)]); check([repeated.imported_count,repeated.duplicate_count],[1,1]);
    check(repeated.rows.map(r=>r.outcome),['imported','duplicate']);
    check((await rpc(a,[row('ancient',2,{reported_date:'0001-01-01'}),row('future',3,{reported_date:'9999-12-31'})])).imported_count,2);
    await reject(()=>a.exec(`insert into public.field_updates(field_text,submitted_by_user_id,source_type,status) values ('Bypass',${literal(users.site)},'spreadsheet_csv','pending')`),'42501');
    // Owner executes triggers with non-service JWT to isolate trigger protection
    // from the ordinary browser UPDATE grant denial (which is also checked).
    await reject(()=>a.exec(`update public.field_updates set discipline='Civil' where id=${literal(id)}`),'42501');
    await actor(observer,'owner','authenticated');
    for (const assignment of ["field_text='Changed'","site_location='Changed'","reported_date='2026-10-10'","reported_by='Changed'",
      "discipline='Civil'",'discipline=null',"source_type='manual_text'","update_id='Changed'",'submitted_by_user_id=null']) {
      await reject(()=>observer.exec(`update public.field_updates set ${assignment} where id=${literal(id)}`),'P0001');
    }
    check(await observer.json(`(select to_jsonb(u) from public.field_updates u where id=${literal(id)})`),saved);
    const nullable = await rpc(a,[row('nullable discipline')]);
    await reject(()=>observer.exec(`update public.field_updates set discipline='Civil' where id=${literal(nullable.rows[0].field_update_id)}`),'P0001');
    check(await observer.json(`(select jsonb_build_array(discipline) from public.field_updates where id=${literal(nullable.rows[0].field_update_id)})`),[null]);
    await actor(a,'service_role'); await a.exec(`update public.field_updates set discipline='Civil',reported_by='Maintenance' where id=${literal(id)}`);
    check(await observer.json(`(select jsonb_build_array(discipline,reported_by) from public.field_updates where id=${literal(id)})`),['Civil','Maintenance']);
    await a.exec(`update public.field_updates set discipline='Piping',reported_by='R. Das' where id=${literal(id)}`);
    await actor(a,'site'); await actor(observer,'owner'); await invariants();
  });
  await scenario('forced second-row storage failure rolls back reports and both ledgers', async () => {
    const before = await counts(); const payload = [row('storage A',2),row('storage B',3)]; const key = randomUUID();
    const secondText = await observer.json(`(select to_jsonb(value->>'field_text') from jsonb_array_elements(${jsonLiteral(payload)})
      order by encode(sha256(convert_to(jsonb_build_array(value->>'field_text',null,'2026-10-12',null,null)::text,'UTF8')),'hex') offset 1 limit 1)`);
    await trigger('fixture_fail_import', "if new.field_text=tg_argv[0] then raise exception 'Forced second-row storage failure'; end if;",secondText);
    await reject(()=>rpc(a,payload,key),'P0001'); check(await counts(),before); await invariants();
    await removeTrigger('fixture_fail_import'); const retried = await rpc(a,payload,key);
    check([retried.imported_count,retried.duplicate_count,retried.replayed],[2,0,false]); await invariants();
  });
  await scenario('no planner decisions, no deadlocks and submission gate still off', async () => {
    check(await observer.json(`(select to_jsonb(count(*)) from public.planner_audit_logs)`),0);
    check(await observer.json(`(select to_jsonb(deadlocks) from pg_stat_database where datname='${database}')`),deadlocksBefore);
    const gate = await read('frontend/src/lib/fieldReportImportDeployment.ts');
    for (const flag of ['migration012Verified','migration013Verified','submissionEnabled']) check(new RegExp(`${flag}: false`).test(gate),true);
    await invariants();
    // Evidence that even a test run never rewrote the input SQL files.
    const afterMigrations = await Promise.all(names.map(n=>read(`database/migrations/${n}.sql`)));
    check(afterMigrations,migrations,'Production migration source changed during verification');
  });
  console.log(`RESULT ${scenarios} scenarios / ${checks} assertions passed; 0 failures. Real PostgreSQL ${runtime.version}; actual lock waits verified. Run ${runId}.`);
  console.log('FIXTURE retained in the isolated test database for inspection/reuse. No production migrations or frontend gate changed.');
} catch (error) {
  console.error(`RESULT FAILED after ${scenarios} passed scenarios / ${checks} assertions: ${error.message}`);
  process.exitCode = 1;
} finally {
  // Release only this harness's session locks/transactions and named helpers.
  // Do not reset/drop schemas, roles, reports, receipts, database or container.
  await Promise.allSettled([a.exec('rollback'),b.exec('rollback'),observer.exec('rollback; select pg_advisory_unlock_all()')]);
  if (fixtureReady) for (const name of [...createdTriggers]) {
    try { await removeTrigger(name); } catch (error) { console.error(`TEST HELPER CLEANUP FAILED ${name}: ${error.message}`); process.exitCode = 1; }
  }
  await Promise.all(sessions.map(s=>s.close()));
}
