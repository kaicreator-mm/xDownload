/**
 * v0.2 T07 — CLI command adapter tests (node:test, colocated in the T07
 * write set).
 *
 * The facade below is a TEST-ONLY FAKE implementing the mirrored public
 * facade port (`DomainAppFacade`, a structural mirror of the frozen
 * `@kaicreator/domain-harness-microkernel` public `DomainApp` interface).
 * It is NOT the real kernel, holds no lifecycle truth and grants no
 * authority; it exists only to pin the command→facade-call mapping and the
 * faithful UNKNOWN/FAILED/CANCELLED projection at unit level. Real Node24
 * CLI process integration is a later central-join task (T13).
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import { CLI_ID_PATTERN, CliInputError } from './args.ts';
import {
  DOMAIN_APP_CANCEL_INTENT_TYPE,
  MAX_QUERY_SELECTORS,
  domainAppExitCode,
  executeDomainAppCommand,
  makeMessageId,
  mapCancelIntent,
  mapQueryManySelectors,
  mapStatusQuery,
  mapSubmitIntent,
  type DomainAppCommandInput,
  type DomainAppSubmitCommand,
} from './domain-app-commands.ts';
import {
  extractCodedFailure,
  isDomainAppFacadeLike,
  type DomainAppFacade,
  type V10PublicIntent,
  type V10ScopedSnapshotAnswer,
  type V10ScopedSnapshotManyAnswer,
  type V10ScopedSnapshotQuery,
} from './domain-app-facade.ts';
import { ACCEPTANCE_NOTE, EXIT } from './render.ts';

interface FakeBehavior {
  onSend?: (intent: V10PublicIntent) => Record<string, unknown>;
  onQuerySingle?: (selector: V10ScopedSnapshotQuery) => V10ScopedSnapshotAnswer;
  onQueryMany?: (
    selectors: readonly V10ScopedSnapshotQuery[],
  ) => readonly V10ScopedSnapshotManyAnswer[];
  sendThrows?: unknown;
  queryThrows?: unknown;
}

/** TEST-ONLY fake facade over the public port; records every facade call. */
function fakeFacade(behavior: FakeBehavior): DomainAppFacade & {
  sentIntents: V10PublicIntent[];
  queriedSelectors: (V10ScopedSnapshotQuery | readonly V10ScopedSnapshotQuery[])[];
} {
  const sentIntents: V10PublicIntent[] = [];
  const queriedSelectors: (V10ScopedSnapshotQuery | readonly V10ScopedSnapshotQuery[])[] = [];
  return {
    sentIntents,
    queriedSelectors,
    send: async (intent) => {
      sentIntents.push(intent);
      if (behavior.sendThrows !== undefined) {
        throw behavior.sendThrows;
      }
      return behavior.onSend === undefined ? { kind: 'ACCEPTED' } : behavior.onSend(intent);
    },
    query: (async (input: unknown) => {
      queriedSelectors.push(input as V10ScopedSnapshotQuery | readonly V10ScopedSnapshotQuery[]);
      if (behavior.queryThrows !== undefined) {
        throw behavior.queryThrows;
      }
      if (Array.isArray(input)) {
        assert.ok(behavior.onQueryMany, 'fake queried multi without onQueryMany');
        return behavior.onQueryMany(input as readonly V10ScopedSnapshotQuery[]);
      }
      assert.ok(behavior.onQuerySingle, 'fake queried single without onQuerySingle');
      return behavior.onQuerySingle(input as V10ScopedSnapshotQuery);
    }) as DomainAppFacade['query'],
    subscribe: async () => ({ unsubscribe() {} }),
    stop: () => {},
  };
}

/** Public typed error stand-in (the SDK public error identity shape). */
class FakeV10Error extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'V10Error';
    this.code = code;
  }
}

function submitCommand(): DomainAppSubmitCommand {
  return {
    kind: 'submit',
    operation: 'acquisition.acquire',
    instanceKey: 'inst-001',
    input: { targetRef: 'ref:target-001' },
  };
}

