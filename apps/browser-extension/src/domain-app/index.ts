/**
 * v0.2 T08 / v0.2.1 T05 — browser/native-host bounded-authorization surface
 * adapter (public index). Consumers import only these named exports; the
 * lanes own no transport, no privilege grant and no runtime authority.
 */
export {
  AUTHORIZATION_PAYLOAD_FIELDS,
  buildAuthorizationPayload,
  type AuthorizationPayload,
  type BrowserAuthorizationAction,
  type ConfirmationIdentity,
} from './authorization-request.ts';
export {
  gateConfirmedAuthorization,
  type AuthorizationGateDecision,
} from './authorization-gate.ts';
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
export {
  V02_ROUTE_ID,
  V02_SEND_COMMAND_TYPE,
  V02_STATUS_QUERY_TYPE,
  V02_SURFACE,
  buildV02DomainAppSend,
  buildV02JobProjectionQuery,
  evaluateV02ProjectionAnswer,
  evaluateV02SendAnswer,
  type V02AnswerDiagnostic,
  type V02AnswerRefusalCode,
  type V02ProjectionAnswerDecision,
  type V02QueryRequestResult,
  type V02RouteContext,
  type V02SendAnswerDecision,
  type V02SendRequestResult,
} from './v02-route.ts';
export {
  V02_PERMISSION_DENIED,
  V02_SUBMISSION_REQUIRED_ORIGINS,
  decideSubmissionPermission,
  permissionRationale,
  type PermissionRequestOutcome,
  type SubmissionPermissionDecision,
} from './permission-gate.ts';
