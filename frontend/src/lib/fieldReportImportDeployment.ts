/** Release-controlled gate, not a browser toggle or a substitute for RPC authorization.
 * Change only after independent deployment verification documented in Part 3B.
 * Deliberately does not read .env, discover schema remotely or auto-enable.
 */
export const FIELD_REPORT_IMPORT_DEPLOYMENT = {
  migration012Verified: false,
  migration013Verified: false,
  submissionEnabled: false,
};

export function isFieldReportImportEnabled(): boolean {
  return FIELD_REPORT_IMPORT_DEPLOYMENT.migration012Verified === true
    && FIELD_REPORT_IMPORT_DEPLOYMENT.migration013Verified === true
    && FIELD_REPORT_IMPORT_DEPLOYMENT.submissionEnabled === true;
}