describe('command mapping to public facade params', () => {
  it('maps submit onto the exact four-key public intent shape', () => {
    const intent = mapSubmitIntent({
      kind: 'submit',
      operation: 'media.acquire',
      instanceKey: 'inst-9',
      messageId: 'msg-explicit',
      input: { k: 'v' },
    });
    assert.deepEqual(Object.keys(intent).sort(), [
      'input',
      'instanceKey',
      'intentType',
      'messageId',
    ]);
    assert.equal(intent.intentType, 'media.acquire');
    assert.equal(intent.instanceKey, 'inst-9');
    assert.equal(intent.messageId, 'msg-explicit');
    assert.deepEqual(intent.input, { k: 'v' });
  });

  it('generates a bounded messageId when omitted (idempotent identity is explicit or generated, never absent)', () => {
    const intent = mapSubmitIntent(submitCommand());
    assert.match(intent.messageId, /^msg-[0-9a-f-]{36}$/u);
    assert.ok(CLI_ID_PATTERN.test(intent.messageId));
    assert.notEqual(intent.messageId, mapSubmitIntent(submitCommand()).messageId);
    assert.notEqual(intent.messageId, makeMessageId());
  });

  it('refuses submit operations outside the canonical T01 vocabulary', () => {
    assert.throws(
      () =>
        mapSubmitIntent({
          kind: 'submit',
          operation: 'acquisition.exfiltrate' as 'acquisition.acquire',
          instanceKey: 'i',
          input: {},
        }),
      CliInputError,
    );
  });

  it('refuses malformed identifiers and non-object submit input before any facade call', () => {
    assert.throws(
      () =>
        mapSubmitIntent({
          kind: 'submit',
          operation: 'acquisition.acquire',
          instanceKey: '../escape',
          input: {},
        }),
      CliInputError,
    );
    assert.throws(
      () =>
        mapSubmitIntent({
          kind: 'submit',
          operation: 'acquisition.acquire',
          instanceKey: 'i',
          input: [1, 2] as unknown as Record<string, unknown>,
        }),
      CliInputError,
    );
    assert.throws(
      () =>
        mapSubmitIntent({
          kind: 'submit',
          operation: 'acquisition.acquire',
          instanceKey: 'i',
          input: null as unknown as Record<string, unknown>,
        }),
      CliInputError,
    );
  });

  it('maps cancel onto the bounded cancel intent type; reason is the only added input field', () => {
    const plain = mapCancelIntent({ kind: 'cancel', instanceKey: 'inst-1' });
    assert.equal(plain.intentType, DOMAIN_APP_CANCEL_INTENT_TYPE);
    assert.deepEqual(plain.input, {});
    const reasoned = mapCancelIntent({
      kind: 'cancel',
      instanceKey: 'inst-1',
      reason: 'user asked',
    });
    assert.deepEqual(reasoned.input, { reason: 'user asked' });
    assert.throws(
      () => mapCancelIntent({ kind: 'cancel', instanceKey: 'inst-1', reason: '' }),
      CliInputError,
    );
  });

  it('maps status onto the exact public selector; businessPackageId appears only when provided', () => {
    const plain = mapStatusQuery({
      kind: 'status',
      workflowId: 'wf-download',
      instanceKey: 'inst-1',
    });
    assert.deepEqual(Object.keys(plain).sort(), ['instanceKey', 'workflowId']);
    const scoped = mapStatusQuery({
      kind: 'status',
      workflowId: 'wf-download',
      instanceKey: 'inst-1',
      businessPackageId: 'bp-download',
    });
    assert.deepEqual(scoped, {
      workflowId: 'wf-download',
      instanceKey: 'inst-1',
      businessPackageId: 'bp-download',
    });
    assert.throws(
      () => mapStatusQuery({ kind: 'status', workflowId: '', instanceKey: 'inst-1' }),
      CliInputError,
    );
  });

  it('bounds query-many to 1..16 selectors', () => {
    assert.equal(
      mapQueryManySelectors({
        kind: 'query-many',
        selectors: [{ kind: 'status', workflowId: 'wf', instanceKey: 'i1' }],
      }).length,
      1,
    );
    const many = Array.from({ length: MAX_QUERY_SELECTORS }, (_, index) => ({
      kind: 'status' as const,
      workflowId: 'wf',
      instanceKey: `i${String(index)}`,
    }));
    assert.equal(
      mapQueryManySelectors({ kind: 'query-many', selectors: many }).length,
      MAX_QUERY_SELECTORS,
    );
    assert.throws(
      () => mapQueryManySelectors({ kind: 'query-many', selectors: [] }),
      CliInputError,
    );
    assert.throws(
      () =>
        mapQueryManySelectors({
          kind: 'query-many',
          selectors: Array.from({ length: MAX_QUERY_SELECTORS + 1 }, (_, index) => ({
            kind: 'status' as const,
            workflowId: 'wf',
            instanceKey: `i${String(index)}`,
          })),
        }),
      CliInputError,
    );
  });
});

