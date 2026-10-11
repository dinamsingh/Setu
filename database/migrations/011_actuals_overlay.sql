-- Phase 2: live, read-only derived actuals. No baseline/source mutations.
begin;

create view public.schedule_actuals_evidence
with (security_invoker = true, security_barrier = true) as
select a.activity_id, e.id as event_id, e.event_type, e.event_date,
    e.progress_percent, e.event_index, u.id as field_update_id, u.update_id,
    u.reported_date, u.created_at as report_created_at, u.evidence_revision,
    e.evidence_text, e.extraction_reason, e.extraction_version,
    e.created_at as extraction_created_at, d.id as decision_audit_id,
    d.actor_user_id as decision_actor_user_id, d.planner_name as planner_display_label,
    d.action as decision_action, d.created_at as decision_at,
    d.finalized_remap_proposal_id,
    coalesce(e.event_date, u.reported_date) as chronology_date,
    case when e.event_date is not null then 'event_date'
         when u.reported_date is not null then 'reported_date'
         else 'unresolved' end as chronology_basis
from public.progress_events as e
join public.field_updates as u on u.id = e.field_update_id
join public.schedule_activities as a on a.activity_id = u.matched_activity_id
join lateral (
    select log.*, p.id as finalized_remap_proposal_id
    from public.planner_audit_logs as log
    -- Keep proposal and audit selection together: at most one decision per event.
    left join public.field_update_remap_proposals as p
    on u.status = 'remapped' and p.field_update_id = u.id
    and p.status = 'finalized' and p.target_activity_id = a.activity_id
    and p.evidence_revision = u.evidence_revision
    and p.validation_evidence_revision = p.evidence_revision
    and p.validated_generation = p.validation_generation
    and p.validation_status = u.validation_status
    and p.validation_overridden = u.validation_overridden
    and (p.validation_status in ('pass', 'warn') or
        (p.validation_status = 'block' and p.validation_overridden is true
         and p.override_evidence_revision = p.evidence_revision
         and p.override_validation_generation = p.validation_generation))
    where log.field_update_id = u.id and log.actor_user_id is not null
      and log.new_activity_id = a.activity_id
      -- Compare JSON values, never cast potentially malformed legacy metadata.
      and log.metadata->'evidence_revision' = pg_catalog.to_jsonb(u.evidence_revision)
      and log.metadata->'workflow_revision' = pg_catalog.to_jsonb(u.workflow_revision)
      and ((u.status = 'approved' and log.action = 'accept'
            and log.metadata->'legacy_terminal_remap' = 'false'::jsonb)
        or (u.status = 'remapped' and log.action = 'remap' and p.id is not null
            and log.metadata->>'proposal_id' = p.id::text
            and log.metadata->>'target_activity_id' = p.target_activity_id
            and log.metadata->'validation_generation' = pg_catalog.to_jsonb(p.validation_generation)
            and log.metadata->>'validation_status' = p.validation_status
            and log.metadata->'validation_overridden' = pg_catalog.to_jsonb(p.validation_overridden)))
    order by log.created_at desc nulls last, log.id desc
    limit 1
) as d on true
where public.current_user_role() in ('planner', 'admin')
  and u.status in ('approved', 'remapped')
  and e.evidence_revision = u.evidence_revision
  and u.progress_extraction_revision = u.evidence_revision
  and e.event_type in ('START', 'FINISH', 'PROGRESS')
  and u.validation_evidence_revision = u.evidence_revision
  and (u.validation_status in ('pass', 'warn') or
      (u.validation_status = 'block' and u.validation_overridden is true
       and u.override_evidence_revision = u.evidence_revision
       and u.override_activity_id = u.matched_activity_id));

