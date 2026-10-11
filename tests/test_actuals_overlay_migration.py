"""Static architecture contracts. Disposable SQL verifier covers behavior/RLS."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = (ROOT / 'database/migrations/011_actuals_overlay.sql').read_text(encoding='utf-8').lower()
COMPACT = ' '.join(SQL.split())


def test_two_live_invoker_barrier_views_only():
    assert SQL.count('create view public.') == 2
    assert SQL.count('with (security_invoker = true, security_barrier = true)') == 2
    assert SQL.count("where public.current_user_role() in ('planner', 'admin')") == 2
    assert not re.search(r'\b(create (?:table|function|index|materialized view)|alter table|security definer)\b', SQL)
    assert SQL.rstrip().endswith('commit;')


def test_source_and_baseline_never_mutated():
    executable = re.sub(r'--[^\n]*', '', SQL)
    assert not re.search(r'\b(insert into|update|delete from|truncate|drop)\b', executable)
    assert 'from public.schedule_activities as a left join summary' in COMPACT
    assert 'coalesce(s.contributing_event_count, 0)' in COMPACT


def test_current_event_validation_and_scoped_override_gate():
    for token in ("u.status in ('approved', 'remapped')", 'a.activity_id = u.matched_activity_id',
                  'e.evidence_revision = u.evidence_revision',
                  'u.progress_extraction_revision = u.evidence_revision',
                  "e.event_type in ('start', 'finish', 'progress')",
                  'u.validation_evidence_revision = u.evidence_revision',
                  "u.validation_status in ('pass', 'warn')", 'u.validation_overridden is true',
                  'u.override_evidence_revision = u.evidence_revision',
                  'u.override_activity_id = u.matched_activity_id'):
        assert token in COMPACT


def test_exact_terminal_audit_binding_without_unsafe_json_casts():
    for token in ('log.actor_user_id is not null', 'log.new_activity_id = a.activity_id',
                  "log.metadata->'evidence_revision' = pg_catalog.to_jsonb(u.evidence_revision)",
                  "log.metadata->'workflow_revision' = pg_catalog.to_jsonb(u.workflow_revision)",
                  "log.action = 'accept'", "log.metadata->'legacy_terminal_remap' = 'false'::jsonb",
                  "log.action = 'remap'", "log.metadata->>'proposal_id' = p.id::text",
                  'order by log.created_at desc nulls last, log.id desc limit 1'):
        assert token in COMPACT
    assert not re.search(r"metadata\s*->>.*?::(?:uuid|bigint|integer)", SQL)


def test_finalized_proposal_target_and_generation_binding():
    for token in ("p.status = 'finalized'", 'p.target_activity_id = a.activity_id',
                  'p.evidence_revision = u.evidence_revision',
                  'p.validation_evidence_revision = p.evidence_revision',
                  'p.validated_generation = p.validation_generation',
                  'p.override_evidence_revision = p.evidence_revision',
                  'p.override_validation_generation = p.validation_generation',
                  "log.metadata->'validation_generation' = pg_catalog.to_jsonb(p.validation_generation)"):
        assert token in COMPACT


def test_explicit_date_rules_and_progress_chronology():
    for token in ("min(event_date) filter (where event_type = 'start') as actual_start",
                  "max(event_date) filter (where event_type = 'finish') as actual_finish",
                  'coalesce(e.event_date, u.reported_date) as chronology_date',
                  "where event_type = 'progress' and chronology_date is not null",
                  'order by activity_id, chronology_date desc, report_created_at desc nulls last, field_update_id desc, event_index desc, event_id desc'):
        assert token in COMPACT
    assert not re.search(r'\b(now\(|current_date|current_timestamp|max\(progress_percent\) as progress_percent)', SQL)


def test_unanchored_progress_does_not_veto_usable_selection_or_hide_uncertainty():
    progress_cte = COMPACT.split('), progress as (', 1)[1].split('), progress_days as (', 1)[0]
    assert "where event_type = 'progress' and chronology_date is not null" in progress_cte
    assert 'not exists' not in progress_cte
    assert 'bool_or(event_date is null) as unresolved_event_date' in COMPACT
    assert 'count(*) as contributing_event_count' in COMPACT
    assert 'count(distinct field_update_id) as contributing_report_count' in COMPACT


def test_conflicts_provenance_and_no_evidence_json_aggregation():
    for flag in ('finish_before_start', 'multiple_start_dates', 'multiple_finish_dates',
                 'progress_regression', 'progress_after_finish', 'ambiguous_progress_order',
                 'unresolved_event_date', 'start_not_evidenced'):
        assert flag in SQL
    assert 'rows between unbounded preceding and 1 preceding' in COMPACT
    for column in ('decision_audit_id', 'decision_actor_user_id', 'finalized_remap_proposal_id',
                   'chronology_basis', 'selected_start_event_id', 'selected_finish_event_id',
                   'selected_progress_event_id', 'contributing_report_count'):
        assert column in SQL
    assert 'jsonb_agg' not in SQL and 'json_agg' not in SQL


def test_only_authenticated_select_is_granted():
    assert 'revoke all on public.schedule_actuals_evidence, public.schedule_actuals_overlay from public, anon, authenticated, service_role;' in COMPACT
    assert 'grant select on public.schedule_actuals_evidence, public.schedule_actuals_overlay to authenticated;' in COMPACT
    assert SQL.count('grant ') == 1


def test_frontend_only_queries_views_no_polling_or_mutation():
    for name in ('useScheduleActuals', 'useActualsEvidence'):
        hook = (ROOT / f'frontend/src/hooks/{name}.ts').read_text(encoding='utf-8')
        assert '.select(' in hook and '.range(' in hook
        assert not re.search(r'\.(insert|update|delete|rpc)\(', hook)
        assert 'setInterval' not in hook and 'setTimeout' not in hook and 'useWorkflow' not in hook
        assert 'ignore = true' in hook and 'result.key === key' in hook
    hook = (ROOT / 'frontend/src/hooks/useActualsEvidence.ts').read_text(encoding='utf-8')
    assert ".eq('activity_id', activityId)" in hook


def test_verifier_uses_actual_migration_with_real_governance_rpcs():
    verifier = (ROOT / 'scripts/verify_actuals_overlay.mjs').read_text(encoding='utf-8')
    for token in ('database/migrations/011_actuals_overlay.sql', 'accept_current_field_update',
                  'finalize_field_update_remap', 'complete_field_update_progress_extraction',
                  'resolve_field_update_clarification_now', 'complete_field_update_processing',
                  'security_invoker=true', 'security_barrier=true', "actor('anon')"):
        assert token in verifier
    assert 'createClient' not in verifier and 'SUPABASE_URL' not in verifier
