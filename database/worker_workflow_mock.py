"""Local transaction model for migration 009; not a PostgreSQL/RLS emulator."""

from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

RPC_NAMES = {"complete_field_update_processing", "complete_field_update_remap_validation",
             "propose_field_update_remap", "override_field_update_remap_proposal",
             "cancel_field_update_remap_proposal", "finalize_field_update_remap"}
SERVER_NAMES = {"complete_field_update_processing", "complete_field_update_remap_validation"}
ACTIVE = {"pending_validation", "validated", "blocked"}


class LocalOrchestrationRPC:
    def __init__(self, db, name, params, actor, server):
        self.db, self.name, self.p, self.actor, self.server = db, name, params, actor, server

    def execute(self):
        from database.supabase_client import LocalMockResponse
        with self.db._workflow_lock:
            self.db.load()
            original = deepcopy(self.db.tables)
            tables = deepcopy(original)
            result = self.apply(tables)
            self.db.tables = tables
            try:
                self.db.save()
            except Exception:
                self.db.tables = original
                raise
            return LocalMockResponse([deepcopy(result)])

    def apply(self, tables):
        from engine.workflow_processing import processing_intent
        p = self.p
        role = next((r['role'] for r in tables.get('user_roles', []) if r['user_id'] == self.actor), None)
        server = self.name in SERVER_NAMES
        if server and not self.server:
            raise PermissionError('Server-only worker writeback')
        if not server and (not self.actor or role not in {'planner', 'admin'}):
            raise PermissionError('Authenticated planner or administrator is required')
        proposals = tables.setdefault('field_update_remap_proposals', [])
        rounds = tables.setdefault('field_update_clarifications', [])
        proposal = next((r for r in proposals if r['id'] == p.get('p_proposal_id')), None)
        report_id = proposal['field_update_id'] if proposal else p.get('p_field_update_id')
        report = next((r for r in tables['field_updates'] if r['id'] == report_id), None)
        if report is None or report['status'] != 'pending':
            if server:
                return False
            raise ValueError('Field update is already finalized or unavailable')
        expected = p.get('p_workflow_revision') if server else p.get('p_expected_workflow_revision')
        if expected is not None and expected != report['workflow_revision']:
            if server:
                return False
            raise ValueError('Workflow changed; refresh before acting')
        conflict = any(c['field_update_id'] == report_id and c['status'] in {'open', 'responded'} for c in rounds)
        if conflict:
            if server:
                return False
            raise ValueError('Resolve active clarification before this action')
        now = datetime.now(timezone.utc).isoformat()
        previous = report.get('matched_activity_id')

        def bump():
            report['workflow_revision'] += 1
            report['updated_at'] = now

        def audit(action, target, remarks=None):
            tables['planner_audit_logs'].append({
                'id': str(uuid4()), 'field_update_id': report_id, 'action': action,
                'actor_user_id': self.actor, 'planner_name': 'Authenticated ' + role.title(),
                'previous_activity_id': previous, 'new_activity_id': target, 'remarks': remarks,
                'created_at': now, 'metadata': {'proposal_id': proposal['id'],
                    'target_activity_id': proposal['target_activity_id'], 'validation_generation': proposal['validation_generation'],
                    'validation_status': proposal.get('validation_status'), 'validation_overridden': proposal.get('validation_overridden', False),
                    'evidence_revision': report['evidence_revision'], 'workflow_revision': report['workflow_revision']},
            })

        def clear_override():
            report['validation_overridden'] = False
            for key in ('override_reason', 'override_by', 'override_at', 'override_evidence_revision', 'override_activity_id'):
                report[key] = None

        if self.name == 'complete_field_update_processing':
            if (report['evidence_revision'] != p.get('p_evidence_revision')
                    or p.get('p_intent') not in {'match', 'rematch', 'revalidate'}
                    or processing_intent(report, rounds, proposals) != p['p_intent']):
                return False
            result = p['p_result']
            self.validate_result(result)
            if p['p_intent'] != 'revalidate':
                if result.get('confidence_level') not in {'High', 'Medium', 'Low'} or not isinstance(result.get('candidate_matches'), list):
                    raise ValueError('Completed matching results are required')
                for key in ('matched_activity_id', 'expanded_text', 'matched_layer', 'candidate_matches', 'confidence_level', 'confidence_score'):
                    report[key] = result.get(key)
            report.update(validation_status=result['validation_status'], validation_results=result['validation_results'],
                          validation_evidence_revision=report['evidence_revision'])
            clear_override()
            bump()
            return True
        if self.name == 'propose_field_update_remap':
            if any(r['field_update_id'] == report_id and r['status'] in ACTIVE for r in proposals):
                raise ValueError('Active remap proposal conflicts with this action')
            target = p.get('p_target_activity_id')
            if not target or target == previous:
                raise ValueError('Choose a different schedule activity')
            if not any(a['activity_id'] == target for a in tables['schedule_activities']):
                raise ValueError('Target schedule activity does not exist')
            bump()
            proposal = {'id': str(uuid4()), 'field_update_id': report_id, 'target_activity_id': target,
                        'proposed_by_user_id': self.actor, 'evidence_revision': report['evidence_revision'],
                        'workflow_revision': report['workflow_revision'], 'validation_generation': 1,
                        'status': 'pending_validation', 'validation_status': None, 'validation_results': [],
                        'validation_overridden': False, 'created_at': now}
            proposals.append(proposal)
            audit('remap_proposed', target)
            return proposal
        if proposal is None:
            if server:
                return False
            raise ValueError('Remap proposal is unavailable')
        if proposal['status'] not in ACTIVE or proposal['evidence_revision'] != report['evidence_revision']:
            if server:
                return False
            raise ValueError('Remap proposal is no longer current')
        if self.name == 'complete_field_update_remap_validation':
            if (proposal['status'] != 'pending_validation' or proposal['target_activity_id'] != p.get('p_target_activity_id')
                    or proposal['workflow_revision'] != p['p_workflow_revision']
                    or proposal['evidence_revision'] != p.get('p_evidence_revision')
                    or proposal['validation_generation'] != p.get('p_validation_generation')):
                return False
            result = p['p_result']
            self.validate_result(result)
            proposal.update(validation_status=result['validation_status'], validation_results=result['validation_results'],
                            status='blocked' if result['validation_status'] == 'block' else 'validated',
                            validated_at=now, validated_generation=proposal['validation_generation'],
                            validation_evidence_revision=report['evidence_revision'])
            return True
        reason = (p.get('p_reason') or '').strip()
        if self.name == 'cancel_field_update_remap_proposal':
            if not reason:
                raise ValueError('A non-empty cancellation reason is required')
            proposal.update(status='cancelled', cancelled_at=now, cancelled_by_user_id=self.actor, cancellation_reason=reason)
            bump()
            audit('remap_proposal_cancelled', None, reason)
            return proposal
        if (proposal.get('validated_generation') != proposal['validation_generation']
                or proposal.get('validation_evidence_revision') != proposal['evidence_revision']
                or proposal.get('validation_status') not in {'pass', 'warn', 'block'}):
            raise ValueError('Current selected-target validation must complete')
        if self.name == 'override_field_update_remap_proposal':
            if not reason:
                raise ValueError('A non-empty proposal override reason is required')
            if proposal['status'] != 'blocked' or proposal['validation_status'] != 'block' or proposal['validation_overridden']:
                raise ValueError('Only current blocked target validation may be overridden once')
            proposal.update(validation_overridden=True, override_reason=reason, override_by_user_id=self.actor,
                            override_at=now, override_evidence_revision=proposal['evidence_revision'],
                            override_validation_generation=proposal['validation_generation'])
            bump()
            audit('remap_proposal_override', proposal['target_activity_id'], reason)
            return proposal
        scoped = (proposal['validation_overridden'] and proposal.get('override_evidence_revision') == report['evidence_revision']
                  and proposal.get('override_validation_generation') == proposal['validation_generation'])
        if not (proposal['status'] == 'validated' and proposal['validation_status'] in {'pass', 'warn'}
                or proposal['status'] == 'blocked' and proposal['validation_status'] == 'block' and scoped):
            raise ValueError('Blocked target requires a current proposal-scoped override')
        if not any(a['activity_id'] == proposal['target_activity_id'] for a in tables['schedule_activities']):
            raise ValueError('Target schedule activity does not exist')
        clear_override()
        report.update(status='remapped', matched_activity_id=proposal['target_activity_id'],
                      validation_status=proposal['validation_status'], validation_results=proposal['validation_results'],
                      validation_evidence_revision=report['evidence_revision'], planner_remarks=p.get('p_remarks'))
        if scoped:
            report.update(validation_overridden=True, override_reason=proposal['override_reason'],
                          override_by=f"Authenticated Planner ({proposal['override_by_user_id']})", override_at=proposal['override_at'],
                          override_evidence_revision=report['evidence_revision'], override_activity_id=proposal['target_activity_id'])
        proposal.update(status='finalized', finalized_at=now)
        bump()
        audit('remap', proposal['target_activity_id'], report['planner_remarks'])
        return report

    @staticmethod
    def validate_result(result):
        if result.get('validation_status') not in {'pass', 'warn', 'block'} or not isinstance(result.get('validation_results'), list):
            raise ValueError('Completed validation results are required')
