-- SETU Phase 0.9B1: transactional workflow foundation. Apply after 007.
-- Local implementation only; deployment is a separate, authorized operation.
-- Original evidence and the schedule baseline remain unchanged. B2 supplies
-- effective-evidence processing and manual-target validation; B3 supplies UI.
begin;

alter table public.field_updates
    add column evidence_revision bigint not null default 0 check (evidence_revision >= 0),
    add column workflow_revision bigint not null default 0 check (workflow_revision >= 0),
    add column validation_evidence_revision bigint not null default 0
        check (validation_evidence_revision >= 0 and validation_evidence_revision <= evidence_revision),
    add column override_evidence_revision bigint,
    add column override_activity_id text;

-- Existing results belong to original evidence (revision zero). Preserve
-- existing report-level overrides, explicitly bound to their reviewed scope.
update public.field_updates
   set override_evidence_revision = evidence_revision,
       override_activity_id = matched_activity_id
 where validation_overridden is true;

alter table public.planner_audit_logs
    add column metadata jsonb not null default '{}'::jsonb
        check (jsonb_typeof(metadata) = 'object');

create table public.field_update_clarifications (
    id uuid primary key default gen_random_uuid(),
    field_update_id uuid not null references public.field_updates(id) on delete restrict,
    mode text not null check (mode in ('resolve_now', 'request_response')),
    -- Identity snapshots deliberately survive Auth user deletion. RPCs derive
    -- these UUIDs from auth.uid()/the original report, never client identity text.
    recipient_user_id uuid,
    question text not null check (nullif(btrim(question), '') is not null),
    communication_method text,
    response text check (response is null or nullif(btrim(response), '') is not null),
    supplied_by text,
    requested_by_user_id uuid not null,
    responded_by_user_id uuid,
    resolved_by_user_id uuid,
    cancelled_by_user_id uuid,
    status text not null check (status in ('open', 'responded', 'resolved', 'cancelled')),
    triage_impact text check (triage_impact in
        ('confirm_only', 'validation_inputs_changed', 'mapping_inputs_changed')),
    triage_note text,
    evidence_revision bigint not null check (evidence_revision >= 0),
    workflow_revision bigint not null check (workflow_revision >= 0),
    resolved_evidence_revision bigint check (resolved_evidence_revision >= evidence_revision),
    created_at timestamptz not null default now(),
    responded_at timestamptz,
    resolved_at timestamptz,
    cancelled_at timestamptz,
    cancellation_reason text,
    constraint clarification_request_recipient check (
        mode <> 'request_response' or recipient_user_id is not null),
    constraint clarification_direct_resolution check (
        mode <> 'resolve_now' or (
            status = 'resolved' and nullif(btrim(communication_method), '') is not null
            and nullif(btrim(supplied_by), '') is not null and response is not null)),
    constraint clarification_response_shape check (
        (responded_at is null and responded_by_user_id is null)
        or (mode = 'request_response' and responded_at is not null
            and responded_by_user_id is not null
            and responded_by_user_id = recipient_user_id and response is not null)),
    constraint clarification_open_shape check (
        status <> 'open' or (mode = 'request_response' and response is null and responded_at is null)),
    constraint clarification_responded_shape check (
        status <> 'responded' or (mode = 'request_response' and response is not null
            and responded_at is not null and responded_by_user_id is not null)),
    constraint clarification_resolution_shape check (
        (status = 'resolved' and resolved_at is not null and resolved_by_user_id is not null
            and response is not null and triage_impact is not null and resolved_evidence_revision is not null
            and resolved_evidence_revision = evidence_revision
                + case when triage_impact = 'confirm_only' then 0 else 1 end
            and (mode = 'resolve_now' or (responded_at is not null and responded_by_user_id is not null)))
        or (status <> 'resolved' and resolved_at is null and resolved_by_user_id is null
            and triage_impact is null and resolved_evidence_revision is null)),
    constraint clarification_cancellation_shape check (
        (status = 'cancelled' and cancelled_at is not null and cancelled_by_user_id is not null
            and nullif(btrim(cancellation_reason), '') is not null)
        or (status <> 'cancelled' and cancelled_at is null and cancelled_by_user_id is null
            and cancellation_reason is null))
);

-- A responded round remains active until planner triage; a second request
-- cannot evade the one-open-round rule by arriving just after the response.
create unique index idx_clarifications_one_active_request
    on public.field_update_clarifications(field_update_id)
    where mode = 'request_response' and status in ('open', 'responded');
