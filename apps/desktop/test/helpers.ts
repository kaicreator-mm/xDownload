/**
 * T014 desktop component/interaction test helpers.
 *
 * Core is stood in by the REAL seam authority server over the REAL loopback
 * transport (per IMPLEMENTATION_MAP), plus a deterministic scripted
 * transport for wire-corruption cases the loopback cannot produce. No
 * network beyond 127.0.0.1, no filesystem, no real desktop shell, no clock
 * dependence (fixed ISO clock).
 */

import { expect } from 'vitest';
import {
  createCoreSeamServer,
  createLoopbackClientTransport,
  createLoopbackServerTransport,
  currentSeamSchemaIdentity,
  type CoreSeamServer,
  type ExpectedPeerScope,
  type SeamClientConnection,
  type SeamClientTransport,
  type SeamListenTarget,
  type SeamServerTransport,
  type SeamConnectionHandler,
} from '@xdownload/core-seam';
import {
  currentSchemaIdentity,
  makeCollectionId,
  makeContractId,
  makeLogicalTargetId,
  type DomainValidationResult,
  type TerminalResult,
} from '@xdownload/domain-contracts';
import {
  createDesktopUiAdapter,
  type DesktopIntentInput,
  type DesktopUiAdapter,
  type InteractionOutcome,
} from '../src/index.ts';

export const FIXED_NOW = '2026-10-04T09:00:00Z';

/** The expected same-install/same-user scope the test seam admits. */
const EXPECTED_PEER: ExpectedPeerScope = {
  installId: 'install-001',
  userId: 'user-001',
  allowedSurfaces: ['CLI', 'DESKTOP_UI', 'BROWSER_EXTENSION'],
};

/** Unwrap a fixture id result or fail the test run. */
export function mustId<T>(result: DomainValidationResult<T>): T {
  if (!result.ok) {
    throw new Error(`fixture id rejected: ${result.diagnostics.map((d) => d.message).join('; ')}`);
  }
  return result.value;
}

/** Typed scope builders for fixtures (canonical id factories). */
export function singleResourceScope(targetRef: string) {
  return { kind: 'single_resource' as const, targetId: mustId(makeLogicalTargetId(targetRef)) };
}

export function collectionPageRangeScope(collection: string, fromPage: number, toPage: number) {
  return {
    kind: 'collection_page_range' as const,
    collectionIdentity: mustId(makeCollectionId(collection)),
    fromPage,
    toPage,
  };
}

export function entireCollectionScope(collection: string) {
  return {
    kind: 'entire_supported_collection' as const,
    collectionIdentity: mustId(makeCollectionId(collection)),
  };
}

let nextCoreRequestId = 0;

export function coreRequestId(): string {
  nextCoreRequestId += 1;
  return `req-core-${String(nextCoreRequestId).padStart(6, '0')}`;
}

export interface CoreHandle {
  readonly server: CoreSeamServer;
  readonly target: SeamListenTarget;
  stop(): Promise<void>;
}

/** Start the real seam authority server on the loopback transport. */
export async function startCore(): Promise<CoreHandle> {
  const result = createCoreSeamServer({ expectedPeer: EXPECTED_PEER });
  if (!result.ok) {
    throw new Error('seam server construction failed');
  }
  const server = result.value;
  const transport: SeamServerTransport = createLoopbackServerTransport({
    host: '127.0.0.1',
    port: 0,
  });
  const handler: SeamConnectionHandler = {
    onFrame: (connection, frame) => {
      connection.send(JSON.stringify(server.handleFrame(frame)));
    },
    onConnectionEnded: () => undefined,
  };
  const target = await transport.start(handler);
  return { server, target, stop: () => transport.stop() };
}

export function desktopAdapter(core: CoreHandle): DesktopUiAdapter {
  return createDesktopUiAdapter({
    transport: createLoopbackClientTransport(),
    target: core.target,
    installId: 'install-001',
    userId: 'user-001',
    now: () => FIXED_NOW,
  });
}

// ---- scripted transport for wire-corruption/stale cases -------------------

export interface ScriptedResponse {
  /** Builds the raw response frame for one submitted request frame. */
  readonly respond: (requestFrame: string) => string;
}

/**
 * Deterministic in-process transport standing in for a misbehaving wire:
 * each request gets one scripted response frame, then the connection ends.
 */
