/**
 * v0.2 T08 — bounded authorization request constructor (browser lane).
 *
 * Frozen Task Pack acceptance: "real authorized browser user action, no
 * cookies/secrets to model and no scope widening". This module is the ONLY
 * place a browser user action becomes a ConfirmedDownloadIntent-shaped
 * payload, and it is built to make smuggling browser context into the
 * payload structurally impossible:
 *
 * - the input type is a CLOSED confirmation-facts interface: there is no
 *   field for cookies, tabs, history, page URLs or any other browser
 *   context, and the constructor copies fields explicitly one by one —
 *   there is no spread, no generic key copy, no `Object.assign` of the
 *   action, so an unknown key attached to an action object at runtime can
 *   never reach the payload;
 * - the output type is exactly the canonical T01 `ConfirmedDownloadIntent`
 *   shape (readonly fields, no index signature): attaching an extra field
 *   to the produced payload is a compile-time error, and the object is
 *   deep-frozen at runtime;
 * - `targetRef` stays the opaque Host-resolvable token it is in the T01
 *   contract — a raw URL/path is refused downstream by the canonical gate
 *   (LOCATOR_SUBSTITUTION_REJECTED), never normalized away here.
 *
 * Pure functions only: no chrome.* API, no DOM, no Native Messaging.
 */

import { deepFreeze } from '@xdownload/domain-contracts';
import type {
  ConfirmedDownloadIntent,
  DownloadSlice,
  IntentCaller,
} from '../../../../packages/download-domain-app/src/contracts/index.ts';

/**
 * The exact payload field whitelist this surface may ever emit. Mirrors the
 * T01 confirmed-intent field set; anything else is out of scope for the
 * browser lane by construction.
 */
export const AUTHORIZATION_PAYLOAD_FIELDS = [
  'requestId',
  'lineageId',
  'targetRef',
  'outputRootScope',
  'allowedOperation',
  'slice',
  'digestAnchor',
  'declaredBytes',
  'caller',
] as const;

/**
 * A closed browser user action: the confirmation facts of one explicit
 * download decision and nothing else. Browser context (cookies, tabs,
 * history, page provenance, storage, ...) has NO representation here —
 * adding one would be the forbidden automatic privilege expansion.
 */
export interface BrowserAuthorizationAction {
  /** Opaque Host-resolvable target token; raw locators are refused by the gate. */
  readonly targetRef: string;
  /** Absolute authorized output root the artifact must materialize inside. */
  readonly outputRootScope: string;
  /** Bounded operation id from the frozen v0.2 operation vocabulary. */
  readonly allowedOperation: string;
  /** Frozen slice vocabulary (S1 direct / S3 media). */
  readonly slice: DownloadSlice;
  /** Optional publisher-declared digest (strengthens Host validation; never required). */
  readonly digestAnchor?: string;
  /** Optional declared total size (bounded by the T01 v0.2 profile). */
  readonly declaredBytes?: number;
  /** Bounded, auditable caller identity (no browser session material). */
  readonly caller: IntentCaller;
}

/**
 * Request/lineage identity allocated by the extension infrastructure (the
 * SAME id allocator the consumer binding uses); never derived from page data.
 */
export interface ConfirmationIdentity {
  readonly requestId: string;
  readonly lineageId: string;
}

/** The sealed payload shape: exactly the canonical T01 confirmed intent. */
export type AuthorizationPayload = ConfirmedDownloadIntent;

/**
 * Build the bounded authorization payload for one explicit user action.
 * Explicit per-field construction is the whitelist: unknown fields on the
 * action object cannot propagate (no generic copy), and the returned payload
 * is deep-frozen so confirmed semantics cannot be mutated in place.
 */
export function buildAuthorizationPayload(
  identity: ConfirmationIdentity,
  action: BrowserAuthorizationAction,
): AuthorizationPayload {
  const payload: AuthorizationPayload = {
    requestId: identity.requestId,
    lineageId: identity.lineageId,
    targetRef: action.targetRef,
    outputRootScope: action.outputRootScope,
    allowedOperation: action.allowedOperation,
    slice: action.slice,
    ...(action.digestAnchor === undefined ? {} : { digestAnchor: action.digestAnchor }),
    ...(action.declaredBytes === undefined ? {} : { declaredBytes: action.declaredBytes }),
    // The caller block is rebuilt field-by-field too: no extra caller keys.
    caller: { actor: action.caller.actor, sessionRef: action.caller.sessionRef },
  };
  return deepFreeze(payload);
}
