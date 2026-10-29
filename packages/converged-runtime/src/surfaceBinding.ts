/**
 * T017 one-authority surface binding — the shared convergence glue through
 * which EVERY product surface (CLI, DESKTOP_UI, BROWSER_EXTENSION) connects
 * to the single `@xdownload/core-runtime` authority via the T004 seam.
 *
 * The binder is deliberately thin: it validates the surface kind against the
 * T004 `SURFACE_KINDS`, stamps the surface's `PeerIdentity` onto every
 * envelope (authorization itself is re-decided per frame by the seam server,
 * never inherited and never pre-admitted here), submits canonical commands/
 * queries through `createSeamClient`, and returns `SeamResponse` values
 * VERBATIM. There is no surface-local status derivation, no private store,
 * no per-surface command vocabulary, and no success boolean: the same
 * canonical command through any bound surface yields the same response class
 * and the same six-dimension terminal projection, rendered (never
 * recomputed) per surface.
 *
 * Disconnect is explicit degradation: a failed read surfaces the transport
 * failure verbatim (`degradedState`) — never a fabricated status/progress.
 */

import {
  SURFACE_KINDS,
  createSeamClient,
  currentSeamSchemaIdentity,
  makeCommandRequestId,
  makePeerInstallId,
  makePeerUserId,
  makeSeamRevision,
  type CommandEnvelope,
  type CommandType,
  type PeerIdentity,
  type QueryEnvelope,
  type SeamClient,
  type SeamClientTransport,
  type SeamCorrelation,
  type SeamListenTarget,
  type SeamResponse,
  type SurfaceKind,
} from '@xdownload/core-seam';

export { SURFACE_KINDS };
export type { SurfaceKind };

/** Composition error for a malformed surface identity (fail closed). */
export class SurfaceBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SurfaceBindingError';
  }
}

export interface SurfaceBindingInput {
  /** The surface kind is fixed per adapter; it is never chosen per call. */
  readonly surface: SurfaceKind;
  readonly installId: string;
  readonly userId: string;
  readonly transport: SeamClientTransport;
  readonly target: SeamListenTarget;
  /** Deterministic id allocator for idempotent request identities. */
  readonly makeRequestId: () => string;
  /** ISO-8601 issue-time source; provenance fact only. */
  readonly now?: () => string;
  /** Reconnect attempts per request after a connection loss (seam default 3). */
  readonly maxReconnectAttempts?: number;
}

export interface CanonicalCommandInput {
  readonly commandType: CommandType;
  readonly aggregateId: string;
  /** Raw payload; becomes canonical only via Core's domain decoders. */
  readonly payload?: unknown;
  readonly expectedRevision?: number;
  /** Explicit idempotent identity; replays across surfaces converge on it. */
  readonly requestId?: string;
  readonly correlation?: SeamCorrelation;
}

/** One surface bound to the single Core authority through the T004 seam. */
export interface BoundSurface {
  readonly surface: SurfaceKind;
  readonly peer: PeerIdentity;
  readonly client: SeamClient;
  /**
   * Submit one canonical command; the response is the verbatim SeamResponse
   * (ACCEPTED/REJECTED with diagnostics/PROJECTION). Rendering is the
   * surface's only remaining job.
   */
  submitCanonicalCommand(input: CanonicalCommandInput): Promise<SeamResponse>;
  /** Read the Core-owned projection for one aggregate (read-only, safe to repeat). */
  readProjection(aggregateId: string, requestId?: string): Promise<SeamResponse>;
  /** Close the client connection; never affects Core lifetime. */
  close(): Promise<void>;
}

function checkBranded(
  result: { readonly ok: boolean; readonly diagnostics?: readonly { readonly message: string }[] },
  raw: string,
  what: string,
): string {
  if (!result.ok) {
    throw new SurfaceBindingError(
      `${what} '${raw}' was rejected by the seam id rules${result.diagnostics?.[0]?.message === undefined ? '' : `: ${result.diagnostics[0].message}`}`,
    );
  }
  return raw;
}

