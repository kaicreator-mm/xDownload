/**
 * U05-T02 suite: Desktop S1 direct-acquisition adapter mapping over an
 * injected deterministic Mock SeamClient transport.
 *
 * ADS R1 authority (#354 Owner item 3): these tests use a deterministic
 * injected/mock transport and are ADAPTER-UNIT EVIDENCE ONLY — never
 * evidence that Core admits `EXECUTE_S1_DIRECT_ACQUISITION` from
 * `DESKTOP_UI`. Combined Core end-to-end admission is a T01-integrated /
 * T03 gate. The peer-identity preservation test against the REAL seam
 * authority (which rejects the S1 command at `peer.surface` until T01
 * integrates) lives in core-authority.test.ts.
 *
 * TEST_MATRIX `s1-direct-acquisition`:
 * - valid URL → submit/confirm → exact S1 execute sequence with the
 *   accepted aggregate binding and canonical payload;
 * - redirect host defaults to the URL host only; optional delivery fields
 *   stay absent;
 * - command acceptance does not become completion; projection truth only;
 * - index query strict shape/bounds/identity checks; typed rejection and
 *   disconnect are explicit failures, never empty successful lists;
 * - retry/reconnect and duplicate invocations preserve the one logical
 *   command identity.
 */

import { describe, expect, it } from 'vitest';
import { currentSeamSchemaIdentity, type SeamClientTransport } from '@xdownload/core-seam';
import {
  S1_JOB_INDEX_QUERY_SUBJECT,
  SINGLE_RESOURCE_WORKFLOW_FACTS,
  createDesktopUiAdapter,
  decodeManagerUrl,
  singleResourceUrlIntent,
  surfaceToText,
  type DesktopUiAdapter,
} from '../src/index.ts';
import { FIXED_NOW, collectionIntent, memberIds } from './helpers.ts';

// The locator doubles as the canonical logical target id, which matches
// [A-Za-z0-9._:@/-]{0,127}: no query strings in this fixture.
const URL = 'https://cdn.example.com:8443/media/clip.mp4';
const URL_HOST = 'cdn.example.com:8443';

interface WireEnvelope {
  readonly kind: string;
  readonly commandType?: string;
  readonly queryType?: string;
  readonly requestId: string;
  readonly aggregateId: string;
  readonly expectedRevision?: number;
  readonly correlation?: unknown;
  readonly peer: { readonly surface: string };
  readonly payload?: unknown;
}

interface MockCore {
  readonly transport: SeamClientTransport;
  /** Every envelope the adapter routed, in wire order. */
  readonly frames: WireEnvelope[];
  handleCommand(envelope: WireEnvelope): Record<string, unknown>;
  handleQuery(envelope: WireEnvelope): Record<string, unknown>;
  /** Command types whose frames receive no response (connection ends). */
  silentCommands: ReadonlySet<string>;
  /** When true, query frames receive no response (connection ends). */
  silentQueries: boolean;
}

/**
 * Deterministic in-process transport standing in for Core. Every frame is
 * captured; handlers build the response frame. Silent frames end the
 * connection without responding, which the seam client surfaces as a
 * rejected in-flight request (fast reconnect attempts, no timeouts).
 */
function startMockCore(): MockCore {
  const frames: WireEnvelope[] = [];
  const mock: MockCore = {
    frames,
    silentCommands: new Set(),
    silentQueries: false,
    handleCommand: () => {
      throw new Error('mock handleCommand not wired by the test');
    },
    handleQuery: () => {
      throw new Error('mock handleQuery not wired by the test');
    },
    transport: {
      connect(_target) {
        let onFrame: (frame: string) => void = () => undefined;
        let onEnded: () => void = () => undefined;
        return Promise.resolve({
          onFrame(handler) {
            onFrame = handler;
          },
          onEnded(handler) {
            onEnded = handler;
          },
          send(frame) {
            const parsed = JSON.parse(frame) as WireEnvelope;
            frames.push(parsed);
            const silent =
              parsed.kind === 'command'
                ? mock.silentCommands.has(parsed.commandType ?? '')
                : parsed.kind === 'query' && mock.silentQueries;
            queueMicrotask(() => {
              if (silent) {
                onEnded();
                return;
              }
              const response =
                parsed.kind === 'command' ? mock.handleCommand(parsed) : mock.handleQuery(parsed);
              onFrame(
                JSON.stringify({
                  schemaIdentity: currentSeamSchemaIdentity(),
                  kind: 'response',
                  inReplyTo: parsed.requestId,
                  ...response,
                }),
              );
            });
          },
          close() {
            return Promise.resolve();
          },
        });
      },
    },
  };
  return mock;
}

