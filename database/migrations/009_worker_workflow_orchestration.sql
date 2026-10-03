-- Phase 0.9B2/B3. Apply only after 008, as a separately authorized deployment.
-- No new columns: freshness is derived from the B1 revisions and resolved history.
begin;

create function public._field_update_processing_intent(p_update public.field_updates)
returns text language sql stable security invoker set search_path = '' as $$
    select case
        when p_update.status <> 'pending' then null
        when exists (select 1 from public.field_update_clarifications c
            where c.field_update_id = p_update.id and c.status in ('open', 'responded')) then null
        when exists (select 1 from public.field_update_remap_proposals p
            where p.field_update_id = p_update.id and p.status in ('pending_validation', 'validated', 'blocked')) then null
        when p_update.evidence_revision > p_update.validation_evidence_revision then
            case when exists (select 1 from public.field_update_clarifications c
                where c.field_update_id = p_update.id and c.status = 'resolved'
                and c.triage_impact = 'mapping_inputs_changed'
                and c.resolved_evidence_revision > p_update.validation_evidence_revision
                and c.resolved_evidence_revision <= p_update.evidence_revision)
                then 'rematch' else 'revalidate' end
        when coalesce(p_update.confidence_level, 'Pending') = 'Pending' then 'match'
        when p_update.validation_status is null then 'revalidate'
        else null end;
$$;

