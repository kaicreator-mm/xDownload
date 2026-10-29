/**
 * v0.2 T08 — the bounded submission pipeline (browser lane, pure ordering).
 *
 * Fixes the ORDER in which an inbound candidate may ever reach a submit:
 * gate first (canonical T01 no-widening decode), then host-check request
 * construction, then the fail-closed host answer evaluation. A candidate
 * that fails ANY stage never enters the submission flow, and the stage that
 * refused it plus the verbatim rejection codes are the decision.
 *
 * The actual transport send remains outside this lane (T12/T15); this module
 * is the admissibility decision the sender must obey.
 */

import type { ValidationDiagnostic } from '@xdownload/domain-contracts';
import type { CommandEnvelope, SeamDiagnostic, SeamResponse } from '@xdownload/core-seam';
import type { ConfirmedDownloadIntent } from '../../../../packages/download-domain-app/src/contracts/index.ts';
import { gateConfirmedAuthorization } from './authorization-gate.ts';
import {
  buildNativeHostCheckRequest,
  evaluateNativeHostCheck,
  type NativeHostCheckContext,
  type NativeHostCheckRefusalCode,
} from './native-host-seam.ts';

export type BoundedSubmissionDecision =
  | {
      readonly outcome: 'ADMITTED';
      readonly intent: Readonly<ConfirmedDownloadIntent>;
      readonly request: Readonly<CommandEnvelope>;
      readonly hostResponse: SeamResponse;
    }
  | { readonly outcome: 'REFUSED_AT_GATE'; readonly diagnostics: readonly ValidationDiagnostic[] }
  | { readonly outcome: 'REFUSED_AT_REQUEST'; readonly reason: string }
  | {
      readonly outcome: 'REFUSED_AT_HOST';
      readonly reason: NativeHostCheckRefusalCode;
      readonly detail: string;
      readonly diagnostics?: readonly SeamDiagnostic[];
    };

/**
 * Decide one bounded submission end-to-end. `rawHostResponse` is the raw
 * decoded-JSON answer (or undefined when none arrived — which refuses).
 */
export function authorizeBoundedSubmission(
  rawIntent: unknown,
  context: NativeHostCheckContext,
  rawHostResponse: unknown,
): BoundedSubmissionDecision {
  const gate = gateConfirmedAuthorization(rawIntent);
  if (!gate.authorized) {
    return { outcome: 'REFUSED_AT_GATE', diagnostics: gate.diagnostics };
  }
  const request = buildNativeHostCheckRequest(gate.intent, context);
  if (!request.ok) {
    return { outcome: 'REFUSED_AT_REQUEST', reason: request.reason };
  }
  const check = evaluateNativeHostCheck(request.request, rawHostResponse);
  if (!check.accepted) {
    return check.diagnostics === undefined
      ? { outcome: 'REFUSED_AT_HOST', reason: check.reason, detail: check.detail }
      : {
          outcome: 'REFUSED_AT_HOST',
          reason: check.reason,
          detail: check.detail,
          diagnostics: check.diagnostics,
        };
  }
  return {
    outcome: 'ADMITTED',
    intent: gate.intent,
    request: request.request,
    hostResponse: check.response,
  };
}
