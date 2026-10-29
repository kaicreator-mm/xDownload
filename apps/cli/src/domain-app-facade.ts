/**
 * v0.2 T07 — CLI-side port of the DomainHarness public DomainApp facade.
 *
 * This is a STRUCTURAL MIRROR of the frozen public surface of
 * `@kaicreator/domain-harness-microkernel` 0.10.2-rc.0
 * (`dist/domain-app.d.ts`: `DomainApp`, `V10PublicIntent`,
 * `V10ScopedSnapshotQuery`, `V10ScopedSnapshotAnswer`,
 * `V10ScopedSnapshotManyAnswer`, `V10Subscription`,
 * `V10ScopedSubscriptionEvent`), pinned by the vendored SDK under
 * `packages/download-domain-app/vendor/sdk/`.
 *
 * Why a mirror: the T07 frozen write set is exactly
 * `apps/cli/src/domain-app-*.ts`, so `apps/cli/package.json` cannot gain a
 * dependency here. TypeScript structural typing keeps the port honest: the
 * real SDK facade (and any test fake) satisfies `DomainAppFacade` if and only
 * if it matches the public shape. Only the PUBLIC facade shapes are mirrored
 * — no kernel identity, no store types, no Host wiring crosses this file.
 */

/**
 * Public intent shape accepted by `DomainApp.send` (frozen v0.10 public
 * surface). Exactly four keys; the kernel owns everything else.
 */
export interface V10PublicIntent {
  readonly intentType: string;
  readonly instanceKey: string;
  readonly messageId: string;
  readonly input: Record<string, unknown>;
}

/** Public scoped-snapshot query selector (a selector, never a grant). */
export interface V10ScopedSnapshotQuery {
  readonly workflowId: string;
  readonly instanceKey: string;
  readonly businessPackageId?: string;
}

/** The exact authorized target and the selected kernel snapshot it answered. */
export interface V10ScopedSnapshotAnswer {
  readonly target: Readonly<{
    readonly deployedAppId: string;
    readonly tenantId: string;
    readonly appId: string;
    readonly businessPackageId: string;
    readonly workflowId: string;
    readonly instanceKey: string;
  }>;
  readonly snapshot: unknown;
}

/** One truthfully correlated entry of an explicit multi-target query. */
export type V10ScopedSnapshotManyAnswer =
  | {
      readonly status: 'answered';
      readonly index: number;
      readonly target: Readonly<{
        readonly deployedAppId: string;
        readonly tenantId: string;
        readonly appId: string;
        readonly businessPackageId: string;
        readonly workflowId: string;
        readonly instanceKey: string;
      }>;
      readonly snapshot: unknown;
    }
  | {
      readonly status: 'refused';
      readonly index: number;
      readonly code: string;
      readonly message: string;
    };

/** Frozen public subscription event shape (`kind` is the receipt status). */
export interface V10ScopedSubscriptionEvent {
  readonly kind: string;
  readonly occurrenceId: string;
  readonly target: Readonly<Record<string, unknown>>;
  readonly snapshot?: unknown;
}

export interface V10Subscription {
  unsubscribe(): void;
}

/**
 * The frozen public facade. Own keys are exactly `[send, query, subscribe,
 * stop]`; `send` returns the original receipt as plain data; typed errors
 * carry the Contracts error identity (`name`, stable wire `code`, safe
 * `message`).
 */
export interface DomainAppFacade {
  send(intent: V10PublicIntent): Promise<Record<string, unknown>>;
  query(selector: V10ScopedSnapshotQuery): Promise<V10ScopedSnapshotAnswer>;
  query(
    selectors: readonly V10ScopedSnapshotQuery[],
  ): Promise<readonly V10ScopedSnapshotManyAnswer[]>;
  subscribe(
    selector: V10ScopedSnapshotQuery,
    listener: (event: V10ScopedSubscriptionEvent) => void,
  ): Promise<V10Subscription>;
  stop(): void;
}

/** The frozen public facade key set (mirror of the SDK contract). */
export const DOMAIN_APP_FACADE_KEYS = ['send', 'query', 'subscribe', 'stop'] as const;

/**
 * Structural duck check for the public facade port (all four members are
 * functions). This is a wiring guard for the adapter boundary, not an
 * authority oracle.
 */
export function isDomainAppFacadeLike(value: unknown): value is DomainAppFacade {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return DOMAIN_APP_FACADE_KEYS.every((key) => typeof candidate[key] === 'function');
}

/**
 * The public typed-error identity of the SDK (Contracts `V10CodedFailure`
 * shape): an `Error` carrying a stable string wire `code` plus a safe
 * `message`. Extract it when the thrown value matches; `null` otherwise
 * (an untyped throw is reported as-is, never swallowed).
 */
export function extractCodedFailure(
  thrown: unknown,
): { readonly name: string; readonly code: string; readonly message: string } | null {
  if (typeof thrown !== 'object' || thrown === null || !(thrown instanceof Error)) {
    return null;
  }
  const code = (thrown as { code?: unknown }).code;
  if (typeof code !== 'string' || code.length === 0) {
    return null;
  }
  return { name: thrown.name, code, message: thrown.message };
}