create index idx_clarifications_report_history
    on public.field_update_clarifications(field_update_id, created_at);
create index idx_clarifications_recipient
    on public.field_update_clarifications(recipient_user_id, status);

create table public.field_update_remap_proposals (
    id uuid primary key default gen_random_uuid(),
    field_update_id uuid not null references public.field_updates(id) on delete restrict,
    target_activity_id text not null references public.schedule_activities(activity_id) on delete restrict,
    proposed_by_user_id uuid not null,
    evidence_revision bigint not null check (evidence_revision >= 0),
    workflow_revision bigint not null check (workflow_revision >= 0),
    status text not null default 'pending_validation' check (status in
        ('pending_validation', 'validated', 'blocked', 'finalized', 'cancelled')),
    validation_status text check (validation_status in ('pass', 'warn', 'block')),
    validation_results jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_results) = 'array'),
    validation_generation bigint not null default 1 check (validation_generation > 0),
    validated_generation bigint,
    validation_evidence_revision bigint,
    validation_overridden boolean not null default false,
    override_reason text,
    override_by_user_id uuid,
    override_at timestamptz,
    override_evidence_revision bigint,
    override_validation_generation bigint,
    created_at timestamptz not null default now(),
    validated_at timestamptz,
    finalized_at timestamptz,
    cancelled_at timestamptz,
    cancelled_by_user_id uuid,
    cancellation_reason text,
    constraint proposal_validation_binding check (
        (validation_status is null and validated_at is null and validated_generation is null
            and validation_evidence_revision is null)
        or (validation_status is not null and validated_at is not null
            and validated_generation is not null and validated_generation = validation_generation
            and validation_evidence_revision is not null and validation_evidence_revision = evidence_revision)),
    constraint proposal_status_validation check (
        (status = 'pending_validation' and validation_status is null)
        or (status = 'validated' and validation_status is not null and validation_status in ('pass', 'warn'))
        or (status = 'blocked' and validation_status is not null and validation_status = 'block')
        or (status = 'finalized' and validation_status is not null
            and (validation_status in ('pass', 'warn') or validation_overridden))
        or status = 'cancelled'),
    constraint proposal_override_scope check (
        (not validation_overridden and override_reason is null and override_by_user_id is null
            and override_at is null and override_evidence_revision is null
            and override_validation_generation is null)
        or (validation_overridden and validation_status is not null and validation_status = 'block'
            and nullif(btrim(override_reason), '') is not null and override_by_user_id is not null
            and override_at is not null and override_evidence_revision is not null
            and override_evidence_revision = evidence_revision and override_validation_generation is not null
            and override_validation_generation = validation_generation)),
    constraint proposal_finalization_shape check ((status = 'finalized') = (finalized_at is not null)),
    constraint proposal_cancellation_shape check (
        (status = 'cancelled' and cancelled_at is not null and cancelled_by_user_id is not null
            and nullif(btrim(cancellation_reason), '') is not null)
        or (status <> 'cancelled' and cancelled_at is null and cancelled_by_user_id is null
            and cancellation_reason is null))
);
create unique index idx_remap_proposals_one_active
    on public.field_update_remap_proposals(field_update_id)
    where status in ('pending_validation', 'validated', 'blocked');
create index idx_remap_proposals_report_history
    on public.field_update_remap_proposals(field_update_id, created_at);
create index idx_remap_proposals_target on public.field_update_remap_proposals(target_activity_id);

alter table public.field_update_clarifications enable row level security;
alter table public.field_update_remap_proposals enable row level security;
revoke all on table public.field_update_clarifications from public, anon, authenticated;
revoke all on table public.field_update_remap_proposals from public, anon, authenticated;
grant select on table public.field_update_clarifications, public.field_update_remap_proposals to authenticated;
grant all on table public.field_update_clarifications, public.field_update_remap_proposals to service_role;

create policy clarifications_field_read_own on public.field_update_clarifications
    for select to authenticated using (
        public.current_user_role() in ('site', 'engineer')
        and recipient_user_id = (select auth.uid()));
create policy clarifications_planner_read on public.field_update_clarifications
    for select to authenticated using (public.current_user_role() in ('planner', 'admin'));
create policy remap_proposals_planner_read on public.field_update_remap_proposals
    for select to authenticated using (public.current_user_role() in ('planner', 'admin'));