function acceptedResponse(
  envelope: WireEnvelope,
  revision: number,
  converged = false,
): Record<string, unknown> {
  return {
    outcome: 'ACCEPTED',
    acceptance: {
      requestId: envelope.requestId,
      aggregateId: envelope.aggregateId,
      revision,
      converged,
    },
  };
}

function rejectedResponse(code: string, path: string, message: string): Record<string, unknown> {
  return { outcome: 'REJECTED', diagnostics: [{ code, path, message }] };
}

/** Minimal ACTIVE lineage projection payload for one aggregate. */
function activeProjection(contractId: string, revision: number): Record<string, unknown> {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    contract: {
      contractId,
      status: 'CONFIRMED',
      intentType: 'SINGLE_RESOURCE',
      revision,
    },
    lineage: {
      status: 'ACTIVE',
      failedMemberCount: 0,
      failedMemberIds: [],
      retriedMemberIds: [],
    },
  };
}

/** Verbatim six-dimension terminal result fixture (all known literals). */
function terminalFixture(contractId: string): Record<string, unknown> {
  return {
    schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
    contractId,
    requestFulfillment: 'COMPLETE',
    targetResolution: 'RESOLVED',
    selectionAcquisition: 'COMPLETE',
    coverage: 'NOT_APPLICABLE',
    stopReason: 'NONE',
    validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
    recordedAt: FIXED_NOW,
  };
}

/**
 * The standard confirmed-task flow: SUBMIT_CONTRACT/CONFIRM_SNAPSHOT accept
 * with a bumping revision; READ_PROJECTION serves the current revision and
 * any terminal injected via `projectTerminal`.
 */
function installConfirmedTaskFlow(mock: MockCore): {
  readonly revisions: Map<string, number>;
  readonly projectTerminal: (contractId: string) => void;
} {
  const revisions = new Map<string, number>();
  const terminals = new Map<string, Record<string, unknown>>();
  mock.handleCommand = (envelope) => {
    if (
      envelope.commandType === 'SUBMIT_CONTRACT' ||
      envelope.commandType === 'CONFIRM_SNAPSHOT' ||
      envelope.commandType === 'EXECUTE_S1_DIRECT_ACQUISITION'
    ) {
      const revision = (revisions.get(envelope.aggregateId) ?? 0) + 1;
      revisions.set(envelope.aggregateId, revision);
      return acceptedResponse(envelope, revision);
    }
    return rejectedResponse(
      'UNEXPECTED_COMMAND',
      'commandType',
      `mock did not expect command '${String(envelope.commandType)}'`,
    );
  };
  mock.handleQuery = (envelope) => {
    const revision = revisions.get(envelope.aggregateId) ?? 1;
    const base = activeProjection(envelope.aggregateId, revision);
    const terminal = terminals.get(envelope.aggregateId);
    return {
      outcome: 'PROJECTION',
      projection: terminal === undefined ? base : { ...base, terminal },
    };
  };
  return {
    revisions,
    projectTerminal: (contractId) => {
      terminals.set(contractId, terminalFixture(contractId));
    },
  };
}

function mockAdapter(mock: MockCore): DesktopUiAdapter {
  return createDesktopUiAdapter({
    transport: mock.transport,
    target: { host: '127.0.0.1', port: 0 },
    installId: 'install-001',
    userId: 'user-001',
    now: () => FIXED_NOW,
  });
}

