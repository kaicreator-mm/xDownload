/**
 * v0.2 T08 — browser/native-host bounded-authorization surface adapter
 * (public index). Consumers import only these named exports; the lanes own
 * no transport, no privilege grant and no runtime authority.
 */
export {
  AUTHORIZATION_PAYLOAD_FIELDS,
  buildAuthorizationPayload,
  type AuthorizationPayload,
  type BrowserAuthorizationAction,
  type ConfirmationIdentity,
} from './authorization-request.ts';
export { gateConfirmedAuthorization, type AuthorizationGateDecision } from './authorization-gate.ts';
export {
  NATIVE_HOST_CHECK_COMMAND_TYPE,
  NATIVE_HOST_CHECK_SURFACE,
  buildNativeHostCheckRequest,
  evaluateNativeHostCheck,
  type NativeHostCheckContext,
  type NativeHostCheckDecision,
  type NativeHostCheckRefusalCode,
  type NativeHostCheckRequestResult,
} from './native-host-seam.ts';
export {
  authorizeBoundedSubmission,
  type BoundedSubmissionDecision,
} from './submission-pipeline.ts';