-- The deployed field hook explicitly submits these canonical empty values.
-- Keep table INSERT, but reject attempts to seed AI results or planner authority.
drop policy if exists field_site_engineer_insert_own on public.field_updates;
create policy field_site_engineer_insert_own on public.field_updates
    for insert to authenticated with check (
        public.current_user_role() in ('site', 'engineer')
        and submitted_by_user_id = (select auth.uid()) and status = 'pending'
        and confidence_level = 'Pending' and (confidence_score is null or confidence_score = 0)
        and matched_activity_id is null and matched_layer is null and expanded_text is null
        and candidate_matches = '[]'::jsonb and validation_status is null
        and validation_results = '[]'::jsonb and validation_overridden = false
        and override_reason is null and override_by is null and override_at is null
        and planner_remarks is null and evidence_revision = 0 and workflow_revision = 0
        and validation_evidence_revision = 0 and override_evidence_revision is null
        and override_activity_id is null);

-- Internal helpers are not API endpoints. SECURITY INVOKER means they inherit
-- the enclosing, authorized RPC's owner privileges; no browser EXECUTE grant.
create function public._lock_pending_workflow_report(
    p_field_update_id uuid, p_expected_workflow_revision bigint default null,
    p_require_idle boolean default true
)
returns public.field_updates language plpgsql security invoker set search_path = '' as $$
declare
    v_actor uuid := auth.uid();
    v_role text;
    v_update public.field_updates%rowtype;
begin
    if v_actor is null then
        raise exception using errcode = '42501', message = 'Authentication is required';
    end if;
    select ur.role into v_role from public.user_roles as ur where ur.user_id = v_actor;
    if v_role is null or v_role not in ('planner', 'admin') then
        raise exception using errcode = '42501', message = 'Planner or administrator role is required';
    end if;
    select fu.* into v_update from public.field_updates as fu
        where fu.id = p_field_update_id for update;
    if not found then raise exception 'Field update is unavailable'; end if;
    if v_update.status is distinct from 'pending' then
        raise exception 'Field update is already finalized';
    end if;
    if p_expected_workflow_revision is not null
       and p_expected_workflow_revision <> v_update.workflow_revision then
        raise exception using errcode = '40001', message = 'Workflow changed; refresh before acting';
    end if;
    if p_require_idle and exists (select 1 from public.field_update_clarifications as c
        where c.field_update_id = p_field_update_id and c.status in ('open', 'responded')) then
        raise exception 'Resolve active clarification before this action';
    end if;
    if exists (select 1 from public.field_update_remap_proposals as rp
        where rp.field_update_id = p_field_update_id
        and rp.status in ('pending_validation', 'validated', 'blocked')) then
        raise exception 'Active remap proposal conflicts with this action';
    end if;
    return v_update;
end;
$$;

create function public._append_workflow_audit(
    p_update public.field_updates, p_action text, p_previous_activity_id text,
    p_new_activity_id text, p_remarks text, p_metadata jsonb default '{}'::jsonb
)
returns void language plpgsql security invoker set search_path = '' as $$
declare
    v_actor uuid := auth.uid();
    v_role text;
begin
    if v_actor is null then
        raise exception using errcode = '42501', message = 'Authentication is required for audit';
    end if;
    select ur.role into v_role from public.user_roles as ur where ur.user_id = v_actor;
    insert into public.planner_audit_logs (
        field_update_id, action, previous_activity_id, new_activity_id,
        planner_name, remarks, actor_user_id, metadata
    ) values (
        p_update.id, p_action, p_previous_activity_id, p_new_activity_id,
        case v_role when 'admin' then 'Authenticated Administrator'
            when 'planner' then 'Authenticated Planner' else 'Authenticated Field Submitter' end,
        p_remarks, v_actor, p_metadata || jsonb_build_object(
            'evidence_revision', p_update.evidence_revision,
            'workflow_revision', p_update.workflow_revision));
end;
$$;

create function public._apply_clarification_impact(p_field_update_id uuid, p_impact text)
returns public.field_updates language plpgsql security invoker set search_path = '' as $$
declare
    v_update public.field_updates%rowtype;
