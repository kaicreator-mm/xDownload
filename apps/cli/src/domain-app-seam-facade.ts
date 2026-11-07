/**
 * v0.2 T04 — the CLI-side public Domain App facade bound to the EXISTING
 * Core seam.
 *
 * CF-1 chain hop: `main.ts` argv → `domain-app-commands` → THIS facade →
 * the admitted K composition inside the installed Core process (whose
 * v0.2 route drives `submitConfirmedDownload`). The facade implements the
 * frozen public `DomainApp` port (`domain-app-facade.ts`) by mapping every
 * member onto the explicit v0.2 seam route (`DOMAIN_APP_SEND` command /
 * `READ_JOB_PROJECTION` query). It never composes, starts or stops a K:
 * `stop()` closes the lifecycle-independent seam client only, and every
 * typed seam refusal surfaces verbatim as the public coded-error identity —
 * no transport fallback, no locally invented lifecycle truth.
 *
 * Wire mapping (frozen T01/T02 route facts):
 * - `send(intent)` → one `DOMAIN_APP_SEND` envelope whose `requestId` IS the
 *   intent's `messageId` and whose `aggregateId` IS the intent's
 *   `instanceKey`; the payload intent carries `requestId`/`lineageId`/
 *   `allowedOperation` from those same keys plus the caller-supplied input
 *   verbatim. The Core re-validates the exact-key no-widening contract
 *   authoritatively — this mapping invents nothing.
 * - `query(selector)` → one `READ_JOB_PROJECTION` envelope addressed to the
 *   selector's `instanceKey`; the truthful job projection rides back as the
 *   snapshot. SDK deployment identity fields (deployedAppId/tenantId/appId)
 *   are not carried on the seam route and stay empty strings — never
 *   fabricated.
 * - `subscribe()` → typed refusal: the v0.2 seam route carries no
 *   subscription frames; polling `query` is the only admitted observation.
 */

import {
  createSeamClient,
  currentSeamSchemaIdentity,
  makeCommandRequestId,
  type CommandEnvelope,
  type CommandRequestId,
  type PeerIdentity,
  type QueryEnvelope,
  type SeamClient,
  type SeamClientTransport,
  type SeamListenTarget,
  type V02CommandEnvelope,
  type V02JobQueryEnvelope,
} from '@xdownload/core-seam';
import type {
  DomainAppFacade,
  V10PublicIntent,
  V10ScopedSnapshotAnswer,
  V10ScopedSnapshotManyAnswer,
  V10ScopedSnapshotQuery,
  V10ScopedSubscriptionEvent,
  V10Subscription,
} from './domain-app-facade.ts';

/** The public typed-error identity of a seam route refusal (stable wire code). */
export class SeamRefusalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SeamRefusalError';
    this.code = code;
  }
}

export interface SeamDomainAppFacadeOptions {
  readonly transport: SeamClientTransport;
  readonly target: SeamListenTarget;
  /** Presenting peer; authorization is re-decided by the seam per frame. */
  readonly peer: PeerIdentity;
  /** ISO-8601 clock for envelope provenance stamps. */
  readonly now: () => string;
  /** Reconnect attempts per request after a connection loss (seam default 3). */
  readonly maxReconnectAttempts?: number;
}

export interface SeamDomainAppFacade extends DomainAppFacade {
  /** Close the seam client connection; never affects Core lifetime. */
  readonly close: () => Promise<void>;
}

function firstDiagnosticCode(response: {
  readonly diagnostics?: readonly { readonly code: string; readonly message: string }[];
}): { code: string; message: string } {
  const first = response.diagnostics?.[0];
  return {
    code: first?.code ?? 'SEAM_REJECTED',
    message: first?.message ?? 'the Core seam refused the v0.2 route call',
  };
}

/**
 * Brand a caller-supplied identity as a seam command/request id. The CLI
 * command layer already validates the same grammar (identical pattern), so
 * a failure here is a fail-closed invariant breach, never a silent rewrite.
 */
function commandId(raw: string): CommandRequestId {
  const branded = makeCommandRequestId(raw);
  if (!branded.ok) {
    throw new SeamRefusalError(
      'COMMAND_IDENTITY_INVALID',
      `the command identity '${raw}' is not a valid seam requestId`,
    );
  }
  return branded.value;
}

/**
 * Bind the public Domain App facade to the installed Core's explicit v0.2
 * seam route. One facade per CLI invocation; `close()` (and `stop()`) only
 * release the client transport.
 */