-- Service-role-only CAS. Returns false for obsolete computations, never a blind UPDATE.
create function public.complete_field_update_processing(
    p_field_update_id uuid, p_workflow_revision bigint, p_evidence_revision bigint,
    p_intent text, p_result jsonb
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare u public.field_updates%rowtype;
begin
    select * into u from public.field_updates where id = p_field_update_id for update;
    if not found then return false; end if;
    if u.status is distinct from 'pending'
       or u.workflow_revision is distinct from p_workflow_revision
       or u.evidence_revision is distinct from p_evidence_revision
       or public._field_update_processing_intent(u) is distinct from p_intent
       or p_intent is null or p_intent not in ('match', 'rematch', 'revalidate') then return false; end if;
    if coalesce(p_result->>'validation_status', '') not in ('pass', 'warn', 'block')
       or jsonb_typeof(p_result->'validation_results') is distinct from 'array' then
        raise exception 'Completed validation results are required';
    end if;
    if p_intent <> 'revalidate' and (
        coalesce(p_result->>'confidence_level', '') not in ('High', 'Medium', 'Low')
        or jsonb_typeof(p_result->'candidate_matches') is distinct from 'array') then
        raise exception 'Completed matching results are required';
    end if;
    update public.field_updates set
        matched_activity_id = case when p_intent = 'revalidate' then matched_activity_id else p_result->>'matched_activity_id' end,
        expanded_text = case when p_intent = 'revalidate' then expanded_text else p_result->>'expanded_text' end,
        matched_layer = case when p_intent = 'revalidate' then matched_layer else p_result->>'matched_layer' end,
        candidate_matches = case when p_intent = 'revalidate' then candidate_matches else p_result->'candidate_matches' end,
        confidence_level = case when p_intent = 'revalidate' then confidence_level else p_result->>'confidence_level' end,
        confidence_score = case when p_intent = 'revalidate' then confidence_score else (p_result->>'confidence_score')::double precision end,
        validation_status = p_result->>'validation_status', validation_results = p_result->'validation_results',
        validation_evidence_revision = evidence_revision,
        validation_overridden = false, override_reason = null, override_by = null, override_at = null,
        override_evidence_revision = null, override_activity_id = null,
        workflow_revision = workflow_revision + 1, updated_at = now()
    where id = u.id;
    return true;
end;
$$;

create function public.propose_field_update_remap(
    p_field_update_id uuid, p_target_activity_id text, p_expected_workflow_revision bigint default null
)
returns public.field_update_remap_proposals language plpgsql security definer set search_path = '' as $$
declare u public.field_updates%rowtype; p public.field_update_remap_proposals%rowtype;
begin
    u := public._lock_pending_workflow_report(p_field_update_id, p_expected_workflow_revision);
    if p_target_activity_id is null or p_target_activity_id is not distinct from u.matched_activity_id then
        raise exception 'Choose a different schedule activity';
    end if;
    if not exists (select 1 from public.schedule_activities where activity_id = p_target_activity_id) then
        raise exception 'Target schedule activity does not exist';
    end if;
    update public.field_updates set workflow_revision = workflow_revision + 1, updated_at = now()
        where id = u.id returning * into u;
    insert into public.field_update_remap_proposals (field_update_id, target_activity_id,
        proposed_by_user_id, evidence_revision, workflow_revision)
        values (u.id, p_target_activity_id, auth.uid(), u.evidence_revision, u.workflow_revision) returning * into p;
    perform public._append_workflow_audit(u, 'remap_proposed', u.matched_activity_id, p.target_activity_id,
        'Selected target submitted for validation', jsonb_build_object('proposal_id', p.id,
            'target_activity_id', p.target_activity_id, 'validation_generation', p.validation_generation));
    return p;
end;
$$;

create function public.complete_field_update_remap_validation(
    p_proposal_id uuid, p_target_activity_id text, p_workflow_revision bigint,
    p_evidence_revision bigint, p_validation_generation bigint, p_result jsonb
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare u public.field_updates%rowtype; p public.field_update_remap_proposals%rowtype;
begin
    select * into p from public.field_update_remap_proposals where id = p_proposal_id;
    if not found then return false; end if;
    -- All paths lock parent before child (including cancellation/invalid close).
    select * into u from public.field_updates where id = p.field_update_id for update;
    if not found then return false; end if;
    select * into p from public.field_update_remap_proposals where id = p_proposal_id for update;
    if u.status is distinct from 'pending' or p.status is distinct from 'pending_validation'
       or u.workflow_revision is distinct from p_workflow_revision
       or p.workflow_revision is distinct from p_workflow_revision
       or u.evidence_revision is distinct from p_evidence_revision
       or p.evidence_revision is distinct from p_evidence_revision
       or p.target_activity_id is distinct from p_target_activity_id
       or p.validation_generation is distinct from p_validation_generation
       or exists (select 1 from public.field_update_clarifications c
            where c.field_update_id = u.id and c.status in ('open', 'responded')) then return false; end if;
    if coalesce(p_result->>'validation_status', '') not in ('pass', 'warn', 'block')
       or jsonb_typeof(p_result->'validation_results') is distinct from 'array' then
        raise exception 'Completed target validation results are required';
    end if;
    update public.field_update_remap_proposals set
        validation_status = p_result->>'validation_status', validation_results = p_result->'validation_results',
        status = case when p_result->>'validation_status' = 'block' then 'blocked' else 'validated' end,
        validated_at = now(), validated_generation = validation_generation,
        validation_evidence_revision = evidence_revision
        where id = p.id;
    return true;
end;
$$;

-- Planner helper, not an API endpoint. Parent lock serializes every decision.
create function public._lock_current_remap_proposal(p_proposal_id uuid, p_expected_workflow_revision bigint)
returns public.field_update_remap_proposals language plpgsql security invoker set search_path = '' as $$
declare u public.field_updates%rowtype; p public.field_update_remap_proposals%rowtype;
begin
    if auth.uid() is null or coalesce(public.current_user_role(), '') not in ('planner', 'admin') then
        raise exception using errcode = '42501', message = 'Authenticated planner or administrator is required';
    end if;
    select * into p from public.field_update_remap_proposals where id = p_proposal_id;
    if not found then raise exception 'Remap proposal is unavailable'; end if;
    select * into u from public.field_updates where id = p.field_update_id for update;
    if not found or u.status is distinct from 'pending' then raise exception 'Field update is already finalized or unavailable'; end if;
    if p_expected_workflow_revision is not null and u.workflow_revision <> p_expected_workflow_revision then
        raise exception using errcode = '40001', message = 'Workflow changed; refresh before acting';
    end if;
    select * into p from public.field_update_remap_proposals where id = p_proposal_id for update;
    if p.status not in ('pending_validation', 'validated', 'blocked')
       or p.evidence_revision <> u.evidence_revision then raise exception 'Remap proposal is no longer current'; end if;
    if exists (select 1 from public.field_update_clarifications c
        where c.field_update_id = u.id and c.status in ('open', 'responded')) then
        raise exception 'Resolve active clarification before this action';
    end if;
    return p;
end;
$$;

create function public.override_field_update_remap_proposal(
    p_proposal_id uuid, p_reason text, p_expected_workflow_revision bigint default null
)
returns public.field_update_remap_proposals language plpgsql security definer set search_path = '' as $$
declare p public.field_update_remap_proposals%rowtype; u public.field_updates%rowtype;
begin
    p := public._lock_current_remap_proposal(p_proposal_id, p_expected_workflow_revision);
    if nullif(btrim(p_reason), '') is null then raise exception 'A non-empty proposal override reason is required'; end if;
    if p.status <> 'blocked' or p.validation_status is distinct from 'block'
       or p.validated_generation is distinct from p.validation_generation
       or p.validation_evidence_revision is distinct from p.evidence_revision then
        raise exception 'Only current blocked target validation may be overridden'; end if;
    if p.validation_overridden then raise exception 'Proposal validation is already overridden'; end if;
    update public.field_update_remap_proposals set validation_overridden = true,
        override_reason = btrim(p_reason), override_by_user_id = auth.uid(), override_at = now(),
        override_evidence_revision = evidence_revision, override_validation_generation = validation_generation
        where id = p.id returning * into p;
    update public.field_updates set workflow_revision = workflow_revision + 1, updated_at = now()
        where id = p.field_update_id returning * into u;
    perform public._append_workflow_audit(u, 'remap_proposal_override', u.matched_activity_id, p.target_activity_id,
        p.override_reason, jsonb_build_object('proposal_id', p.id, 'validation_generation', p.validation_generation,
            'override_evidence_revision', p.override_evidence_revision));
    return p;
end;
$$;

create function public.cancel_field_update_remap_proposal(
    p_proposal_id uuid, p_reason text, p_expected_workflow_revision bigint default null
)
returns public.field_update_remap_proposals language plpgsql security definer set search_path = '' as $$
declare p public.field_update_remap_proposals%rowtype; u public.field_updates%rowtype;
begin
    p := public._lock_current_remap_proposal(p_proposal_id, p_expected_workflow_revision);
    if nullif(btrim(p_reason), '') is null then raise exception 'A non-empty cancellation reason is required'; end if;
    update public.field_update_remap_proposals set status = 'cancelled', cancelled_at = now(),
        cancelled_by_user_id = auth.uid(), cancellation_reason = btrim(p_reason) where id = p.id returning * into p;
    update public.field_updates set workflow_revision = workflow_revision + 1, updated_at = now()
        where id = p.field_update_id returning * into u;
    perform public._append_workflow_audit(u, 'remap_proposal_cancelled', u.matched_activity_id, null,
        p.cancellation_reason, jsonb_build_object('proposal_id', p.id));
    return p;
end;
$$;

create function public.finalize_field_update_remap(
    p_proposal_id uuid, p_remarks text default null, p_expected_workflow_revision bigint default null
)
returns public.field_updates language plpgsql security definer set search_path = '' as $$
declare p public.field_update_remap_proposals%rowtype; u public.field_updates%rowtype; v_previous text;
begin
    p := public._lock_current_remap_proposal(p_proposal_id, p_expected_workflow_revision);
    if p.validated_generation is distinct from p.validation_generation
       or p.validation_evidence_revision is distinct from p.evidence_revision
       or p.validation_status is null then raise exception 'Current selected-target validation must complete'; end if;
    if not ((p.status = 'validated' and p.validation_status in ('pass', 'warn'))
        or (p.status = 'blocked' and p.validation_status = 'block' and p.validation_overridden
            and p.override_evidence_revision = p.evidence_revision
            and p.override_validation_generation = p.validation_generation)) then
        raise exception 'Blocked target requires a current proposal-scoped override'; end if;
    if not exists (select 1 from public.schedule_activities where activity_id = p.target_activity_id) then
        raise exception 'Target schedule activity does not exist'; end if;
    select matched_activity_id into v_previous from public.field_updates where id = p.field_update_id;
    update public.field_updates set status = 'remapped', matched_activity_id = p.target_activity_id,
        planner_remarks = nullif(btrim(p_remarks), ''), validation_status = p.validation_status,
        validation_results = p.validation_results, validation_evidence_revision = evidence_revision,
        validation_overridden = p.validation_overridden,
        override_reason = p.override_reason, override_at = p.override_at,
        override_by = case when p.validation_overridden then 'Authenticated Planner (' || p.override_by_user_id::text || ')' else null end,
        override_evidence_revision = p.override_evidence_revision,
        override_activity_id = case when p.validation_overridden then p.target_activity_id else null end,
        workflow_revision = workflow_revision + 1, updated_at = now()
        where id = p.field_update_id returning * into u;
    update public.field_update_remap_proposals set status = 'finalized', finalized_at = now() where id = p.id;
    perform public._append_workflow_audit(u, 'remap', v_previous, p.target_activity_id, u.planner_remarks,
        jsonb_build_object('proposal_id', p.id, 'target_activity_id', p.target_activity_id,
            'validation_generation', p.validation_generation, 'validation_status', p.validation_status,
            'validation_results', p.validation_results,
            'validation_overridden', p.validation_overridden, 'override_by_user_id', p.override_by_user_id));
    return u;
end;
$$;

revoke all on function public._field_update_processing_intent(public.field_updates) from public, anon, authenticated, service_role;
revoke all on function public._lock_current_remap_proposal(uuid, bigint) from public, anon, authenticated, service_role;
revoke all on function public.complete_field_update_processing(uuid, bigint, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.complete_field_update_remap_validation(uuid, text, bigint, bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.complete_field_update_processing(uuid, bigint, bigint, text, jsonb) to service_role;
grant execute on function public.complete_field_update_remap_validation(uuid, text, bigint, bigint, bigint, jsonb) to service_role;
revoke all on function public.propose_field_update_remap(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.override_field_update_remap_proposal(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.cancel_field_update_remap_proposal(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.finalize_field_update_remap(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.propose_field_update_remap(uuid, text, bigint) to authenticated;
grant execute on function public.override_field_update_remap_proposal(uuid, text, bigint) to authenticated;
grant execute on function public.cancel_field_update_remap_proposal(uuid, text, bigint) to authenticated;
grant execute on function public.finalize_field_update_remap(uuid, text, bigint) to authenticated;

comment on function public.review_field_update(uuid, text, text, text) is
    'Legacy remap is deprecated but callable for 0.9A deployment compatibility. New clients must use proposal validation/finalization. Remove legacy remap only after all clients cut over in a separately authorized migration.';
comment on table public.field_update_remap_proposals is
    'Selected-target validation is proposal-only until explicit planner finalization. Overrides are scoped to proposal evidence and generation.';
commit;