begin
    if p_impact is null or p_impact not in
        ('confirm_only', 'validation_inputs_changed', 'mapping_inputs_changed') then
        raise exception 'An explicit supported clarification impact is required';
    end if;
    update public.field_updates set
        workflow_revision = workflow_revision + 1,
        evidence_revision = evidence_revision + case when p_impact = 'confirm_only' then 0 else 1 end,
        validation_status = case when p_impact = 'confirm_only' then validation_status else null end,
        validation_results = case when p_impact = 'confirm_only' then validation_results else '[]'::jsonb end,
        validation_overridden = case when p_impact = 'confirm_only' then validation_overridden else false end,
        override_reason = case when p_impact = 'confirm_only' then override_reason else null end,
        override_by = case when p_impact = 'confirm_only' then override_by else null end,
        override_at = case when p_impact = 'confirm_only' then override_at else null end,
        override_evidence_revision = case when p_impact = 'confirm_only' then override_evidence_revision else null end,
        override_activity_id = case when p_impact = 'confirm_only' then override_activity_id else null end,
        updated_at = now()
    where id = p_field_update_id returning * into v_update;
    -- Do not set confidence Pending: the legacy worker does not consume
    -- supplemental evidence. B2 must process the explicit triage impact first.
    return v_update;
end;
$$;

create function public.request_field_update_clarification(
    p_field_update_id uuid, p_question text, p_expected_workflow_revision bigint default null
)
returns public.field_update_clarifications
language plpgsql security definer set search_path = '' as $$
declare
    v_actor uuid := auth.uid();
    v_update public.field_updates%rowtype;
    v_round public.field_update_clarifications%rowtype;
    v_question text := nullif(btrim(coalesce(p_question, '')), '');
begin
    v_update := public._lock_pending_workflow_report(p_field_update_id, p_expected_workflow_revision);
    if v_question is null then raise exception 'A non-empty clarification question is required'; end if;
    if v_update.submitted_by_user_id is null then
        raise exception 'Original submitter is unavailable; use direct clarification';
    end if;
    update public.field_updates set workflow_revision = workflow_revision + 1, updated_at = now()
        where id = p_field_update_id returning * into v_update;
    insert into public.field_update_clarifications (
        field_update_id, mode, recipient_user_id, question, requested_by_user_id,
        status, evidence_revision, workflow_revision
    ) values (p_field_update_id, 'request_response', v_update.submitted_by_user_id,
        v_question, v_actor, 'open', v_update.evidence_revision, v_update.workflow_revision)
    returning * into v_round;
    perform public._append_workflow_audit(v_update, 'clarification_requested',
        v_update.matched_activity_id, v_update.matched_activity_id, v_question,
        jsonb_build_object('clarification_id', v_round.id, 'mode', v_round.mode,
            'recipient_user_id', v_round.recipient_user_id));
    return v_round;
end;
$$;

create function public.respond_to_field_update_clarification(
    p_clarification_id uuid, p_response text, p_expected_workflow_revision bigint default null
)
returns public.field_update_clarifications
language plpgsql security definer set search_path = '' as $$
declare
    v_actor uuid := auth.uid();
    v_role text;
    v_round public.field_update_clarifications%rowtype;
    v_update public.field_updates%rowtype;
    v_response text := nullif(btrim(coalesce(p_response, '')), '');
begin
    if v_actor is null then
        raise exception using errcode = '42501', message = 'Authentication is required';
    end if;
    select ur.role into v_role from public.user_roles as ur where ur.user_id = v_actor;
    if v_role is null or v_role not in ('site', 'engineer') then
        raise exception using errcode = '42501', message = 'Site or engineer role is required';
    end if;
    select c.* into v_round from public.field_update_clarifications as c where c.id = p_clarification_id;
    if not found or v_round.recipient_user_id is distinct from v_actor then
        raise exception using errcode = '42501', message = 'Clarification is unavailable to this submitter';
    end if;
    -- Lock parent before child everywhere, including close/cancellation.
    select fu.* into v_update from public.field_updates as fu
        where fu.id = v_round.field_update_id for update;
    if not found or v_update.status is distinct from 'pending' then
        raise exception 'Field update is already finalized or unavailable';
    end if;
    if p_expected_workflow_revision is not null and p_expected_workflow_revision <> v_update.workflow_revision then
        raise exception using errcode = '40001', message = 'Workflow changed; refresh before responding';
    end if;
    select c.* into v_round from public.field_update_clarifications as c
        where c.id = p_clarification_id for update;
    if v_round.recipient_user_id is distinct from v_actor
       or v_update.submitted_by_user_id is distinct from v_actor then
        raise exception using errcode = '42501', message = 'Only the original addressed submitter may respond';
    end if;
    if v_round.mode <> 'request_response' or v_round.status <> 'open' then
        raise exception 'Clarification is not open for a response';
    end if;
    if v_response is null then raise exception 'A non-empty clarification response is required'; end if;
    update public.field_update_clarifications set response = v_response, status = 'responded',
        supplied_by = 'Authenticated Field Submitter', communication_method = 'field_response',
        responded_by_user_id = v_actor, responded_at = now()
        where id = p_clarification_id returning * into v_round;
    update public.field_updates set workflow_revision = workflow_revision + 1, updated_at = now()
        where id = v_update.id returning * into v_update;
    perform public._append_workflow_audit(v_update, 'clarification_responded',
        v_update.matched_activity_id, v_update.matched_activity_id, v_response,
        jsonb_build_object('clarification_id', v_round.id));
    return v_round;