/** Enter a single-resource URL intent and confirm scope through the mock. */
async function confirmUrlTask(
  adapter: DesktopUiAdapter,
  url: string = URL,
): Promise<{ readonly contractId: string | null; readonly confirmRejections: number }> {
  const intent = singleResourceUrlIntent(url);
  if (!intent.ok) {
    return { contractId: null, confirmRejections: -1 };
  }
  const entered = adapter.enterIntent({
    intent: intent.value,
    workflowFacts: SINGLE_RESOURCE_WORKFLOW_FACTS,
  });
  if (entered.refusals.length > 0) {
    return { contractId: null, confirmRejections: -1 };
  }
  const outcome = await adapter.confirmScope();
  return {
    contractId: outcome.routed[0]?.aggregateId ?? null,
    confirmRejections: outcome.rejections.length,
  };
}

function framesOfType(mock: MockCore, discriminant: string): WireEnvelope[] {
  return mock.frames.filter(
    (frame) => frame.commandType === discriminant || frame.queryType === discriminant,
  );
}

describe('S1 direct acquisition — happy path over the mock transport', () => {
  it('valid URL → submit/confirm → exact S1 execute command with accepted aggregate and canonical payload', async () => {
    const mock = startMockCore();
    installConfirmedTaskFlow(mock);
    const adapter = mockAdapter(mock);
    const { contractId, confirmRejections } = await confirmUrlTask(adapter);
    expect(confirmRejections).toBe(0);
    expect(contractId).not.toBeNull();

    const executed = await adapter.executeS1Direct();
    expect(executed.refusals).toStrictEqual([]);
    expect(executed.rejections).toStrictEqual([]);

    // The whole sequence is exactly: SUBMIT_CONTRACT, READ_PROJECTION,
    // EXECUTE_S1_DIRECT_ACQUISITION, READ_PROJECTION.
    expect(mock.frames.map((frame) => frame.commandType ?? frame.queryType)).toStrictEqual([
      'SUBMIT_CONTRACT',
      'READ_PROJECTION',
      'EXECUTE_S1_DIRECT_ACQUISITION',
      'READ_PROJECTION',
    ]);

    const execute = framesOfType(mock, 'EXECUTE_S1_DIRECT_ACQUISITION')[0]!;
    // The peer is the DESKTOP_UI surface — never rewritten to CLI.
    expect(execute.peer.surface).toBe('DESKTOP_UI');
    // The command binds the aggregate just accepted by the same interaction.
    expect(execute.aggregateId).toBe(contractId);
    expect(execute.expectedRevision).toBe(1);
    expect(execute.correlation).toStrictEqual({ contractId });

    // Closed payload: canonical snapshot/member/artifact identities + delivery.
    const payload = execute.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toStrictEqual([
      'artifactId',
      'delivery',
      'memberId',
      'snapshotId',
    ]);
    expect(payload['snapshotId']).toMatch(/^s1snap-/);
    expect(payload['memberId']).toMatch(/^s1member-/);
    expect(payload['artifactId']).toMatch(/^s1artifact-/);

    // Redirect host defaults to the URL's own host only (CLI parity, `.host`
    // includes the port); the optional digest/content-type/total-byte fields
    // are absent from the U05 form.
    const delivery = payload['delivery'] as Record<string, unknown>;
    expect(Object.keys(delivery).sort()).toStrictEqual(['declaredRedirectHosts', 'locatorUri']);
    expect(delivery['locatorUri']).toBe(URL);
    expect(delivery['declaredRedirectHosts']).toStrictEqual([URL_HOST]);
  });

  it('command acceptance is admission only; the projection refresh controls status and terminal truth', async () => {
    const mock = startMockCore();
    const flow = installConfirmedTaskFlow(mock);
    const adapter = mockAdapter(mock);
    const { contractId } = await confirmUrlTask(adapter);
    expect(contractId).not.toBeNull();

    const executed = await adapter.executeS1Direct();
    expect(executed.rejections).toStrictEqual([]);
    // Acceptance created no completion claim: the refreshed projection is an
    // ACTIVE lineage and no terminal section exists.
    expect(executed.display.sections.some((s) => s.title.startsWith('Result explanation'))).toBe(
      false,
    );
    expect(surfaceToText(executed.display)).toContain('lineage status: ACTIVE');

    // Core later projects the terminal result; only now does it render.
    flow.projectTerminal(contractId!);
    const refreshed = await adapter.refresh();
    const text = surfaceToText(refreshed.display);
    expect(text).toContain('request fulfillment: COMPLETE');
    expect(text).toContain('target resolution: RESOLVED');
    expect(text).toContain('stop reason: NONE');
  });
});

