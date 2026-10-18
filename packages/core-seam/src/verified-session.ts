/**
 * #101 S3-WIN-IPC-001 — Core-owned OS-verified peer session port.
 *
 * The legacy 1.0/1.1 seam trusts the per-frame `PeerIdentity` envelope block
 * (installId/userId/surface are caller-presented; L2 §12 same-install/
 * same-user *authorization*, not OS *verification*). The adopted S3 L2
 * successor §2.1 (PR #119) requires more for upcoming S3 1.2 candidate
 * confirmation: the connecting process's OS token must be verified
 * natively (never a caller-presented identity, PID string alone, or the
 * legacy TCP loopback address).
 *
 * This module defines the narrow port through which a transport that CAN
 * verify the OS identity of a connecting peer (today: the Windows named-pipe
 * transport) publishes Core-owned verified same-user/session metadata, and
 * the transport-authorization gate the S3 1.2 command vocabulary must use.
 *
 * Deliberate scoping (dispatch S3-WIN-IPC-001):
 * - No new public wire command, challenge, or auto-confirmation lives here.
 *   The command vocabulary stays closed at schema 1.1 and every future S3
 *   command name is listed in `OS_VERIFIED_PEER_COMMANDS`, which keeps S3
 *   1.2 DISABLED until a positively verified peer session exists.
 * - Legacy transports (loopback TCP) never write into a verified-session
 *   registry, so a peer that arrived over an unauthenticated-by-OS transport
 *   is structurally ineligible for OS-verified authority.
 */

import { seamDiagnostic, seamFail, seamOk, type SeamResult } from './diagnostics.ts';

/** Transports that can positively verify the OS identity of the connecting peer. */
export const OS_VERIFIED_TRANSPORT_KINDS = ['WINDOWS_NAMED_PIPE'] as const;

export type OsVerifiedTransportKind = (typeof OS_VERIFIED_TRANSPORT_KINDS)[number];

/**
 * Core-owned verified peer session for ONE accepted transport connection.
 * Every field is derived from the connecting process's OS token by the
 * transport (native impersonation + GetTokenInformation) — never from the
 * envelope's presented `PeerIdentity` block.
 */
export interface OsVerifiedPeerSession {
  /** The transport mechanism that performed the OS verification. */
  readonly transportKind: OsVerifiedTransportKind;
  /** Seam connection this session is bound to (one session per connection). */
  readonly connectionId: string;
  /** Canonical SID string (S-1-…) of the connecting process's token user. */
  readonly userSid: string;
  /** Best-effort resolved account name (DOMAIN\user); undefined when unresolved. */
  readonly userName: string | undefined;
  /** Connecting process ID (metadata only — never the verification basis). */
  readonly clientPid: number;
  /** LUID of the client token's authentication (logon) session, as `0x%08x%08x`. */
  readonly logonSessionId: string;
  /** True when the verified SID equals the Core process's own token user. */
  readonly sameUserAsCore: boolean;
  /** True when the verified authentication LUID equals the Core process's own. */
  readonly sameLogonSessionAsCore: boolean;
  /** RFC 3339 instant of the verification (audit metadata). */
  readonly verifiedAt: string;
}

/**
 * Narrow read-only port over verified sessions (Core-owned state): surfaces
 * and the upcoming S3 1.2 dispatch gate ask about one connection; nothing
 * outside the owning transport can create or mutate entries.
 */
export interface VerifiedPeerSessionPort {
  /** The verified session bound to this connection id, or undefined. */
  verifiedSessionFor(connectionId: string): OsVerifiedPeerSession | undefined;
}

/** Writable side, restricted to the transport that performs OS verification. */
export interface VerifiedPeerSessionRegistry extends VerifiedPeerSessionPort {
  /** Bind one verified session to its connection id (transport-internal). */
  record(session: OsVerifiedPeerSession): void;
  /** Drop the session of a closed connection (one session per connection). */
  forget(connectionId: string): void;
  /** Open-connection count (concern-test observation; not a wire surface). */
  readonly size: number;
}

export function createVerifiedPeerSessionRegistry(): VerifiedPeerSessionRegistry {
  const sessions = new Map<string, OsVerifiedPeerSession>();
  return {
    record(session) {
      sessions.set(session.connectionId, session);
    },
    forget(connectionId) {
      sessions.delete(connectionId);
    },
    verifiedSessionFor(connectionId) {
      return sessions.get(connectionId);
    },
    get size() {
      return sessions.size;
    },
  };
}

/**
 * Command names that will REQUIRE a positively OS-verified peer session at
 * dispatch. The current seam schema (1.1) has a closed command vocabulary
 * with no S3 command, so today this set names only the reserved S3 1.2
 * execution shape — names the envelope decoder already rejects as unknown
 * command types. Listing them here keeps the authorization requirement
 * explicit and testable BEFORE the 1.2 Contract PR lands; the contract slice
 * must never introduce an S3 command that is absent from this set.
 */
export const OS_VERIFIED_PEER_COMMANDS: readonly string[] = ['EXECUTE_S3_SELECTED_MEDIA'];

/** True when a command type may only be dispatched for an OS-verified peer. */
export function requiresOsVerifiedPeer(commandType: string): boolean {
  return OS_VERIFIED_PEER_COMMANDS.includes(commandType);
}

/**
 * Transport/session authorization gate for one decoded command frame. Legacy
 * 1.0/1.1 commands pass unchanged (loopback TCP stays functional); any
 * command in `OS_VERIFIED_PEER_COMMANDS` fails closed unless the frame
 * arrived over a connection with a positively verified same-user session.
 */
export function assertPeerTransportAuthorization(input: {
  readonly commandType: string;
  readonly verifiedPeer: OsVerifiedPeerSession | undefined;
}): SeamResult<void> {
  if (!requiresOsVerifiedPeer(input.commandType)) {
    return seamOk(undefined);
  }
  if (
    input.verifiedPeer === undefined ||
    !input.verifiedPeer.sameUserAsCore ||
    input.verifiedPeer.transportKind !== 'WINDOWS_NAMED_PIPE'
  ) {
    return seamFail([
      seamDiagnostic(
        'TRANSPORT_UNAUTHORIZED',
        'peer',
        'command requires a positively OS-verified same-user peer session; legacy loopback or unverified transports are not eligible',
        'L2-S3-§2.1',
      ),
    ]);
  }
  return seamOk(undefined);
}