end;
$$;

create function public.resolve_field_update_clarification_now(
    p_field_update_id uuid, p_question text, p_communication_method text,
    p_response text, p_supplied_by text, p_impact text,
    p_expected_workflow_revision bigint default null
)
returns public.field_update_clarifications
language plpgsql security definer set search_path = '' as $$
declare
    v_actor uuid := auth.uid();
    v_update public.field_updates%rowtype;
    v_round public.field_update_clarifications%rowtype;
    v_previous_evidence_revision bigint;
begin
    v_update := public._lock_pending_workflow_report(p_field_update_id, p_expected_workflow_revision);
    if nullif(btrim(coalesce(p_question, '')), '') is null
       or nullif(btrim(coalesce(p_communication_method, '')), '') is null
       or nullif(btrim(coalesce(p_response, '')), '') is null
       or nullif(btrim(coalesce(p_supplied_by, '')), '') is null then
        raise exception 'Question, communication method, response and supplier are required';
    end if;
    v_previous_evidence_revision := v_update.evidence_revision;
    v_update := public._apply_clarification_impact(p_field_update_id, p_impact);
    insert into public.field_update_clarifications (
        field_update_id, mode, recipient_user_id, question, communication_method,
        response, supplied_by, requested_by_user_id, resolved_by_user_id,
        status, triage_impact, evidence_revision, workflow_revision,
        resolved_evidence_revision, resolved_at
    ) values (p_field_update_id, 'resolve_now', v_update.submitted_by_user_id,
        btrim(p_question), btrim(p_communication_method), btrim(p_response), btrim(p_supplied_by),
        v_actor, v_actor, 'resolved', p_impact, v_previous_evidence_revision,
        v_update.workflow_revision, v_update.evidence_revision, now()) returning * into v_round;
    perform public._append_workflow_audit(v_update, 'clarification_resolved',
        v_update.matched_activity_id, v_update.matched_activity_id, v_round.response,
        jsonb_build_object('clarification_id', v_round.id, 'mode', v_round.mode,
            'impact', p_impact, 'previous_evidence_revision', v_previous_evidence_revision));
    return v_round;
end;
$$;

create function public.triage_field_update_clarification(
    p_clarification_id uuid, p_impact text, p_note text default null,
    p_expected_workflow_revision bigint default null
)
returns public.field_update_clarifications
language plpgsql security definer set search_path = '' as $$
declare
    v_actor uuid := auth.uid();
    v_round public.field_update_clarifications%rowtype;
    v_update public.field_updates%rowtype;
    v_previous_evidence_revision bigint;
begin
    -- Authentication/role checks precede even the non-locking child lookup.
    if v_actor is null or coalesce(public.current_user_role(), '') not in ('planner', 'admin') then
        raise exception using errcode = '42501', message = 'Authenticated planner or administrator is required';
    end if;
    select c.* into v_round from public.field_update_clarifications as c where c.id = p_clarification_id;
    if not found then raise exception 'Clarification is unavailable'; end if;
    v_update := public._lock_pending_workflow_report(v_round.field_update_id, p_expected_workflow_revision, false);
    select c.* into v_round from public.field_update_clarifications as c
        where c.id = p_clarification_id for update;
    if v_round.mode <> 'request_response' or v_round.status <> 'responded' then
        raise exception 'Only a responded clarification may be triaged';
    end if;
    v_previous_evidence_revision := v_update.evidence_revision;
    v_update := public._apply_clarification_impact(v_update.id, p_impact);
    update public.field_update_clarifications set status = 'resolved', triage_impact = p_impact,
        triage_note = nullif(btrim(coalesce(p_note, '')), ''), resolved_by_user_id = v_actor,
        resolved_at = now(), resolved_evidence_revision = v_update.evidence_revision
        where id = p_clarification_id returning * into v_round;
    perform public._append_workflow_audit(v_update, 'clarification_resolved',
        v_update.matched_activity_id, v_update.matched_activity_id, coalesce(v_round.triage_note, v_round.response),
        jsonb_build_object('clarification_id', v_round.id, 'mode', v_round.mode,
            'impact', p_impact, 'previous_evidence_revision', v_previous_evidence_revision));
    return v_round;