/**
 * Bind one surface to the single Core authority. Every surface gets the SAME
 * binder; the only per-surface fact is its fixed `SurfaceKind` peer identity.
 */
export function bindSurfaceToCore(input: SurfaceBindingInput): BoundSurface {
  if (!SURFACE_KINDS.includes(input.surface)) {
    throw new SurfaceBindingError(`unknown surface kind '${String(input.surface)}'`);
  }
  if (input.installId.length === 0 || input.userId.length === 0) {
    throw new SurfaceBindingError('surface binding requires a non-empty install/user identity');
  }
  checkBranded(makePeerInstallId(input.installId), input.installId, 'installId');
  checkBranded(makePeerUserId(input.userId), input.userId, 'userId');
  const peer: PeerIdentity = {
    installId: input.installId,
    userId: input.userId,
    surface: input.surface,
  };
  const client = createSeamClient({
    transport: input.transport,
    target: input.target,
    peer: peer,
    ...(input.maxReconnectAttempts === undefined
      ? {}
      : { maxReconnectAttempts: input.maxReconnectAttempts }),
  });
  const now = input.now ?? (() => new Date().toISOString());
  return {
    surface: input.surface,
    peer: peer,
    client: client,
    async submitCanonicalCommand(canonical: CanonicalCommandInput): Promise<SeamResponse> {
      const rawRequestId = canonical.requestId ?? input.makeRequestId();
      const requestId = checkBranded(makeCommandRequestId(rawRequestId), rawRequestId, 'requestId');
      const revision = makeSeamRevision(canonical.expectedRevision ?? 0);
      if (!revision.ok) {
        throw new SurfaceBindingError('expectedRevision must be a non-negative integer');
      }
      const envelope: CommandEnvelope = {
        schemaIdentity: currentSeamSchemaIdentity(),
        kind: 'command',
        commandType: canonical.commandType,
        peer: peer,
        requestId: requestId as CommandEnvelope['requestId'],
        aggregateId: canonical.aggregateId,
        expectedRevision: revision.value as CommandEnvelope['expectedRevision'],
        correlation: canonical.correlation ?? {},
        issuedAt: now(),
        payload: canonical.payload ?? {},
      };
      return client.submitCommand(envelope);
    },
    async readProjection(aggregateId: string, requestId?: string): Promise<SeamResponse> {
      const rawRequestId = requestId ?? input.makeRequestId();
      const query: QueryEnvelope = {
        schemaIdentity: currentSeamSchemaIdentity(),
        kind: 'query',
        queryType: 'READ_PROJECTION',
        peer: peer,
        requestId: checkBranded(
          makeCommandRequestId(rawRequestId),
          rawRequestId,
          'requestId',
        ) as QueryEnvelope['requestId'],
        aggregateId: aggregateId,
        issuedAt: now(),
      };
      return client.submitQuery(query);
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

/**
 * Canonical render bytes of a Core projection: the exact thing every surface
 * shares. Parity is achieved by rendering the same projection bytes — never
 * by syncing per-surface derived state. This renders verbatim; it never
 * recomputes. (The seam client types the projection `unknown` — the render
 * is the verbatim JSON of whatever Core projected.)
 */
export function renderProjectionBytes(projection: unknown): string {
  return JSON.stringify(projection);
}

/** Explicit degraded state: the verbatim transport failure, no fabricated status. */
export interface DegradedState {
  readonly degraded: true;
  /** The verbatim failure detail; surfaces render it, never a status. */
  readonly detail: string;
}

/**
 * Map a transport failure to the explicit degraded display state. There is
 * deliberately no status/progress synthesis here: a disconnected surface
 * renders degradation, and reconnect re-syncs from projections only.
 */
export function degradedState(error: unknown): DegradedState {
  return {
    degraded: true,
    detail: error instanceof Error ? error.message : 'core seam connection failed',
  };
}