create view public.schedule_actuals_overlay
with (security_invoker = true, security_barrier = true) as
with evidence as materialized (
    select * from public.schedule_actuals_evidence
), summary as (
    select activity_id, count(*) as contributing_event_count,
        count(distinct field_update_id) as contributing_report_count,
        min(event_date) filter (where event_type = 'START') as actual_start,
        max(event_date) filter (where event_type = 'FINISH') as actual_finish,
        count(distinct event_date) filter (where event_type = 'START') > 1 as multiple_start_dates,
        count(distinct event_date) filter (where event_type = 'FINISH') > 1 as multiple_finish_dates,
        bool_or(event_date is null) as unresolved_event_date,
        bool_or(event_type = 'FINISH') and not bool_or(event_type = 'START') as start_not_evidenced,
        max(chronology_date) as latest_evidence_date,
        max(decision_at) as latest_decision_at,
        max(extraction_created_at) as latest_extraction_at
    from evidence group by activity_id
), starts as (
    select distinct on (activity_id) activity_id, event_id
    from evidence where event_type = 'START' and event_date is not null
    order by activity_id, event_date, report_created_at desc nulls last,
        field_update_id desc, event_index desc, event_id desc
), finishes as (
    select distinct on (activity_id) activity_id, event_id
    from evidence where event_type = 'FINISH' and event_date is not null
    order by activity_id, event_date desc, report_created_at desc nulls last,
        field_update_id desc, event_index desc, event_id desc
), progress as (
    select distinct on (activity_id) activity_id, event_id, progress_percent
    from evidence as ordered where event_type = 'PROGRESS' and chronology_date is not null
    order by activity_id, chronology_date desc, report_created_at desc nulls last,
        field_update_id desc, event_index desc, event_id desc
), progress_days as (
    select activity_id, chronology_date, min(progress_percent) as low,
        max(progress_percent) as high, count(distinct progress_percent) > 1 as ambiguous
    from evidence where event_type = 'PROGRESS' and chronology_date is not null
    group by activity_id, chronology_date
), progress_history as (
    select *, max(high) over (partition by activity_id order by chronology_date
        rows between unbounded preceding and 1 preceding) as earlier_high
    from progress_days
), conflicts as (
    select activity_id, bool_or(low < earlier_high) as progress_regression,
        bool_or(ambiguous) as ambiguous_progress_order
    from progress_history group by activity_id
)
select a.activity_id, a.activity_name, a.wbs_code, a.wbs_name, a.discipline,
    a.planned_start_date, a.planned_finish_date, s.actual_start, s.actual_finish,
    pr.progress_percent, coalesce(s.contributing_event_count, 0) as contributing_event_count,
    coalesce(s.contributing_report_count, 0) as contributing_report_count,
    st.event_id as selected_start_event_id, fi.event_id as selected_finish_event_id,
    pr.event_id as selected_progress_event_id, s.latest_evidence_date,
    s.latest_decision_at, s.latest_extraction_at,
    coalesce(s.actual_finish < s.actual_start, false) as finish_before_start,
    coalesce(s.multiple_start_dates, false) as multiple_start_dates,
    coalesce(s.multiple_finish_dates, false) as multiple_finish_dates,
    coalesce(c.progress_regression, false) as progress_regression,
    exists (select 1 from evidence as later where later.activity_id = a.activity_id
        and later.event_type = 'PROGRESS' and later.chronology_date > s.actual_finish) as progress_after_finish,
    coalesce(c.ambiguous_progress_order, false) as ambiguous_progress_order,
    coalesce(s.unresolved_event_date, false) as unresolved_event_date,
    coalesce(s.start_not_evidenced, false) as start_not_evidenced
from public.schedule_activities as a
left join summary as s on s.activity_id = a.activity_id
left join starts as st on st.activity_id = a.activity_id
left join finishes as fi on fi.activity_id = a.activity_id
left join progress as pr on pr.activity_id = a.activity_id
left join conflicts as c on c.activity_id = a.activity_id
where public.current_user_role() in ('planner', 'admin');

revoke all on public.schedule_actuals_evidence, public.schedule_actuals_overlay
    from public, anon, authenticated, service_role;
grant select on public.schedule_actuals_evidence, public.schedule_actuals_overlay to authenticated;

comment on view public.schedule_actuals_evidence is
    'Current extracted events bound to current governed Accept or finalized proposal Remap. Legacy unbound decisions excluded. Invoker RLS retained; chronology fallback orders PROGRESS only.';
comment on view public.schedule_actuals_overlay is
    'Live read-only SETU actuals; imported baseline unchanged. Earliest explicit dated START, latest explicit dated FINISH, latest chronological PROGRESS. Conflicts disclosed, never repaired; no Primavera writeback.';
commit;