end;
$$;

create function public.close_field_update_as_invalid(
    p_field_update_id uuid, p_reason text, p_expected_workflow_revision bigint default null
)
returns public.field_updates
language plpgsql security definer set search_path = '' as $$
declare
    v_actor uuid := auth.uid();
    v_update public.field_updates%rowtype;
    v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
    v_previous_activity_id text;
    v_cancelled_clarifications jsonb;
    v_cancelled_proposals jsonb;
begin
    -- Close is the explicit escape from either active workflow, so perform its
    -- own planner check and parent lock rather than requiring an idle report.
    if v_actor is null or coalesce(public.current_user_role(), '') not in ('planner', 'admin') then
        raise exception using errcode = '42501', message = 'Authenticated planner or administrator is required';
    end if;
    if v_reason is null then raise exception 'A non-empty invalid-close reason is required'; end if;
    select fu.* into v_update from public.field_updates as fu where fu.id = p_field_update_id for update;
    if not found then raise exception 'Field update is unavailable'; end if;
    if v_update.status is distinct from 'pending' then raise exception 'Field update is already finalized'; end if;
    if p_expected_workflow_revision is not null and p_expected_workflow_revision <> v_update.workflow_revision then
        raise exception using errcode = '40001', message = 'Workflow changed; refresh before acting';
    end if;
    v_previous_activity_id := v_update.matched_activity_id;
    with cancelled as (
        update public.field_update_clarifications set status = 'cancelled', cancelled_at = now(),
            cancelled_by_user_id = v_actor, cancellation_reason = v_reason
        where field_update_id = p_field_update_id and status in ('open', 'responded') returning id
    ) select coalesce(jsonb_agg(id), '[]'::jsonb) into v_cancelled_clarifications from cancelled;
    with cancelled as (
        update public.field_update_remap_proposals set status = 'cancelled', cancelled_at = now(),
            cancelled_by_user_id = v_actor, cancellation_reason = v_reason
        where field_update_id = p_field_update_id and status in ('pending_validation', 'validated', 'blocked') returning id
    ) select coalesce(jsonb_agg(id), '[]'::jsonb) into v_cancelled_proposals from cancelled;
    update public.field_updates set status = 'rejected', planner_remarks = v_reason,
        workflow_revision = workflow_revision + 1, updated_at = now()
        where id = p_field_update_id returning * into v_update;
    -- Existing readers understand reject. Structured metadata distinguishes
    -- Close as Invalid and records every cancellation without parsing remarks.
    perform public._append_workflow_audit(v_update, 'reject', v_previous_activity_id, null, v_reason,
        jsonb_build_object('decision', 'close_as_invalid',
            'cancelled_clarification_ids', v_cancelled_clarifications,
            'cancelled_remap_proposal_ids', v_cancelled_proposals));
    return v_update;
end;
$$;

-- Same signatures/defaults as 006. Legacy terminal remap deliberately remains
-- available for 0.9A until the B2 worker and B3 UI coordinated cutover.
create or replace function public.review_field_update(
    p_field_update_id uuid, p_action text, p_target_activity_id text default null, p_remarks text default null
)
returns public.field_updates language plpgsql security definer set search_path = '' as $$
declare
    v_actor uuid := auth.uid();
    v_update public.field_updates%rowtype;
    v_action text := lower(btrim(coalesce(p_action, '')));
    v_target text := nullif(btrim(coalesce(p_target_activity_id, '')), '');
    v_previous text;
    v_new text;