describe('S1 direct acquisition — fail-closed causes route no transfer command', () => {
  it('an invalid URL never produces a transfer command', async () => {
    // The manager add-flow entry rejects hostile locators outright:
    for (const bad of [
      'ftp://example.com/x',
      'file:///C:/x',
      'not a url',
      'https://example.com/a b',
      '',
    ]) {
      expect(decodeManagerUrl(bad).ok, bad).toBe(false);
    }

    // A locator whose raw shape passed the entry decode but is not http(s)
    // fails closed at the S1 payload gate: the contract confirmation may
    // proceed (it is a generic contract), the transfer command never routes.
    const mock = startMockCore();
    installConfirmedTaskFlow(mock);
    const adapter = mockAdapter(mock);
    const { contractId } = await confirmUrlTask(adapter, 'ftp://example.com/x');
    expect(contractId).not.toBeNull();
    const attempted = await adapter.executeS1Direct();
    expect(framesOfType(mock, 'EXECUTE_S1_DIRECT_ACQUISITION')).toHaveLength(0);
    expect(attempted.rejections.length + attempted.refusals.length).toBeGreaterThan(0);
  });

  it('a failed confirmation routes no transfer command', async () => {
    const mock = startMockCore();
    mock.handleCommand = (envelope) =>
      envelope.commandType === 'SUBMIT_CONTRACT'
        ? rejectedResponse('CONTRACT_GATE', 'contract', 'mock Core rejects this contract')
        : acceptedResponse(envelope, 1);
    mock.handleQuery = (envelope) => ({
      outcome: 'PROJECTION',
      projection: activeProjection(envelope.aggregateId, 1),
    });
    const adapter = mockAdapter(mock);
    const { confirmRejections } = await confirmUrlTask(adapter);
    expect(confirmRejections).toBeGreaterThan(0);

    const attempted = await adapter.executeS1Direct();
    expect(attempted.refusals[0]).toContain('no confirmed contract');
    expect(framesOfType(mock, 'EXECUTE_S1_DIRECT_ACQUISITION')).toHaveLength(0);
  });

  it('a Core peer rejection surfaces verbatim; the accepted submit never becomes transfer success', async () => {
    const mock = startMockCore();
    installConfirmedTaskFlow(mock);
    const adapter = mockAdapter(mock);
    const { contractId } = await confirmUrlTask(adapter);
    expect(contractId).not.toBeNull();

    // Pre-T01 Core gate: DESKTOP_UI S1 admission rejects at peer.surface.
    mock.handleCommand = (envelope) =>
      envelope.commandType === 'EXECUTE_S1_DIRECT_ACQUISITION'
        ? rejectedResponse(
            'ADMISSION_REJECTED',
            'peer.surface',
            'EXECUTE_S1_DIRECT_ACQUISITION is admissible only from the CLI surface',
          )
        : (() => {
            const revision = envelope.commandType === 'SUBMIT_CONTRACT' ? 1 : 2;
            return acceptedResponse(envelope, revision);
          })();

    const executed = await adapter.executeS1Direct();
    expect(executed.rejections).toStrictEqual([
      {
        code: 'ADMISSION_REJECTED',
        path: 'peer.surface',
        message: 'EXECUTE_S1_DIRECT_ACQUISITION is admissible only from the CLI surface',
      },
    ]);
    // The display re-synced from the projection: still ACTIVE, no success.
    const text = surfaceToText(executed.display);
    expect(text).toContain('ADMISSION_REJECTED');
    expect(text).toContain('lineage status: ACTIVE');
    expect(executed.display.sections.some((s) => s.title.startsWith('Result explanation'))).toBe(
      false,
    );

    // After the T01 Core gate opens, the SAME logical command identity
    // re-sends and converges — no new identities are minted.
    installConfirmedTaskFlow(mock);
    const retried = await adapter.executeS1Direct();
    expect(retried.rejections).toStrictEqual([]);
    const executeFrames = framesOfType(mock, 'EXECUTE_S1_DIRECT_ACQUISITION');
    expect(executeFrames).toHaveLength(2);
    expect(executeFrames[1]!.requestId).toBe(executeFrames[0]!.requestId);
    expect(executeFrames[1]!.payload).toStrictEqual(executeFrames[0]!.payload);
  });

  it('a confirmed collection task is refused by the S1 lane (no transfer command)', async () => {
    const mock = startMockCore();
    installConfirmedTaskFlow(mock);
    const adapter = mockAdapter(mock);
    const members = memberIds(2);
    const entered = adapter.enterIntent({
      intent: collectionIntent(),
      workflowFacts: {
        ambiguousMaterialMemberIds: members,
        candidateCount: members.length,
        autoEvidenceSufficient: false,
      },
    });
    expect(entered.refusals).toStrictEqual([]);

    // Answer whichever plan the canonical producer presents.
    const planText = JSON.stringify(entered.display);
    let outcome;
    if (planText.includes('BATCH_GROUP')) {
      outcome = await adapter.confirmBatchSelection();
    } else if (planText.includes('MATERIAL_ITEM')) {
      for (const member of members) {
        expect(adapter.answerMaterialItem(member, 'CONFIRMED').refusals).toStrictEqual([]);
      }
      outcome = await adapter.submitMaterialSelection();
    } else {
      outcome = await adapter.chooseManualSelection(members);
    }
    expect(outcome!.rejections).toStrictEqual([]);

    const attempted = await adapter.executeS1Direct();
    expect(attempted.refusals[0]).toContain('SINGLE_RESOURCE');
    expect(framesOfType(mock, 'EXECUTE_S1_DIRECT_ACQUISITION')).toHaveLength(0);
  });
});