export function scriptedTransport(script: readonly ScriptedResponse[]): SeamClientTransport {
  let nextScript = 0;
  return {
    connect(_target: SeamListenTarget): Promise<SeamClientConnection> {
      const step = script[Math.min(nextScript, script.length - 1)];
      nextScript += 1;
      if (step === undefined) {
        return Promise.reject(new Error('scripted transport has no scripted response'));
      }
      return new Promise((resolve) => {
        let frameHandler: ((frame: string) => void) | undefined;
        let endHandler: (() => void) | undefined;
        resolve({
          onFrame(handler) {
            frameHandler = handler;
          },
          onEnded(handler) {
            endHandler = handler;
          },
          send(requestFrame: string) {
            const response = step.respond(requestFrame);
            queueMicrotask(() => {
              frameHandler?.(response);
              endHandler?.();
            });
          },
          close() {
            return Promise.resolve();
          },
        });
      });
    },
  };
}

/** Scripted PROJECTION response carrying an arbitrary (possibly corrupt) payload. */
export function projectionPayloadScript(payload: unknown): readonly ScriptedResponse[] {
  return [
    {
      respond: (requestFrame) => {
        const request = JSON.parse(requestFrame) as { requestId: string };
        return JSON.stringify({
          schemaIdentity: currentSeamSchemaIdentity(),
          kind: 'response',
          inReplyTo: request.requestId,
          outcome: 'PROJECTION',
          projection: payload,
        });
      },
    },
  ];
}

// ---- intent fixtures -------------------------------------------------------

export function singleResourceIntent(
  overrides: Partial<DesktopIntentInput> = {},
): DesktopIntentInput {
  const target = makeLogicalTargetId('target-file-001');
  if (!target.ok) {
    throw new Error('fixture target id invalid');
  }
  return {
    targetRef: 'target-file-001',
    intentType: 'SINGLE_RESOURCE',
    requestedScope: { kind: 'single_resource', targetId: target.value },
    continuationScope: { kind: 'NONE' },
    automationMode: 'ASSISTED',
    authorizationContextRef: 'authctx/local-001',
    ...overrides,
  };
}

export function collectionIntent(overrides: Partial<DesktopIntentInput> = {}): DesktopIntentInput {
  const target = makeLogicalTargetId('target-collection-root-001');
  if (!target.ok) {
    throw new Error('fixture target id invalid');
  }
  return {
    targetRef: 'target-collection-root-001',
    intentType: 'COLLECTION',
    requestedScope: entireCollectionScope('collection/playlist-001'),
    continuationScope: { kind: 'NONE' },
    automationMode: 'ASSISTED',
    authorizationContextRef: 'authctx/local-001',
    collectionIdentity: 'collection/playlist-001',
    membershipBasis: { basis: 'SUPPORTED_TEMPLATE', templateRef: 'template/gallery-v1' },
    ...overrides,
  };
}

export const NO_AMBIGUITY = {
  ambiguousMaterialMemberIds: [],
  candidateCount: 1,
  autoEvidenceSufficient: false,
};