describe('faithful execution against the public facade port', () => {
  it('sends exactly the mapped intent and projects an ACCEPTED receipt as non-terminal RUNNING (acceptance is not success)', async () => {
    const facade = fakeFacade({ onSend: () => ({ kind: 'ACCEPTED', messageId: 'msg-1' }) });
    const outcome = await executeDomainAppCommand(facade, submitCommand());
    assert.equal(facade.sentIntents.length, 1);
    assert.equal(outcome.kind, 'sent');
    if (outcome.kind !== 'sent') return;
    assert.equal(outcome.document.document, 'xdownload.cli.domain-app.sent');
    assert.equal(outcome.document.intent_type, 'acquisition.acquire');
    assert.equal(outcome.document.status, 'RUNNING');
    assert.equal(outcome.document.terminal, false);
    assert.equal(outcome.document.note, ACCEPTANCE_NOTE);
    assert.equal(domainAppExitCode(outcome), EXIT.SUCCESS);
    // The sent messageId is the one projected (mapped exactly once).
    assert.equal(outcome.document.message_id, facade.sentIntents[0]?.messageId);
  });

  it('never projects an unreadable receipt as success: UNKNOWN stays UNKNOWN', async () => {
    const outcome = await executeDomainAppCommand(
      fakeFacade({ onSend: () => ({ anything: true }) }),
      submitCommand(),
    );
    assert.ok(outcome.kind === 'sent');
    assert.equal(outcome.document.status, 'UNKNOWN');
    assert.equal(outcome.document.terminal, false);
    assert.equal(outcome.document.unknown_reason, 'status_field_missing');
    assert.equal(domainAppExitCode(outcome), EXIT.SUCCESS); // the read succeeded; the document carries the UNKNOWN truth
  });

  it('projects a FAILED receipt faithfully with its typed error and a terminal non-success exit', async () => {
    const outcome = await executeDomainAppCommand(
      fakeFacade({
        onSend: () => ({
          kind: 'FAILED',
          error: { code: 'HOST_FAULT_INJECTED', message: 'disk full' },
        }),
      }),
      submitCommand(),
    );
    assert.ok(outcome.kind === 'sent');
    assert.equal(outcome.document.status, 'FAILED');
    assert.deepEqual(outcome.document.error, { code: 'HOST_FAULT_INJECTED', message: 'disk full' });
    assert.equal(outcome.document.terminal, true);
    assert.equal(domainAppExitCode(outcome), EXIT.TERMINAL_NON_SUCCESS);
  });

  it('projects a CANCELLED receipt as terminal non-success', async () => {
    const outcome = await executeDomainAppCommand(
      fakeFacade({ onSend: () => ({ kind: 'CANCELLED' }) }),
      { kind: 'cancel', instanceKey: 'inst-1' },
    );
    assert.ok(outcome.kind === 'sent');
    assert.equal(outcome.document.status, 'CANCELLED');
    assert.equal(outcome.document.terminal, true);
    assert.equal(domainAppExitCode(outcome), EXIT.TERMINAL_NON_SUCCESS);
  });

  it('projects typed public facade errors verbatim (never swallowed) and exits REJECTED', async () => {
    const outcome = await executeDomainAppCommand(
      fakeFacade({ sendThrows: new FakeV10Error('INTENT_UNSEALED', 'intent was not sealed') }),
      submitCommand(),
    );
    assert.equal(outcome.kind, 'error');
    if (outcome.kind !== 'error') return;
    assert.equal(outcome.document.document, 'xdownload.cli.domain-app.error');
    assert.equal(outcome.document.code, 'INTENT_UNSEALED');
    assert.equal(outcome.document.message, 'intent was not sealed');
    assert.equal(outcome.document.coded, true);
    assert.equal(domainAppExitCode(outcome), EXIT.REJECTED);
  });

  it('reports untyped throws as coded:false UNEXPECTED_ERROR and exits TRANSPORT', async () => {
    const outcome = await executeDomainAppCommand(
      fakeFacade({ sendThrows: 'boom' }),
      submitCommand(),
    );
    assert.ok(outcome.kind === 'error');
    assert.equal(outcome.document.code, 'UNEXPECTED_ERROR');
    assert.equal(outcome.document.message, 'boom');
    assert.equal(outcome.document.coded, false);
    assert.equal(domainAppExitCode(outcome), EXIT.TRANSPORT);
  });

  it('queries with the exact selector and projects the snapshot status faithfully', async () => {
    const command: DomainAppCommandInput = {
      kind: 'status',
      workflowId: 'wf-download',
      instanceKey: 'inst-1',
      businessPackageId: 'bp-download',
    };
    const ok = await executeDomainAppCommand(
      fakeFacade({
        onQuerySingle: () => ({ target: {} as never, snapshot: { status: 'SUCCEEDED' } }),
      }),
      command,
    );
    assert.ok(ok.kind === 'status');
    assert.equal(ok.document.document, 'xdownload.cli.domain-app.status');
    assert.deepEqual(ok.document.business_package_id, 'bp-download');
    assert.equal(ok.document.status, 'SUCCEEDED');
    assert.equal(ok.document.terminal, true);
    assert.equal(domainAppExitCode(ok), EXIT.SUCCESS);
    const failed = await executeDomainAppCommand(
      fakeFacade({
        onQuerySingle: () => ({
          target: {} as never,
          snapshot: { status: 'FAILED', error: { code: 'X', message: 'y' } },
        }),
      }),
      command,
    );
    assert.equal(domainAppExitCode(failed), EXIT.TERMINAL_NON_SUCCESS);
    const unknown = await executeDomainAppCommand(
      fakeFacade({ onQuerySingle: () => ({ target: {} as never, snapshot: 'garbage' }) }),
      command,
    );
    assert.ok(unknown.kind === 'status');
    assert.equal(unknown.document.status, 'UNKNOWN');
    assert.equal(unknown.document.unknown_reason, 'source_not_a_plain_object');
    assert.equal(unknown.document.terminal, false);
  });

  it('projects multi-query answers per index; a refusal stays scoped and forces REJECTED', async () => {
    const command: DomainAppCommandInput = {
      kind: 'query-many',
      selectors: [
        { kind: 'status', workflowId: 'wf', instanceKey: 'inst-a' },
        { kind: 'status', workflowId: 'wf', instanceKey: 'inst-b' },
      ],
    };
    const facade = fakeFacade({
      onQueryMany: () => [
        { status: 'answered', index: 0, target: {} as never, snapshot: { status: 'RUNNING' } },
        { status: 'refused', index: 1, code: 'QUERY_NOT_FOUND', message: 'no such instance' },
      ],
    });
    const outcome = await executeDomainAppCommand(facade, command);
    assert.ok(outcome.kind === 'query-many');
    assert.equal(outcome.document.answers.length, 2);
    const [first, second] = outcome.document.answers;
    assert.ok(first?.answered);
    assert.equal(first.instance_key, 'inst-a');
    assert.equal(first.status, 'RUNNING');
    assert.equal(second?.answered, false);
    assert.equal(second?.code, 'QUERY_NOT_FOUND');
    assert.equal(domainAppExitCode(outcome), EXIT.REJECTED);
  });

  it('multi-query: all answered terminal non-success exits TERMINAL_NON_SUCCESS, else SUCCESS', async () => {
    const command: DomainAppCommandInput = {
      kind: 'query-many',
      selectors: [
        { kind: 'status', workflowId: 'wf', instanceKey: 'inst-a' },
        { kind: 'status', workflowId: 'wf', instanceKey: 'inst-b' },
      ],
    };
    const failed = await executeDomainAppCommand(
      fakeFacade({
        onQueryMany: () => [
          { status: 'answered', index: 0, target: {} as never, snapshot: { status: 'SUCCEEDED' } },
          { status: 'answered', index: 1, target: {} as never, snapshot: { status: 'CANCELLED' } },
        ],
      }),
      command,
    );
    assert.equal(domainAppExitCode(failed), EXIT.TERMINAL_NON_SUCCESS);
    const fine = await executeDomainAppCommand(
      fakeFacade({
        onQueryMany: () => [
          { status: 'answered', index: 0, target: {} as never, snapshot: { status: 'SUCCEEDED' } },
          { status: 'answered', index: 1, target: {} as never, snapshot: { status: 'UNKNOWN' } },
        ],
      }),
      command,
    );
    assert.ok(fine.kind === 'query-many');
    const secondAnswer = fine.document.answers[1];
    assert.ok(secondAnswer?.answered);
    assert.equal(secondAnswer.status, 'UNKNOWN');
    assert.equal(domainAppExitCode(fine), EXIT.SUCCESS);
  });

  it('projects an uncorrelated multi-query answer index as a scoped refusal, never a guess', async () => {
    const outcome = await executeDomainAppCommand(
      fakeFacade({
        onQueryMany: () => [
          { status: 'answered', index: 7, target: {} as never, snapshot: { status: 'SUCCEEDED' } },
        ],
      }),
      {
        kind: 'query-many',
        selectors: [{ kind: 'status', workflowId: 'wf', instanceKey: 'inst-a' }],
      },
    );
    assert.ok(outcome.kind === 'query-many');
    assert.deepEqual(outcome.document.answers[0], {
      index: 7,
      answered: false,
      code: 'ANSWER_INDEX_UNCORRELATED',
      message: 'multi-query answer index does not correlate to any requested selector',
    });
  });

  it('fails closed on a facade that does not implement the public port', async () => {
    const outcome = await executeDomainAppCommand(
      {} as unknown as DomainAppFacade,
      submitCommand(),
    );
    assert.ok(outcome.kind === 'error');
    assert.equal(outcome.document.code, 'FACADE_PORT_MISMATCH');
    assert.equal(outcome.document.coded, false);
    assert.equal(domainAppExitCode(outcome), EXIT.TRANSPORT);
    assert.equal(
      isDomainAppFacadeLike({ send: 1, query: () => {}, subscribe: () => {}, stop: () => {} }),
      false,
    );
    assert.equal(isDomainAppFacadeLike(fakeFacade({})), true);
  });
});