describe('S1 direct acquisition — idempotent identity across retry/reconnect', () => {
  it('a disconnect keeps the pending command; the retry re-sends the identical envelope', async () => {
    const mock = startMockCore();
    installConfirmedTaskFlow(mock);
    const adapter = mockAdapter(mock);
    const { contractId } = await confirmUrlTask(adapter);
    expect(contractId).not.toBeNull();

    // Core goes silent for the S1 command: every attempt ends the connection
    // without a response.
    mock.silentCommands = new Set(['EXECUTE_S1_DIRECT_ACQUISITION']);
    const dropped = await adapter.executeS1Direct();
    expect(dropped.display.connection).toBe('DISCONNECTED');
    // Nothing was fabricated locally: no terminal, no success claim.
    expect(dropped.display.sections.some((s) => s.title.startsWith('Result explanation'))).toBe(
      false,
    );

    // Core comes back; the SAME logical command re-sends and is accepted.
    mock.silentCommands = new Set();
    const retried = await adapter.executeS1Direct();
    expect(retried.display.connection).toBe('CONNECTED');
    expect(retried.rejections).toStrictEqual([]);

    const executeFrames = framesOfType(mock, 'EXECUTE_S1_DIRECT_ACQUISITION');
    expect(executeFrames.length).toBeGreaterThanOrEqual(2);
    const first = executeFrames[0]!;
    for (const frame of executeFrames) {
      expect(frame.requestId).toBe(first.requestId);
      expect(frame.aggregateId).toBe(first.aggregateId);
      expect(frame.expectedRevision).toBe(first.expectedRevision);
      expect(frame.payload).toStrictEqual(first.payload);
    }
    const payload = first.payload as {
      readonly snapshotId: string;
      readonly memberId: string;
      readonly artifactId: string;
    };
    // The derived identities were minted once and preserved verbatim.
    expect(payload.snapshotId).toMatch(/^s1snap-/);
    expect(payload.memberId).toMatch(/^s1member-/);
    expect(payload.artifactId).toMatch(/^s1artifact-/);
  });

  it('a duplicate invocation converges on the same logical command identity', async () => {
    const mock = startMockCore();
    installConfirmedTaskFlow(mock);
    const adapter = mockAdapter(mock);
    const { contractId } = await confirmUrlTask(adapter);
    expect(contractId).not.toBeNull();

    const first = await adapter.executeS1Direct();
    expect(first.rejections).toStrictEqual([]);
    const second = await adapter.executeS1Direct();
    expect(second.rejections).toStrictEqual([]);

    const executeFrames = framesOfType(mock, 'EXECUTE_S1_DIRECT_ACQUISITION');
    expect(executeFrames).toHaveLength(2);
    // No fresh request identity, no divergent derived identities.
    expect(executeFrames[1]!.requestId).toBe(executeFrames[0]!.requestId);
    expect(executeFrames[1]!.payload).toStrictEqual(executeFrames[0]!.payload);
  });
});

