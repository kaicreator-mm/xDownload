/**
 * #101 P2-1 — the in-flight S1 transfer abort checkpoint hub.
 *
 * One hub per composed runtime joins the durably committed user cancel order
 * (seam `CANCEL_LINEAGE` → cancel bridge) to the driver's active HTTP
 * transfer: the driver registers an `AbortSignal` for the transfer it is
 * about to run and releases it afterwards; the bridge fires `abort` so the
 * adapter tears the request/body stream down at once (no lingering socket).
 * Pure in-process wiring — no authority, no state: cancellation truth stays
 * with the canonical stores.
 */

export interface S1TransferAbortHub {
  /**
   * Register the current drive episode for one aggregate and return the
   * signal to hand to the transfer request. Returns an already-aborted
   * signal when the cancel order committed before registration, so the
   * transfer fails fast at its own checkpoint.
   */
  register(aggregateId: string): AbortSignal;
  /** End the registration of the current drive episode (idempotent). */
  release(aggregateId: string): void;
  /** Fire the abort checkpoint for one aggregate (idempotent, no-op when absent). */
  abort(aggregateId: string): void;
}

export function createS1TransferAbortHub(): S1TransferAbortHub {
  const controllers = new Map<string, AbortController>();
  return {
    register(aggregateId: string): AbortSignal {
      controllers.delete(aggregateId);
      const controller = new AbortController();
      controllers.set(aggregateId, controller);
      return controller.signal;
    },
    release(aggregateId: string): void {
      const controller = controllers.get(aggregateId);
      if (controller !== undefined && !controller.signal.aborted) {
        controllers.delete(aggregateId);
      }
    },
    abort(aggregateId: string): void {
      controllers.get(aggregateId)?.abort();
      controllers.delete(aggregateId);
    },
  };
}
