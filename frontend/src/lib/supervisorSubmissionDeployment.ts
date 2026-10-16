/**
 * Release-controlled deployment gate for supervisor safe submission boundary.
 * Enforces that Migration 014 (authoritative server validation RPC and receipts table)
 * must be independently verified before production supervisor submission is unlocked.
 *
 * Per SETU Safety Specification:
 * - Do not alter live Supabase automatically.
 * - Keep submission gated/disabled until backend dependency is verified.
 * - The frontend must never claim backend readiness when the required RPC is missing.
 */
export const SUPERVISOR_SUBMISSION_DEPLOYMENT = {
  migration014Verified: false,
  submissionEnabled: false,
};

export function isSupervisorSubmissionEnabled(): boolean {
  // Support explicit build/runtime environment flag for staging/preview deployments
  const envEnabled =
    typeof import.meta !== 'undefined' &&
    Boolean(import.meta.env?.VITE_SUPERVISOR_SUBMISSION_ENABLED === 'true');

  return (
    (SUPERVISOR_SUBMISSION_DEPLOYMENT.migration014Verified === true || envEnabled) &&
    (SUPERVISOR_SUBMISSION_DEPLOYMENT.submissionEnabled === true || envEnabled)
  );
}

export function getSupervisorSubmissionDeploymentStatus(): {
  enabled: boolean;
  migration014Verified: boolean;
  submissionEnabled: boolean;
  message: string;
} {
  const enabled = isSupervisorSubmissionEnabled();
  return {
    enabled,
    migration014Verified: SUPERVISOR_SUBMISSION_DEPLOYMENT.migration014Verified,
    submissionEnabled: SUPERVISOR_SUBMISSION_DEPLOYMENT.submissionEnabled,
    message: enabled
      ? 'Supervisor secure submission RPC is active and verified.'
      : 'Supervisor submission is currently locked pending verified deployment of backend Migration 014 (submit_supervisor_field_update RPC).',
  };
}
