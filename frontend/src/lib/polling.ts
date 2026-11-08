/**
 * Shared polling interval for Supabase reads.
 *
 * Live Supabase showed 63,598 REST requests in 25 hours (about 42 per
 * minute, day and night) from the 4-5 second pollers, which is what
 * burned the free-tier egress. 30 seconds cuts that by roughly 6x
 * while still showing a new match within half a minute. Do not drop
 * this back to a few seconds without re-checking Supabase usage.
 */
export const POLL_INTERVAL_MS = 30_000;

/** True when the tab is visible, or when there is no document (tests, SSR). */
export function isDocumentVisible(): boolean {
  return typeof document === 'undefined' || !document.hidden;
}
