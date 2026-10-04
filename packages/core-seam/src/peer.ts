/**
 * T004 peer identity and same-install/same-user authorization (frozen L2
 * §12: "local IPC peer authorization suitable for same-install/same-user
 * operation"; invariant 14: Native Messaging `allowed_origins` stays a
 * separate platform boundary and is never bypassed here).
 *
 * The authorization decision is made per command/query frame, never once per
 * process lifetime, so a later peer can never inherit an earlier peer's
 * admission. Identity verification failure and authorization failure are
 * distinct typed rejections; both fail closed and neither degrades to an
 * unauthenticated path.
 */

import { seamDiagnostic, seamFail, seamOk, type SeamResult } from './diagnostics.ts';
import { makePeerInstallId, makePeerUserId } from './ids.ts';

/** Surface kinds that may act as seam clients (PRD §6.1/§6.3: CLI, Desktop, Browser). */
export const SURFACE_KINDS = ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'] as const;

export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export interface PeerIdentity {
  readonly installId: string;
  readonly userId: string;
  readonly surface: SurfaceKind;
}

/** The only peer scope a Core seam instance admits. */
export interface ExpectedPeerScope {
  readonly installId: string;
  readonly userId: string;
  readonly allowedSurfaces: readonly SurfaceKind[];
}

const PEER_KEYS: readonly string[] = ['installId', 'userId', 'surface'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Shape-decode a presented peer identity block (no scope decision yet).
 * Used by the envelope decoder; authorization against the expected
 * same-install/same-user scope is the server's per-frame decision.
 */
export function decodePeerIdentity(presented: unknown): SeamResult<PeerIdentity> {
  if (!isPlainObject(presented)) {
    return seamFail([
      seamDiagnostic('PEER_IDENTITY_REJECTED', 'peer', 'peer identity block is required'),
    ]);
  }
  const unknownKeys = Object.keys(presented).filter((key) => !PEER_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    return seamFail(
      unknownKeys.map((key) =>
        seamDiagnostic('PEER_IDENTITY_REJECTED', `peer.${key}`, 'unknown peer identity field'),
      ),
    );
  }
  const installId = makePeerInstallId(
    typeof presented['installId'] === 'string' ? presented['installId'] : '',
  );
  if (!installId.ok) {
    return peerIdentityFailure(installId);
  }
  const userId = makePeerUserId(typeof presented['userId'] === 'string' ? presented['userId'] : '');
  if (!userId.ok) {
    return peerIdentityFailure(userId);
  }
  const surface = presented['surface'];
  if (typeof surface !== 'string' || !SURFACE_KINDS.includes(surface as SurfaceKind)) {
    return seamFail([
      seamDiagnostic('PEER_IDENTITY_REJECTED', 'peer.surface', 'unknown surface kind'),
    ]);
  }
  return seamOk({
    installId: installId.value,
    userId: userId.value,
    surface: surface as SurfaceKind,
  });
}

/** Re-emit an id-field validation failure under the peer identity code. */
function peerIdentityFailure(result: {
  readonly ok: false;
  readonly diagnostics: readonly { readonly path: string; readonly message: string }[];
}): SeamResult<never> {
  const first = result.diagnostics[0];
  return seamFail([
    seamDiagnostic(
      'PEER_IDENTITY_REJECTED',
      first?.path ?? 'peer',
      first?.message ?? 'malformed peer identity field',
    ),
  ]);
}

/**
 * Decode and verify a presented peer identity block, then authorize it for
 * the expected same-install/same-user scope.
 *
 * - `PEER_IDENTITY_REJECTED`: malformed identity, or install/user does not
 *   match the expected same-install/same-user identity.
 * - `PEER_UNAUTHORIZED`: verified identity whose surface kind is not in the
 *   allowed surface set.
 */
export function authorizePeer(
  presented: unknown,
  expected: ExpectedPeerScope,
): SeamResult<PeerIdentity> {
  const decoded = decodePeerIdentity(presented);
  if (!decoded.ok) {
    return decoded;
  }
  if (decoded.value.installId !== expected.installId || decoded.value.userId !== expected.userId) {
    return seamFail([
      seamDiagnostic(
        'PEER_IDENTITY_REJECTED',
        'peer',
        'peer is not the expected same-install/same-user identity',
        'L2-§12',
      ),
    ]);
  }
  if (!expected.allowedSurfaces.includes(decoded.value.surface)) {
    return seamFail([
      seamDiagnostic(
        'PEER_UNAUTHORIZED',
        'peer.surface',
        `surface '${decoded.value.surface}' is not authorized for this seam`,
        'L2-§12',
      ),
    ]);
  }
  return decoded;
}