begin
    v_update := public._lock_pending_workflow_report(p_field_update_id);
    if v_action not in ('accept', 'reject', 'remap') then raise exception 'Unsupported planner decision'; end if;
    v_previous := v_update.matched_activity_id;
    if v_action in ('accept', 'remap') then
        if v_update.validation_evidence_revision <> v_update.evidence_revision then
            raise exception 'Clarified evidence requires validation refresh before approval or remap';
        end if;
        if v_update.validation_status is null
           or v_update.validation_status not in ('pass', 'warn', 'block') then
            raise exception 'Current validation must complete before approval or remap';
        end if;
        if v_update.validation_status = 'block' and (
            v_update.validation_overridden is not true
            or v_update.override_evidence_revision is distinct from v_update.evidence_revision
            or v_update.override_activity_id is distinct from v_update.matched_activity_id) then
            raise exception 'Blocked validation requires a current scoped override before approval or remap';
        end if;
    end if;
    if v_action = 'accept' then
        if v_previous is null then raise exception 'Approval requires a linked schedule activity'; end if;
        if not exists (select 1 from public.schedule_activities as sa where sa.activity_id = v_previous) then
            raise exception 'Linked schedule activity does not exist';
        end if;
        v_new := v_previous;
        update public.field_updates set status = 'approved',
            planner_remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
            workflow_revision = workflow_revision + 1, updated_at = now()
            where id = p_field_update_id returning * into v_update;
    elsif v_action = 'reject' then
        update public.field_updates set status = 'rejected',
            planner_remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
            workflow_revision = workflow_revision + 1, updated_at = now()
            where id = p_field_update_id returning * into v_update;
    else
        if v_target is null then raise exception 'Remap requires a target schedule activity'; end if;
        if not exists (select 1 from public.schedule_activities as sa where sa.activity_id = v_target) then
            raise exception 'Target schedule activity does not exist';
        end if;
        v_new := v_target;
        update public.field_updates set status = 'remapped', matched_activity_id = v_target,
            planner_remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
            validation_overridden = case when v_target = v_previous then validation_overridden else false end,
            override_reason = case when v_target = v_previous then override_reason else null end,
            override_by = case when v_target = v_previous then override_by else null end,
            override_at = case when v_target = v_previous then override_at else null end,
            override_evidence_revision = case when v_target = v_previous then override_evidence_revision else null end,
            override_activity_id = case when v_target = v_previous then override_activity_id else null end,
            workflow_revision = workflow_revision + 1, updated_at = now()
            where id = p_field_update_id returning * into v_update;
    end if;
    perform public._append_workflow_audit(v_update, v_action, v_previous, v_new,
        nullif(btrim(coalesce(p_remarks, '')), ''),
        jsonb_build_object('legacy_terminal_remap', v_action = 'remap'));
    return v_update;
end;
$$;

create or replace function public.override_field_update_validation(p_field_update_id uuid, p_reason text)
returns public.field_updates language plpgsql security definer set search_path = '' as $$
declare
    v_actor uuid := auth.uid();
    v_update public.field_updates%rowtype;
    v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
    v_update := public._lock_pending_workflow_report(p_field_update_id);
    if v_reason is null then raise exception 'A non-empty override reason is required'; end if;
    if v_update.validation_evidence_revision <> v_update.evidence_revision then
        raise exception 'Clarified evidence requires validation refresh before override';
    end if;
    if v_update.validation_status is distinct from 'block' then raise exception 'Only blocked validation may be overridden'; end if;
    if v_update.validation_overridden is true then raise exception 'Validation block is already overridden'; end if;
    update public.field_updates set validation_overridden = true, override_reason = v_reason,
        override_by = case public.current_user_role() when 'admin' then 'Authenticated Administrator' else 'Authenticated Planner' end,
        override_at = now(), override_evidence_revision = evidence_revision, override_activity_id = matched_activity_id,
        workflow_revision = workflow_revision + 1, updated_at = now()
        where id = p_field_update_id returning * into v_update;
    perform public._append_workflow_audit(v_update, 'override', v_update.matched_activity_id,
        v_update.matched_activity_id, 'Validation Override: ' || v_reason,
        jsonb_build_object('override_evidence_revision', v_update.override_evidence_revision,
            'override_activity_id', v_update.override_activity_id));
    return v_update;
end;
$$;

create or replace function public.requeue_field_update(p_field_update_id uuid, p_remarks text default null)
returns public.field_updates language plpgsql security definer set search_path = '' as $$
declare
    v_actor uuid := auth.uid();
    v_update public.field_updates%rowtype;
    v_previous text;
begin
    v_update := public._lock_pending_workflow_report(p_field_update_id);
    if v_update.validation_evidence_revision <> v_update.evidence_revision then
        raise exception 'Clarified evidence requires B2 processing before technical requeue';
    end if;
    v_previous := v_update.matched_activity_id;
    update public.field_updates set confidence_level = 'Pending', confidence_score = 0,
        matched_activity_id = null, matched_layer = null, candidate_matches = '[]'::jsonb, expanded_text = null,
        validation_status = null, validation_results = '[]'::jsonb, validation_overridden = false,
        override_reason = null, override_by = null, override_at = null,
        override_evidence_revision = null, override_activity_id = null,
        workflow_revision = workflow_revision + 1, updated_at = now()
        where id = p_field_update_id returning * into v_update;
    perform public._append_workflow_audit(v_update, 'requeue', v_previous, null,
        coalesce(nullif(btrim(coalesce(p_remarks, '')), ''),
            'Re-queued for re-matching with updated domain dictionary.'));
    return v_update;