describe('LIST_S1_JOB_PROJECTIONS — typed adapter query', () => {
  it('requests the reserved subject and returns the strictly validated page', async () => {
    const mock = startMockCore();
    mock.handleQuery = (envelope) => {
      if (envelope.queryType === 'LIST_S1_JOB_PROJECTIONS') {
        return {
          outcome: 'PROJECTION',
          projection: {
            items: [
              activeProjection('contract-s1-a', 2),
              activeProjection('contract-s1-b', 3),
              activeProjection('contract-s1-c', 1),
            ],
            totalCount: 3,
            truncated: false,
          },
        };
      }
      return rejectedResponse('UNEXPECTED_QUERY', 'queryType', 'mock did not expect this query');
    };
    const adapter = mockAdapter(mock);
    const result = await adapter.listS1JobProjections();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(3);
      expect(result.totalCount).toBe(3);
      expect(result.truncated).toBe(false);
      expect(result.items.map((item) => item.contract.contractId)).toStrictEqual([
        'contract-s1-a',
        'contract-s1-b',
        'contract-s1-c',
      ]);
    }
    const queryFrames = framesOfType(mock, 'LIST_S1_JOB_PROJECTIONS');
    expect(queryFrames).toHaveLength(1);
    expect(queryFrames[0]!.aggregateId).toBe(S1_JOB_INDEX_QUERY_SUBJECT);
    expect(queryFrames[0]!.peer.surface).toBe('DESKTOP_UI');
  });

  it('a typed rejection is an explicit failure, never an empty successful list', async () => {
    const mock = startMockCore();
    mock.handleQuery = () =>
      rejectedResponse('ADMISSION_REJECTED', 'peer.surface', 'mock Core rejects the index query');
    const adapter = mockAdapter(mock);
    const result = await adapter.listS1JobProjections();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe('REJECTED');
    }
    expect('items' in result).toBe(false);
    // The query was actually attempted (not silently swallowed).
    expect(framesOfType(mock, 'LIST_S1_JOB_PROJECTIONS')).toHaveLength(1);
  });

  it('a disconnect is an explicit failure, never an empty successful list', async () => {
    const mock = startMockCore();
    mock.silentQueries = true;
    const adapter = mockAdapter(mock);
    const result = await adapter.listS1JobProjections();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.reason).toBe('DISCONNECTED');
    }
    expect('items' in result).toBe(false);
  });

  it('strictly rejects malformed index payloads (shape, bounds, totals, identities)', async () => {
    const manyItems = Array.from({ length: 201 }, (_, index) =>
      activeProjection(`contract-x-${String(index)}`, 1),
    );
    const malformedCases: ReadonlyArray<{ readonly name: string; readonly payload: unknown }> = [
      {
        name: 'unknown extra field',
        payload: { items: [], totalCount: 0, truncated: false, extra: 1 },
      },
      { name: 'items not an array', payload: { items: {}, totalCount: 0, truncated: false } },
      {
        name: '201 items exceeds the bound',
        payload: { items: manyItems, totalCount: 201, truncated: true },
      },
      { name: 'negative totalCount', payload: { items: [], totalCount: -1, truncated: false } },
      { name: 'fractional totalCount', payload: { items: [], totalCount: 1.5, truncated: false } },
      { name: 'non-boolean truncated', payload: { items: [], totalCount: 0, truncated: 'no' } },
      {
        name: 'underfilled page (items fewer than min(totalCount, 200))',
        payload: {
          items: [activeProjection('contract-y-1', 1), activeProjection('contract-y-2', 1)],
          totalCount: 3,
          truncated: true,
        },
      },
      {
        name: 'underfilled page with truncated false',
        payload: {
          items: [activeProjection('contract-y-1', 1)],
          totalCount: 2,
          truncated: false,
        },
      },
      {
        name: 'totalCount smaller than items.length',
        payload: {
          items: [activeProjection('contract-y-1', 1), activeProjection('contract-y-2', 1)],
          totalCount: 1,
          truncated: false,
        },
      },
      {
        name: 'totalCount smaller than a full 200-page',
        payload: {
          items: manyItems.slice(0, 200),
          totalCount: 199,
          truncated: false,
        },
      },
      {
        name: 'truncated contradicts totalCount (false)',
        payload: {
          items: [activeProjection('contract-y-1', 1)],
          totalCount: 2,
          truncated: false,
        },
      },
      {
        name: 'truncated contradicts totalCount (true)',
        payload: {
          items: [activeProjection('contract-y-1', 1)],
          totalCount: 1,
          truncated: true,
        },
      },
      {
        name: 'duplicate aggregate identity',
        payload: {
          items: [activeProjection('contract-y-1', 1), activeProjection('contract-y-1', 2)],
          totalCount: 2,
          truncated: false,
        },
      },
      {
        name: 'item missing its contract identity',
        payload: { items: [{ lineage: {} }], totalCount: 1, truncated: false },
      },
      {
        name: 'item with an unknown status literal',
        payload: {
          items: [
            {
              ...activeProjection('contract-y-1', 1),
              contract: {
                contractId: 'contract-y-1',
                status: 'WEIRD',
                intentType: 'SINGLE_RESOURCE',
                revision: 1,
              },
            },
          ],
          totalCount: 1,
          truncated: false,
        },
      },
    ];
    for (const { name, payload } of malformedCases) {
      const mock = startMockCore();
      mock.handleQuery = () => ({ outcome: 'PROJECTION', projection: payload });
      const adapter = mockAdapter(mock);
      const result = await adapter.listS1JobProjections();
      expect(result.ok, name).toBe(false);
      if (!result.ok) {
        expect(result.failure.reason, name).toBe('MALFORMED_INDEX');
        if (result.failure.reason === 'MALFORMED_INDEX') {
          expect(result.failure.detail.length, name).toBeGreaterThan(0);
        }
      }
    }
  });

  it('an empty index is truthful: totalCount 0 with a successful empty page', async () => {
    const mock = startMockCore();
    mock.handleQuery = () => ({
      outcome: 'PROJECTION',
      projection: { items: [], totalCount: 0, truncated: false },
    });
    const adapter = mockAdapter(mock);
    const result = await adapter.listS1JobProjections();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toStrictEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.truncated).toBe(false);
    }
  });
});
