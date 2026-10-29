/**
 * Shared fixture bytes for the T005 crash/restart scenario. A single source
 * so the crash worker, the parent assertions and budget math stay identical.
 */

export const SCENARIO_BYTES: Uint8Array = Buffer.from('t005-crash-scenario-bytes\r\n', 'utf8');

export const SCENARIO_PROFILE = {
  discovery: { domain: 'discovery', maxGeneratedRequests: 5 },
  transfer: { domain: 'transfer', maxBytes: 100_000, maxSegments: 10 },
  globalSafety: { domain: 'global_safety', maxTotalGeneratedRequests: 100 },
} as const;

/** transfer.maxBytes remaining after the dispatched 40_000 reservation. */
export const POST_RESERVATION_TRANSFER_BYTES_REMAINING = 60_000;
