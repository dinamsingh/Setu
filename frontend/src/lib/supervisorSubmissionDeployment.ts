/**
 * Release-controlled deployment gate for supervisor safe submission boundary.
 * Enforces that Migration 014 (authoritative server validation RPC and bypass prevention)
 * must be independently verified before production supervisor submission is unlocked.
 *
 * Per SETU Safety Specification:
 * - Do not alter live Supabase automatically.
 * - Keep submission gated/disabled until backend dependency is verified.
 *
 * Gate unlock (2026-10-28, branch supervisor/unlock-014-gate):
 * Set to true ONLY as the last step, after Migration 014 has been applied
 * to live Supabase and the RPC/trigger verification in the 014 checklist
 * has passed. Do not merge this branch before that DB verification.
 */
export const SUPERVISOR_SUBMISSION_DEPLOYMENT = {
  migration014Verified: true,
  submissionEnabled: true,
};

export function isSupervisorSubmissionEnabled(): boolean {
  return (
    SUPERVISOR_SUBMISSION_DEPLOYMENT.migration014Verified === true &&
    SUPERVISOR_SUBMISSION_DEPLOYMENT.submissionEnabled === true
  );
}