end;
$$;

-- Guard immutable request identity, one response and terminal history even for
-- privileged server writes. New workflow records are never physically deleted.
create function public.protect_clarification_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
    if tg_op = 'DELETE' then raise exception 'Clarification history cannot be deleted'; end if;
    if old.status in ('resolved', 'cancelled') then raise exception 'Terminal clarification history is immutable'; end if;
    if row(old.id, old.field_update_id, old.mode, old.recipient_user_id, old.question,
        old.requested_by_user_id, old.created_at, old.evidence_revision, old.workflow_revision)
       is distinct from row(new.id, new.field_update_id, new.mode, new.recipient_user_id, new.question,
        new.requested_by_user_id, new.created_at, new.evidence_revision, new.workflow_revision) then
        raise exception 'Clarification request identity and context are immutable';
    end if;
    if old.status = 'responded' and row(old.response, old.responded_by_user_id, old.responded_at,
        old.supplied_by, old.communication_method) is distinct from row(new.response,
        new.responded_by_user_id, new.responded_at, new.supplied_by, new.communication_method) then
        raise exception 'Submitted clarification response is immutable';
    end if;
    if (old.status = 'open' and new.status not in ('responded', 'cancelled'))
       or (old.status = 'responded' and new.status not in ('resolved', 'cancelled')) then
        raise exception 'Unsupported clarification transition';
    end if;
    return new;
end;
$$;
create trigger trg_protect_clarification_history before update or delete
    on public.field_update_clarifications for each row execute function public.protect_clarification_history();

create function public.protect_remap_proposal_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
    if tg_op = 'DELETE' then raise exception 'Remap proposal history cannot be deleted'; end if;
    if old.status in ('finalized', 'cancelled') then raise exception 'Terminal remap proposal history is immutable'; end if;
    if row(old.id, old.field_update_id, old.target_activity_id, old.proposed_by_user_id,
        old.evidence_revision, old.workflow_revision, old.created_at) is distinct from
       row(new.id, new.field_update_id, new.target_activity_id, new.proposed_by_user_id,
        new.evidence_revision, new.workflow_revision, new.created_at) then
        raise exception 'Remap target and evidence context are immutable; create a new proposal';
    end if;
    return new;
end;
$$;
create trigger trg_protect_remap_proposal_history before update or delete
    on public.field_update_remap_proposals for each row execute function public.protect_remap_proposal_history();

revoke all on function public._lock_pending_workflow_report(uuid, bigint, boolean) from public, anon, authenticated, service_role;
revoke all on function public._append_workflow_audit(public.field_updates, text, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public._apply_clarification_impact(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.protect_clarification_history() from public, anon, authenticated, service_role;
revoke all on function public.protect_remap_proposal_history() from public, anon, authenticated, service_role;

revoke all on function public.request_field_update_clarification(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.respond_to_field_update_clarification(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.resolve_field_update_clarification_now(uuid, text, text, text, text, text, bigint) from public, anon, authenticated;
revoke all on function public.triage_field_update_clarification(uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.close_field_update_as_invalid(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.review_field_update(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.override_field_update_validation(uuid, text) from public, anon, authenticated;
revoke all on function public.requeue_field_update(uuid, text) from public, anon, authenticated;
grant execute on function public.request_field_update_clarification(uuid, text, bigint) to authenticated;
grant execute on function public.respond_to_field_update_clarification(uuid, text, bigint) to authenticated;
grant execute on function public.resolve_field_update_clarification_now(uuid, text, text, text, text, text, bigint) to authenticated;
grant execute on function public.triage_field_update_clarification(uuid, text, text, bigint) to authenticated;
grant execute on function public.close_field_update_as_invalid(uuid, text, bigint) to authenticated;
grant execute on function public.review_field_update(uuid, text, text, text) to authenticated;
grant execute on function public.override_field_update_validation(uuid, text) to authenticated;
grant execute on function public.requeue_field_update(uuid, text) to authenticated;

comment on column public.field_updates.validation_evidence_revision is
    'B2 freshness binding. Legacy worker results remain revision zero; material clarification locks decisions until refreshed.';
comment on table public.field_update_remap_proposals is
    'B1 foundation only. B2 implements proposal creation, Python target validation and governed finalization; legacy remap remains until B3 cutover.';
comment on column public.planner_audit_logs.metadata is
    'Structured workflow correlation and revision context. Existing action/remarks readers remain compatible.';
commit;
