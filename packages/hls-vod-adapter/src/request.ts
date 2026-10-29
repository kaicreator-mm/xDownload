/**
 * T009 — untrusted adapter request boundary.
 *
 * The adapter's entry input is decoded fail-closed from `unknown`: canonical
 * identities, canonical locator shape, explicit schema-agnostic field
 * rejection and raw-secret rejection (PRD §29, C21). Reusable credentials,
 * signed-URL secrets or DRM key material are never admitted into adapter
 * state; authorization travels as an opaque AuthorizationContextRef only.
 */

import {
  asRecord,
  decodeLocator,
  diagnostic,
  fail,
  makeAuthorizationContextRef,
  makeLogicalTargetId,
  rejectRawSecretFields,
  rejectUnknownFields,
  requireNonEmptyString,
  type AuthorizationContextRef,
  type DomainValidationResult,
  type LogicalTargetId,
  type ResourceLocator,
} from '@xdownload/domain-contracts';

export interface HlsAdapterRequest {
  readonly logicalTargetId: LogicalTargetId;
  readonly manifest: {
    readonly locator: ResourceLocator;
    readonly text: string;
  };
  readonly authorizationContextRef: AuthorizationContextRef | undefined;
}

const REQUEST_KEYS: readonly string[] = ['logicalTargetId', 'manifest', 'authorizationContextRef'];
const MANIFEST_KEYS: readonly string[] = ['locator', 'text'];

export function decodeHlsAdapterRequest(value: unknown): DomainValidationResult<HlsAdapterRequest> {
  const record = asRecord(value, 'request');
  if (!record.ok) {
    return record;
  }
  const secret = rejectRawSecretFields(record.value, 'request');
  if (!secret.ok) {
    return secret;
  }
  const shape = rejectUnknownFields(record.value, REQUEST_KEYS, 'request');
  if (!shape.ok) {
    return shape;
  }
  const rawTargetId = requireNonEmptyString(record.value, 'logicalTargetId', 'request');
  if (!rawTargetId.ok) {
    return rawTargetId;
  }
  const logicalTargetId = makeLogicalTargetId(rawTargetId.value);
  if (!logicalTargetId.ok) {
    return logicalTargetId;
  }
  const manifestRaw = asRecord(record.value['manifest'], 'request.manifest');
  if (!manifestRaw.ok) {
    return manifestRaw;
  }
  const manifestSecret = rejectRawSecretFields(manifestRaw.value, 'request.manifest');
  if (!manifestSecret.ok) {
    return manifestSecret;
  }
  const manifestShape = rejectUnknownFields(manifestRaw.value, MANIFEST_KEYS, 'request.manifest');
  if (!manifestShape.ok) {
    return manifestShape;
  }
  const locator = decodeLocator(manifestRaw.value['locator'], 'request.manifest.locator');
  if (!locator.ok) {
    return locator;
  }
  const text = requireNonEmptyString(manifestRaw.value, 'text', 'request.manifest');
  if (!text.ok) {
    return text;
  }
  let authorizationContextRef: AuthorizationContextRef | undefined;
  const rawRef = record.value['authorizationContextRef'];
  if (rawRef !== undefined) {
    if (typeof rawRef !== 'string') {
      return fail([
        diagnostic(
          'MALFORMED_REQUIRED_FIELD',
          'request.authorizationContextRef',
          'authorization context ref must be a string',
        ),
      ]);
    }
    const decoded = makeAuthorizationContextRef(rawRef);
    if (!decoded.ok) {
      return decoded;
    }
    authorizationContextRef = decoded.value;
  }
  return {
    ok: true,
    value: {
      logicalTargetId: logicalTargetId.value,
      manifest: { locator: locator.value, text: text.value },
      authorizationContextRef,
    },
  };
}