describe('public error identity extraction', () => {
  it('extracts the {name, code, message} coded-failure shape from Error throws only', () => {
    assert.deepEqual(extractCodedFailure(new FakeV10Error('QUERY_NOT_FOUND', 'gone')), {
      name: 'V10Error',
      code: 'QUERY_NOT_FOUND',
      message: 'gone',
    });
    assert.equal(extractCodedFailure(new Error('no code')), null);
    assert.equal(extractCodedFailure('string throw'), null);
    assert.equal(extractCodedFailure(null), null);
  });
});

describe('export surface leaks no kernel internals (T07 acceptance)', () => {
  const SOURCE_FILES = [
    'domain-app-facade.ts',
    'domain-app-commands.ts',
    'domain-app-status.ts',
  ] as const;

  const RUNTIME_EXPORT_ALLOWLIST: Readonly<
    Record<(typeof SOURCE_FILES)[number], readonly string[]>
  > = {
    'domain-app-facade.ts': [
      'DOMAIN_APP_FACADE_KEYS',
      'extractCodedFailure',
      'isDomainAppFacadeLike',
    ],
    'domain-app-status.ts': [
      'DOMAIN_APP_STATUS_VOCABULARY',
      'projectReceiptStatus',
      'projectSnapshotStatus',
    ],
    'domain-app-commands.ts': [
      'DOMAIN_APP_CANCEL_INTENT_TYPE',
      'DOMAIN_APP_FACADE_KEYS',
      'MAX_QUERY_SELECTORS',
      'domainAppExitCode',
      'executeDomainAppCommand',
      'makeMessageId',
      'mapCancelIntent',
      'mapQueryManySelectors',
      'mapStatusQuery',
      'mapSubmitIntent',
    ],
  };

  /** K internals that must never appear anywhere in the adapter surface. */
  const FORBIDDEN_TOKENS = [
    'K01',
    'K02',
    'docKey',
    'doc-key',
    'doc key',
    'counters',
    'SelectedKernel',
    'ShadowBinding',
    'host-seam',
    'activateV10App',
    'V10BuiltApp',
    'V10DocStore',
    'V10QueryAuthority',
    'deploymentIdentity',
  ] as const;

  it('runtime export keys are exactly the documented allowlist', async () => {
    const modules = {
      'domain-app-facade.ts': await import('./domain-app-facade.ts'),
      'domain-app-status.ts': await import('./domain-app-status.ts'),
      'domain-app-commands.ts': await import('./domain-app-commands.ts'),
    } as const;
    for (const file of SOURCE_FILES) {
      assert.deepEqual(
        Object.keys(modules[file]).sort(),
        [...RUNTIME_EXPORT_ALLOWLIST[file]].sort(),
        `${file} runtime export surface drifted`,
      );
    }
  });

  it('every declared exported type name is a public DomainApp/V10-public shape (no kernel types)', async () => {
    for (const file of SOURCE_FILES) {
      const text = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
      const names = [...text.matchAll(/export (?:interface|type) ([A-Za-z0-9_]+)/gu)].map(
        (match) => match[1],
      );
      assert.ok(names.length > 0, `${file} should declare exported types`);
      for (const name of names) {
        assert.match(
          name as string,
          /^(?:DomainApp[A-Za-z0-9_]*|V10(?:PublicIntent|ScopedSnapshotQuery|ScopedSnapshotAnswer|ScopedSnapshotManyAnswer|ScopedSubscriptionEvent|Subscription))$/u,
          `${file} exports non-public type ${String(name)}`,
        );
      }
    }
  });

  it('no adapter source references kernel-internal tokens', async () => {
    for (const file of SOURCE_FILES) {
      const text = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
      for (const token of FORBIDDEN_TOKENS) {
        assert.ok(!text.includes(token), `${file} must not reference K-internal token '${token}'`);
      }
    }
  });
});