export function createSeamDomainAppFacade(
  options: SeamDomainAppFacadeOptions,
): SeamDomainAppFacade {
  const client: SeamClient = createSeamClient({
    transport: options.transport,
    target: options.target,
    peer: options.peer,
    ...(options.maxReconnectAttempts === undefined
      ? {}
      : { maxReconnectAttempts: options.maxReconnectAttempts }),
  });
  let queryCounter = 0;
  const queryRequestId = (): CommandRequestId => {
    queryCounter += 1;
    return commandId(`req-v02q-${String(queryCounter)}`);
  };

  /**
   * Client/transport failures surface as UNTYPED transport errors — the
   * seam client has already exhausted its reconnect budget when it throws,
   * and a system error code (ECONNREFUSED, ETIMEDOUT, ...) is never
   * promoted to a typed public refusal (no silent transport fallback in
   * either direction).
   */
  async function transportBound<T>(call: Promise<T>): Promise<T> {
    try {
      return await call;
    } catch (thrown) {
      throw new Error(thrown instanceof Error ? thrown.message : 'seam transport failure');
    }
  }

  const sendOne = async (intent: V10PublicIntent): Promise<Record<string, unknown>> => {
    const wireIntent: Record<string, unknown> = {
      ...(intent.input as Record<string, unknown>),
      requestId: intent.messageId,
      lineageId: intent.instanceKey,
      allowedOperation: intent.intentType,
    };
    const envelope: V02CommandEnvelope = {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'command',
      route: 'v0.2',
      commandType: 'DOMAIN_APP_SEND',
      peer: options.peer,
      requestId: commandId(intent.messageId),
      aggregateId: intent.instanceKey,
      issuedAt: options.now(),
      payload: { intent: wireIntent },
    };
    // The seam client is transport-correlation only: the server decodes the
    // explicit route from the frame itself (core-seam v02 route contract).
    const response = await transportBound(
      client.submitCommand(envelope as unknown as CommandEnvelope),
    );
    if (response.outcome === 'ACCEPTED') {
      // Admission receipt: acceptance is never final success (the truthful
      // outcome lands in the durable route log and the job projection).
      return { kind: 'ACCEPTED' };
    }
    if (response.outcome === 'REJECTED') {
      const refusal = firstDiagnosticCode(response);
      throw new SeamRefusalError(refusal.code, refusal.message);
    }
    throw new SeamRefusalError(
      'SEAM_OUTCOME_UNAVAILABLE',
      `unexpected seam outcome '${response.outcome}' for a v0.2 Domain App send`,
    );
  };

  const queryOne = async (selector: V10ScopedSnapshotQuery): Promise<V10ScopedSnapshotAnswer> => {
    const envelope: V02JobQueryEnvelope = {
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'query',
      route: 'v0.2',
      queryType: 'READ_JOB_PROJECTION',
      peer: options.peer,
      requestId: queryRequestId(),
      aggregateId: selector.instanceKey,
      issuedAt: options.now(),
    };
    const response = await transportBound(client.submitQuery(envelope as QueryEnvelope));
    if (response.outcome === 'PROJECTION') {
      return {
        // The v0.2 seam route is lineage-scoped: SDK deployment identity is
        // not carried on the wire and stays empty, never fabricated.
        target: {
          deployedAppId: '',
          tenantId: '',
          appId: '',
          businessPackageId: selector.businessPackageId ?? '',
          workflowId: selector.workflowId,
          instanceKey: selector.instanceKey,
        },
        snapshot: response.projection,
      };
    }
    if (response.outcome === 'REJECTED') {
      const refusal = firstDiagnosticCode(response);
      throw new SeamRefusalError(refusal.code, refusal.message);
    }
    throw new SeamRefusalError(
      'SEAM_OUTCOME_UNAVAILABLE',
      `unexpected seam outcome '${response.outcome}' for a v0.2 job projection read`,
    );
  };

  return {
    send: sendOne,
    query: (async (
      selector: V10ScopedSnapshotQuery | readonly V10ScopedSnapshotQuery[],
    ): Promise<V10ScopedSnapshotAnswer | readonly V10ScopedSnapshotManyAnswer[]> => {
      if (Array.isArray(selector)) {
        // Per-entry truth: one refusal stays scoped to its own index and
        // never masks the other answers.
        return Promise.all(
          selector.map(async (entry, index): Promise<V10ScopedSnapshotManyAnswer> => {
            try {
              const answer = await queryOne(entry);
              return {
                status: 'answered',
                index,
                target: answer.target,
                snapshot: answer.snapshot,
              };
            } catch (thrown) {
              if (thrown instanceof SeamRefusalError) {
                return { status: 'refused', index, code: thrown.code, message: thrown.message };
              }
              return {
                status: 'refused',
                index,
                code: 'UNEXPECTED_ERROR',
                message: thrown instanceof Error ? thrown.message : String(thrown),
              };
            }
          }),
        );
      }
      return queryOne(selector as V10ScopedSnapshotQuery);
    }) as DomainAppFacade['query'],
    subscribe: async (
      _selector: V10ScopedSnapshotQuery,
      _listener: (event: V10ScopedSubscriptionEvent) => void,
    ): Promise<V10Subscription> => {
      throw new SeamRefusalError(
        'SUBSCRIBE_NOT_ADMITTED',
        'the v0.2 core seam route carries no subscription frames; poll status instead',
      );
    },
    stop: (): void => {
      void client.close();
    },
    close: (): Promise<void> => client.close(),
  };
}