export function memberIds(count: number, prefix = 'member'): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${prefix}-${String(index + 1).padStart(3, '0')}`,
  );
}

/** Enter a single-resource intent and confirm scope through the real seam. */
export async function confirmSingleResourceTask(
  adapter: DesktopUiAdapter,
  overrides: Partial<DesktopIntentInput> = {},
): Promise<InteractionOutcome> {
  const entered = adapter.enterIntent({
    intent: singleResourceIntent(overrides),
    workflowFacts: NO_AMBIGUITY,
  });
  if (entered.refusals.length > 0) {
    return entered;
  }
  return adapter.confirmScope();
}

/**
 * Enter a collection intent with an explicit ambiguous set and answer the
 * Core-produced plan with the surface interaction that plan asks for
 * (scope → batch → material items → manual selection).
 */
export async function confirmCollectionTask(
  adapter: DesktopUiAdapter,
  memberCount: number,
  overrides: Partial<DesktopIntentInput> = {},
): Promise<InteractionOutcome> {
  const members = memberIds(memberCount);
  const entered = adapter.enterIntent({
    intent: collectionIntent(overrides),
    workflowFacts: {
      ambiguousMaterialMemberIds: members,
      candidateCount: memberCount,
      autoEvidenceSufficient: false,
    },
  });
  if (entered.refusals.length > 0) {
    return entered;
  }
  const plan = JSON.stringify(entered.display);
  if (plan.includes('BATCH_GROUP')) {
    return adapter.confirmBatchSelection();
  }
  if (plan.includes('MATERIAL_ITEM')) {
    for (const member of members) {
      const answered = adapter.answerMaterialItem(member, 'CONFIRMED');
      expect(answered.refusals).toStrictEqual([]);
    }
    return adapter.submitMaterialSelection();
  }
  if (plan.includes('MANUAL_SELECTION_UI')) {
    return adapter.chooseManualSelection(members);
  }
  return adapter.proceedAuto();
}

// ---- Core-side terminal projection (projector lane stand-in) ---------------

/** Terminal-result fixture in the canonical decoded shape. */
export function terminalResult(
  contractRef: string,
  overrides: Partial<TerminalResult> = {},
): TerminalResult {
  return {
    schemaIdentity: currentSchemaIdentity(),
    contractId: mustId(makeContractId(contractRef)),
    requestFulfillment: 'COMPLETE',
    targetResolution: 'RESOLVED',
    selectionAcquisition: 'COMPLETE',
    coverage: 'NOT_APPLICABLE',
    stopReason: 'NONE',
    validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
    recordedAt: FIXED_NOW,
    ...overrides,
  };
}

export interface CoreTerminalOptions {
  readonly result: TerminalResult;
  readonly selectedValidationOutcomes?: readonly {
    memberId: string;
    requiredValidationPassed: boolean;
  }[];
  readonly coverageEvidence?: unknown;
  readonly knownAuthInaccessibleRequestedCount?: number;
}

/**
 * Drive the Core-side terminal projection for an aggregate (the projector
 * lane; the desktop never submits this command itself).
 */
export function coreProjectTerminal(
  core: CoreHandle,
  aggregateId: string,
  options: CoreTerminalOptions,
): { readonly outcome: string; readonly diagnostics?: unknown } {
  const projection = core.server.inspectProjection(aggregateId);
  if (projection === undefined) {
    throw new Error(`aggregate ${aggregateId} does not exist on the seam server`);
  }
  const payload: Record<string, unknown> = {
    result: { ...options.result, schemaIdentity: currentSchemaIdentity() },
  };
  if (options.selectedValidationOutcomes !== undefined) {
    payload.selectedValidationOutcomes = options.selectedValidationOutcomes;
  }
  if (options.coverageEvidence !== undefined) {
    payload.coverageEvidence = options.coverageEvidence;
  }
  if (options.knownAuthInaccessibleRequestedCount !== undefined) {
    payload.knownAuthInaccessibleRequestedCount = options.knownAuthInaccessibleRequestedCount;
  }
  const response = core.server.handleFrame(
    JSON.stringify({
      schemaIdentity: currentSeamSchemaIdentity(),
      kind: 'command',
      commandType: 'PROJECT_TERMINAL_RESULT',
      peer: { installId: 'install-001', userId: 'user-001', surface: 'CLI' },
      requestId: coreRequestId(),
      aggregateId,
      expectedRevision: projection.contract.revision,
      correlation: {},
      issuedAt: FIXED_NOW,
      payload,
    }),
  );
  return {
    outcome: response.outcome,
    diagnostics: response.diagnostics,
  };
}

/** Read the live projection straight from the Core stand-in. */
export function coreProjection(core: CoreHandle, aggregateId: string) {
  return core.server.inspectProjection(aggregateId);
}

export function findSection(outcomeOrView: InteractionOutcome['display'], title: string) {
  return outcomeOrView.sections.find((section) => section.title.startsWith(title));
}

/** The most recent routed command of one type (outcome.routed is the full history). */
export function lastRoutedOfType(outcome: InteractionOutcome, commandType: string) {
  const matches = outcome.routed.filter((r) => r.commandType === commandType);
  return matches[matches.length - 1];
}

/** Deterministic text rendering of a display tree (label: value lines). */
export { surfaceToText } from '../src/index.ts';

export function sectionLines(
  outcomeOrView: InteractionOutcome['display'],
  title: string,
): string[] {
  const target = findSection(outcomeOrView, title);
  return target === undefined
    ? []
    : target.lines.map((l) =>
        l.note === undefined ? `${l.label}: ${l.value}` : `${l.label}: ${l.value} (${l.note})`,
      );
}
