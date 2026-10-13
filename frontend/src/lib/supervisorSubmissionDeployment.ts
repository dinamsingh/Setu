/**
 * Release-controlled deployment gate for supervisor safe submission boundary.
 * Enforces that Migration 014 (authoritative server validation RPC and bypass prevention)
 * must be independently verified before production supervisor submission is unlocked.
 *
 * Per SETU Safety Specification:
 * - Do not alter live Supabase automatically.
 * - Keep submission gated/disabled until backend dependency is verified.
 */
export const SUPERVISOR_SUBMISSION_DEPLOYMENT = {
  migration014Verified: false,
  submissionEnabled: false,
};

export function isSupervisorSubmissionEnabled(): boolean {
  return (
    SUPERVISOR_SUBMISSION_DEPLOYMENT.migration014Verified === true &&
    SUPERVISOR_SUBMISSION_DEPLOYMENT.submissionEnabled === true
  );
}
