/** Executes actual 011 SQL on the disposable 005–010 fixture; no network. */
import assert from 'node:assert/strict';

export async function verifyActualsOverlay({ db, read, actor, rpc, report, users }) {
  let checks = 0;
  const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const denied = async op => { await assert.rejects(op, /permission denied|cannot (insert into|update|delete from) view/); checks++; };
  const server = async () => { await actor('owner'); await db.exec('set role service_role'); };
  await actor('owner');
  // Only extend the old minimal *disposable fixture* baseline. Production 011
  // never alters baseline columns. Types below match database/schema.sql.
  await db.exec(`alter table public.schedule_activities
    add column activity_name text, add column wbs_code text, add column wbs_name text,
    add column discipline text, add column planned_start_date date, add column planned_finish_date date;`);
  const activity = async name => {
    await actor('owner');
    const id = `P2-${name}`;
    await db.query(`insert into public.schedule_activities
      (activity_id, activity_name, wbs_code, wbs_name, discipline, planned_start_date, planned_finish_date)
      values ($1,$2,'1.2','Pipeline','Piping','2026-09-01','2026-10-01')`, [id, name]);
    return id;
  };
  const newReport = async (target, options = {}) => {
    await actor('owner');
    return (await db.query(`insert into public.field_updates
      (update_id,field_text,source_type,submitted_by_user_id,matched_activity_id,
       confidence_level,validation_status,reported_date,created_at)
      values (gen_random_uuid()::text,'Phase 2 actual evidence','manual_text',$1,$2,'High',$3,$4,$5) returning id`,
    [users.site, target, options.validation ?? 'pass', options.date === undefined ? '2026-10-03' : options.date,
      options.created ?? '2026-10-03T10:00:00Z'])).rows[0].id;
  };
  const event = (type, date, percentage = null) => ({ event_index: 0, event_type: type,
    event_date: date, progress_percent: percentage, evidence_text: `Explicit ${type} evidence`,
    extraction_reason: 'Phase 2 fixture: explicit source event', extraction_version: 'phase1_rules_v1' });
  const extract = async (id, events) => {
    const current = await report(id); await server();
    check((await rpc('complete_field_update_progress_extraction', [id, current.evidence_revision,
      JSON.stringify(events.map((e, index) => ({ ...e, event_index: index })))]))
      .complete_field_update_progress_extraction, true);
  };
  const accept = async (id, who = 'planner') => {
    const current = await report(id); await actor(who);
    await rpc('accept_current_field_update', [id, 'Reviewed actual evidence', current.workflow_revision]);
  };
  const evidence = async id => {
    await actor('planner');
    return (await db.query('select * from public.schedule_actuals_evidence where field_update_id=$1 order by event_index', [id])).rows;
  };
  const overlay = async id => {
    await actor('planner');
    return (await db.query('select * from public.schedule_actuals_overlay where activity_id=$1', [id])).rows[0];
  };
  const terminal = async (target, events, options = {}) => {
    const id = await newReport(target, options); await extract(id, events); await accept(id); return id;
  };
  const emptyActivity = await activity('EMPTY');
  const baselineBefore = (await db.query('select * from public.schedule_activities order by activity_id')).rows;
  await db.exec(await read('database/migrations/011_actuals_overlay.sql'));
  const version = (await db.query('show server_version')).rows[0].server_version;

  const target = await activity('ELIGIBILITY');
  const approved = await terminal(target, [event('START', '2026-10-03')]);
  const approvedEvidence = await evidence(approved);
  check(approvedEvidence.length, 1);
  check(approvedEvidence[0].decision_actor_user_id, users.planner);
  check(approvedEvidence[0].decision_action, 'accept');
  check(approvedEvidence[0].activity_id, target);
  check(Number(approvedEvidence[0].evidence_revision), 0);
  check(approvedEvidence[0].evidence_text, 'Explicit START evidence');
  check(approvedEvidence[0].finalized_remap_proposal_id, null);
  check((await overlay(target)).selected_start_event_id, approvedEvidence[0].event_id);
  await actor('owner');
  const audit = (await db.query('select * from public.planner_audit_logs where id=$1', [approvedEvidence[0].decision_audit_id])).rows[0];
  check(audit.metadata.evidence_revision, 0); check(audit.metadata.workflow_revision, 1);
  check(audit.new_activity_id, target); check(audit.created_at, approvedEvidence[0].decision_at);

  const pending = await newReport(target); await extract(pending, [event('START', '2026-10-01')]);
  check((await evidence(pending)).length, 0);
  await actor('planner'); await rpc('close_field_update_as_invalid', [pending, 'Wrong context', 0]);
  check((await evidence(pending)).length, 0);
  const rejected = await newReport(target); await extract(rejected, [event('START', '2026-10-01')]);
  await actor('planner'); await rpc('review_field_update', [rejected, 'reject']);
  check((await evidence(rejected)).length, 0);

  for (const mutation of [
    'evidence_revision=1,validation_evidence_revision=1', // old history + behind marker
    'progress_extraction_revision=null',
    'matched_activity_id=null',
    "matched_activity_id='ACT-B'", // audit target mismatch
    'workflow_revision=workflow_revision+1',
    'validation_status=null',
    "validation_status='block'", // absent scoped override
  ]) {
    const id = await terminal(target, [event('START', '2026-10-03')]);
    await actor('owner'); await db.query(`update public.field_updates set ${mutation} where id=$1`, [id]);
    check((await evidence(id)).length, 0);
  }
  // Isolate validation freshness: every other gate is eligible at revision 1.
  const currentValidationTarget = await activity('CURRENT-VALIDATION');
  const currentValidation = await newReport(currentValidationTarget);
  await extract(currentValidation, [event('START', '2026-10-01')]);
  await actor('planner');
  await rpc('resolve_field_update_clarification_now', [currentValidation, 'Confirm start date',
    'call', 'Started on October 5', 'Site engineer', 'validation_inputs_changed', 0]);
  const revisionOne = await report(currentValidation);
  check(Number(revisionOne.evidence_revision), 1);
  await server();
  check((await rpc('complete_field_update_processing', [currentValidation,
    revisionOne.workflow_revision, revisionOne.evidence_revision, 'revalidate',
    JSON.stringify({ validation_status: 'pass', validation_results: [] })]))
    .complete_field_update_processing, true);
  await extract(currentValidation, [event('START', '2026-10-05')]);
  await accept(currentValidation);
  const currentEvidence = await evidence(currentValidation);
  check(currentEvidence.length, 1); check(Number(currentEvidence[0].evidence_revision), 1);
  check(Number((await overlay(currentValidationTarget)).contributing_event_count), 1);
  await actor('owner');
  check((await db.query('select count(*)::int as n from public.progress_events where field_update_id=$1',
    [currentValidation])).rows[0].n, 2); // old revision stays auditable
  await db.query('update public.field_updates set validation_evidence_revision=0 where id=$1', [currentValidation]);
  check((await evidence(currentValidation)).length, 0);
  check(Number((await overlay(currentValidationTarget)).contributing_event_count), 0);
  await actor('owner');
  await db.query('update public.field_updates set validation_evidence_revision=1 where id=$1', [currentValidation]);
  check((await evidence(currentValidation))[0].event_id, currentEvidence[0].event_id);
  check(Number((await overlay(currentValidationTarget)).contributing_event_count), 1);
  // Current events and extraction marker still cannot substitute for fresh audit.
  const staleAudit = await terminal(target, [event('START', '2026-10-03')]);
  await actor('owner'); await db.query('update public.field_updates set evidence_revision=1,validation_evidence_revision=1 where id=$1', [staleAudit]);
  await extract(staleAudit, [event('START', '2026-10-04')]);
  check((await evidence(staleAudit)).length, 0);
  const legacyApproval = await newReport(target); await extract(legacyApproval, [event('START', '2026-10-03')]);
  await actor('owner'); await db.query("update public.field_updates set status='approved' where id=$1", [legacyApproval]);
  check((await evidence(legacyApproval)).length, 0);
  await actor('owner');
  await db.query(`insert into public.planner_audit_logs(field_update_id,action,new_activity_id,planner_name,metadata)
    values ($1,'accept',$2,'Legacy Planner','{}')`, [legacyApproval, target]);
  check((await evidence(legacyApproval)).length, 0);
  const unknown = await terminal(target, [event('UNKNOWN', null)]);
  check((await evidence(unknown)).length, 0);
  const warn = await terminal(target, [event('START', '2026-10-03')], { validation: 'warn' });
  check((await evidence(warn)).length, 1);
  const blocked = await newReport(target, { validation: 'block' }); await extract(blocked, [event('START', '2026-10-03')]);
  await actor('planner'); await rpc('override_current_field_update_validation', [blocked, 'Governed reason', 0]);
  await accept(blocked); check((await evidence(blocked)).length, 1);
  await actor('owner'); await db.query("update public.field_updates set override_activity_id='ACT-B' where id=$1", [blocked]);
  check((await evidence(blocked)).length, 0);

  const remapTarget = await activity('REMAP');
  const remap = await newReport('ACT-A'); await extract(remap, [event('FINISH', '2026-10-03')]);
  await actor('planner'); const proposal = await rpc('propose_field_update_remap', [remap, remapTarget, 0]);
  check((await evidence(remap)).length, 0); // proposal alone never contributes
  await server();
  check((await rpc('complete_field_update_remap_validation', [proposal.id, proposal.target_activity_id,
    proposal.workflow_revision, proposal.evidence_revision, proposal.validation_generation,
    JSON.stringify({ validation_status: 'pass', validation_results: [] })])).complete_field_update_remap_validation, true);
  check((await evidence(remap)).length, 0); // validated, not finalized
  const beforeFinalize = await report(remap); await actor('planner');
  await rpc('finalize_field_update_remap', [proposal.id, 'Target reviewed', beforeFinalize.workflow_revision]);
  const remappedEvidence = await evidence(remap);
  check(remappedEvidence.length, 1); check(remappedEvidence[0].activity_id, remapTarget);
  check(remappedEvidence[0].finalized_remap_proposal_id, proposal.id);
  check(remappedEvidence[0].decision_action, 'remap');
  check((await overlay(remapTarget)).selected_finish_event_id, remappedEvidence[0].event_id);
  await actor('owner');
  check((await db.query('select count(*)::int as n from public.schedule_actuals_evidence where field_update_id=$1 and activity_id=$2', [remap, 'ACT-A'])).rows[0].n, 0);
  const legacyRemap = await newReport('ACT-A'); await extract(legacyRemap, [event('START', '2026-10-03')]);
  await actor('planner'); await rpc('review_field_update', [legacyRemap, 'remap', remapTarget]);
  check((await evidence(legacyRemap)).length, 0);

  // Blocked selected-target validation contributes only after governed override
  // and finalization, never because the old target happened to pass validation.
  const blockedRemapTarget = await activity('BLOCKED-REMAP');
  const blockedRemap = await newReport('ACT-A');
  await extract(blockedRemap, [event('START', '2026-10-03')]);
  await actor('planner');
  const blockedProposal = await rpc('propose_field_update_remap', [blockedRemap, blockedRemapTarget, 0]);
  await server();
  check((await rpc('complete_field_update_remap_validation', [blockedProposal.id, blockedProposal.target_activity_id,
    blockedProposal.workflow_revision, blockedProposal.evidence_revision, blockedProposal.validation_generation,
    JSON.stringify({ validation_status: 'block', validation_results: [] })])).complete_field_update_remap_validation, true);
  check((await evidence(blockedRemap)).length, 0);
  const beforeOverride = await report(blockedRemap); await actor('planner');
  await rpc('override_field_update_remap_proposal', [blockedProposal.id, 'Current target reviewed', beforeOverride.workflow_revision]);
  check((await evidence(blockedRemap)).length, 0);
  const overriddenParent = await report(blockedRemap); await actor('planner');
  await rpc('finalize_field_update_remap', [blockedProposal.id, 'Governed target decision', overriddenParent.workflow_revision]);
  check((await evidence(blockedRemap)).length, 1);
  check((await evidence(blockedRemap))[0].finalized_remap_proposal_id, blockedProposal.id);

  const dates = await activity('DATES');
  const datesId = await terminal(dates, [event('START', '2026-10-03'), event('START', '2026-10-01'),
    event('FINISH', '2026-10-05'), event('FINISH', '2026-10-07')]);
  const datesRow = await overlay(dates); const datesEvents = await evidence(datesId);
  check(datesRow.actual_start.toISOString().slice(0, 10), '2026-10-01');
  check(datesRow.actual_finish.toISOString().slice(0, 10), '2026-10-07');
  check(datesRow.multiple_start_dates, true); check(datesRow.multiple_finish_dates, true);
  check(datesRow.progress_percent, null);
  check(datesRow.planned_start_date.toISOString().slice(0, 10), '2026-09-01');
  check(datesRow.planned_finish_date.toISOString().slice(0, 10), '2026-10-01');
  check(datesRow.selected_start_event_id, datesEvents[1].event_id);
  check(datesRow.selected_finish_event_id, datesEvents[3].event_id);
  check(Number(datesRow.contributing_event_count), 4); check(Number(datesRow.contributing_report_count), 1);
  const onlyFinish = await activity('FINISH-ONLY');
  await terminal(onlyFinish, [event('FINISH', '2026-10-03')]);
  const finishRow = await overlay(onlyFinish);
  check(finishRow.actual_start, null); check(finishRow.progress_percent, null); check(finishRow.start_not_evidenced, true);
  const onlyProgress = await activity('PROGRESS-100');
  await terminal(onlyProgress, [event('PROGRESS', '2026-10-03', 100)]);
  check((await overlay(onlyProgress)).actual_finish, null); check((await overlay(onlyProgress)).actual_start, null);
  check(Number((await overlay(onlyProgress)).progress_percent), 100);

  const progress = await activity('CHRONOLOGY');
  const later = await terminal(progress, [event('PROGRESS', '2026-10-06', 40)], { created: '2026-10-06T01:00:00Z' });
  await terminal(progress, [event('PROGRESS', '2026-10-04', 80)], { created: '2026-10-09T01:00:00Z' }); // approved/extracted later, older evidence
  const progressRow = await overlay(progress);
  check(Number(progressRow.progress_percent), 40); check(progressRow.progress_regression, true);
  check(progressRow.selected_progress_event_id, (await evidence(later))[0].event_id);
  const unanchoredHistory = await terminal(progress, [event('PROGRESS', null, 95)],
    { date: null, created: '2026-10-10T01:00:00Z' });
  const mixedHistory = await overlay(progress);
  check(Number(mixedHistory.progress_percent), 40); check(mixedHistory.progress_regression, true);
  check(mixedHistory.selected_progress_event_id, progressRow.selected_progress_event_id);
  check(mixedHistory.unresolved_event_date, true); check(Number(mixedHistory.contributing_event_count), 3);
  check((await evidence(unanchoredHistory))[0].chronology_date, null);
  const ties = await activity('TIES');
  await terminal(ties, [event('PROGRESS', '2026-10-04', 20)], { created: '2026-10-04T01:00:00Z' });
  const tiedLatest = await terminal(ties, [event('PROGRESS', '2026-10-04', 30), event('PROGRESS', '2026-10-04', 40)], { created: '2026-10-04T02:00:00Z' });
  check(Number((await overlay(ties)).progress_percent), 40);
  check((await overlay(ties)).ambiguous_progress_order, true);
  check((await overlay(ties)).selected_progress_event_id, (await evidence(tiedLatest))[1].event_id);
  check((await overlay(ties)).progress_regression, false); // same-day ties do not invent chronology
  const conflicts = await activity('CONFLICTS');
  await terminal(conflicts, [event('START', '2026-10-05'), event('FINISH', '2026-10-03'), event('PROGRESS', '2026-10-06', 30)]);
  check((await overlay(conflicts)).finish_before_start, true); check((await overlay(conflicts)).progress_after_finish, true);

  const undated = await activity('UNDATED');
  const undatedId = await terminal(undated, [event('START', null), event('FINISH', null), event('PROGRESS', null, 50)]);
  const undatedRow = await overlay(undated);
  check(undatedRow.actual_start, null); check(undatedRow.actual_finish, null);
  check(Number(undatedRow.progress_percent), 50); check(undatedRow.unresolved_event_date, true);
  check((await evidence(undatedId))[2].chronology_basis, 'reported_date');
  const noChronology = await activity('NO-CHRONOLOGY');
  const unanchoredFirst = await terminal(noChronology, [event('PROGRESS', null, 70)], { date: null });
  check((await overlay(noChronology)).progress_percent, null);
  check((await overlay(noChronology)).selected_progress_event_id, null);
  check((await overlay(noChronology)).unresolved_event_date, true);
  const anchoredLater = await terminal(noChronology, [event('PROGRESS', '2026-10-08', 90)]);
  const mixedChronology = await overlay(noChronology);
  check(Number(mixedChronology.progress_percent), 90);
  check(mixedChronology.selected_progress_event_id, (await evidence(anchoredLater))[0].event_id);
  check(mixedChronology.unresolved_event_date, true);
  check(Number(mixedChronology.contributing_event_count), 2);
  check(Number(mixedChronology.contributing_report_count), 2);
  check((await evidence(unanchoredFirst))[0].chronology_date, null);
  check((await evidence(unanchoredFirst))[0].chronology_basis, 'unresolved');

  const reverseChronology = await activity('UNANCHORED-LATER');
  const anchoredFirst = await terminal(reverseChronology, [event('PROGRESS', '2026-10-08', 90)],
    { created: '2026-10-08T01:00:00Z' });
  const unanchoredLater = await terminal(reverseChronology, [event('PROGRESS', null, 70)],
    { date: null, created: '2026-10-10T01:00:00Z' });
  const reverseRow = await overlay(reverseChronology);
  check(Number(reverseRow.progress_percent), 90);
  check(reverseRow.selected_progress_event_id, (await evidence(anchoredFirst))[0].event_id);
  check(reverseRow.unresolved_event_date, true); check(Number(reverseRow.contributing_event_count), 2);
  check((await evidence(unanchoredLater))[0].event_date, null);
  check((await evidence(unanchoredLater))[0].chronology_date, null);
  check((await evidence(unanchoredLater))[0].chronology_basis, 'unresolved');

  const allUnanchored = await activity('ALL-UNANCHORED');
  await terminal(allUnanchored, [event('PROGRESS', null, 70), event('PROGRESS', null, 80)], { date: null });
  const allUnanchoredRow = await overlay(allUnanchored);
  check(allUnanchoredRow.progress_percent, null); check(allUnanchoredRow.selected_progress_event_id, null);
  check(allUnanchoredRow.unresolved_event_date, true); check(Number(allUnanchoredRow.contributing_event_count), 2);
  // A repeated matching terminal audit must not multiply events.
  await actor('owner');
  await db.query(`insert into public.planner_audit_logs(field_update_id,action,previous_activity_id,new_activity_id,
    planner_name,remarks,actor_user_id,metadata,created_at)
    select field_update_id,action,previous_activity_id,new_activity_id,planner_name,remarks,actor_user_id,metadata,created_at
    from public.planner_audit_logs where id=$1`, [approvedEvidence[0].decision_audit_id]);
  check((await evidence(approved)).length, 1);
  await actor('owner');
  const duplicateChoice = (await db.query("select id from public.planner_audit_logs where field_update_id=$1 and action='accept' order by created_at desc,id desc limit 1", [approved])).rows[0].id;
  check((await evidence(approved))[0].decision_audit_id, duplicateChoice);
  const empty = await overlay(emptyActivity);
  check(Number(empty.contributing_event_count), 0); check(empty.actual_start, null); check(empty.progress_percent, null);
  await actor('owner');
  const baselineAfter = (await db.query('select * from public.schedule_activities where activity_id=any($1::text[]) order by activity_id', [baselineBefore.map(r => r.activity_id)])).rows;
  check(baselineAfter, baselineBefore);
  const baselineCount = (await db.query('select count(*)::int as n from public.schedule_activities')).rows[0].n;
  for (const who of ['planner', 'admin']) {
    await actor(who);
    check((await db.query('select count(*)::int as n from public.schedule_actuals_overlay')).rows[0].n, baselineCount);
    check((await db.query('select count(*)::int as n from public.schedule_actuals_evidence')).rows[0].n > 0, true);
  }
  for (const who of ['site', 'engineer']) {
    await actor(who);
    for (const view of ['schedule_actuals_overlay', 'schedule_actuals_evidence']) check((await db.query(`select * from public.${view}`)).rows, []);
  }
  await actor('anon');
  for (const view of ['schedule_actuals_overlay', 'schedule_actuals_evidence']) await denied(() => db.query(`select * from public.${view}`));
  await actor('planner');
  for (const view of ['schedule_actuals_overlay', 'schedule_actuals_evidence']) {
    for (const statement of [`insert into public.${view}(activity_id) values ('NO')`, `update public.${view} set activity_id='NO'`, `delete from public.${view}`]) await denied(() => db.query(statement));
  }
  await denied(() => db.query("update public.schedule_activities set planned_start_date='2099-01-01'"));
  await actor('owner');
  for (const view of ['schedule_actuals_overlay', 'schedule_actuals_evidence']) {
    const options = (await db.query('select reloptions from pg_class where oid=$1::regclass', [`public.${view}`])).rows[0].reloptions;
    check(options.includes('security_invoker=true'), true); check(options.includes('security_barrier=true'), true);
    for (const permission of ['INSERT', 'UPDATE', 'DELETE']) check((await db.query('select has_table_privilege($1,$2,$3) as allowed', ['authenticated', `public.${view}`, permission])).rows[0].allowed, false);
    check((await db.query("select has_table_privilege('anon',$1,'SELECT') as allowed", [`public.${view}`])).rows[0].allowed, false);
    check((await db.query(`select count(*)::int as n from pg_class c,
      lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where c.oid=$1::regclass and a.grantee=0`, [`public.${view}`])).rows[0].n, 0);
  }
  // Removing underlying privileges proves invoker views cannot bypass sources.
  await db.exec('revoke select on public.progress_events from authenticated');
  await actor('planner'); await denied(() => db.query('select * from public.schedule_actuals_evidence'));
  await actor('owner'); await db.exec('grant select on public.progress_events to authenticated');
  // Caller RLS, not just source ACLs, is evaluated through both invoker views.
  await db.exec(`create policy fixture_parent_visibility on public.field_updates as restrictive
    for select to authenticated using (id <> '${approved}'::uuid);`);
  check((await evidence(approved)).length, 0);
  console.log(`PASS: Phase 2 actuals overlay: ${checks} SQL/security checks on disposable PostgreSQL ${version}; actual 011 executed locally only.`);
  return checks;
}
