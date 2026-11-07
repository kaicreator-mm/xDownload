import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { decodeS5PageGroupGesture } from '../src/background/s5-group-intent.ts';

const popupSource = readFileSync(new URL('../src/popup/popup.js', import.meta.url), 'utf8');
const popupHtml = readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8');

type StubNode = {
  id: string;
  dataset: Record<string, string>;
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  checked: boolean;
  className: string;
  value: string;
  type: string;
  placeholder: string;
  required: boolean;
  appendChild(child: StubNode): void;
  addEventListener(
    type: string,
    handler: (event?: { key?: string; preventDefault?: () => void }) => Promise<void> | void,
  ): void;
  children: StubNode[];
  handlers: Record<
    string,
    (event?: { key?: string; preventDefault?: () => void }) => Promise<void> | void
  >;
  attributes: Record<string, string>;
  tabIndex: number;
  focused: boolean;
  focus(): void;
  querySelectorAll(selector: string): StubNode[];
  setAttribute(name: string, value: string): void;
};

type StructuredFieldDescriptor = {
  id: string;
  mount: string;
  kind: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
};

type StructuredFormDescriptor = {
  schemaVersion: number;
  operations: Record<string, { fields: StructuredFieldDescriptor[] }>;
};

type PopupInternals = {
  descriptor: StructuredFormDescriptor;
  validateDescriptor(descriptor: unknown): boolean;
  renderForm(operationId: string, descriptor?: StructuredFormDescriptor): boolean;
};

function makeNode(): StubNode {
  return {
    id: '',
    dataset: {},
    textContent: '',
    hidden: false,
    disabled: false,
    checked: false,
    className: '',
    value: '',
    type: '',
    placeholder: '',
    required: false,
    children: [],
    handlers: {},
    attributes: {},
    tabIndex: 0,
    focused: false,
    focus() {
      this.focused = true;
    },
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    querySelectorAll() {
      return [];
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
}

const LINKS = [
  { href: 'https://publisher.example.org/a.mp4', text: 'A' },
  { href: 'https://cdn.example.net/b.mp4', text: 'B' },
];

const FROZEN_MEMBERS = [
  { memberId: 's5m-0000000000000001', href: LINKS[0]!.href, text: 'A' },
  { memberId: 's5m-0000000000000002', href: LINKS[1]!.href, text: 'B' },
];

function startPopup(
  options: {
    total?: number;
    changed?: boolean;
    staleMembers?: boolean;
    respond?: (payload: { kind: string; [key: string]: unknown }) => unknown;
    scanError?: string;
    manualTimers?: boolean;
    s6Scan?: {
      links: { href: string; text: string }[];
      observedCount: number;
      nextPageHref?: string;
      pageUrl?: string;
    };
  } = {},
) {
  const ids = [
    'attachments',
    'state',
    's5-group',
    's5-preview',
    's5-prepare',
    's5-preview-result',
    's5-batch',
    's5-frozen',
    's5-confirm',
    's5-execute',
    's5-batch-result',
    's6-collection',
    's6-identity-field',
    's6-kind-field',
    's6-from-field',
    's6-to-field',
    's6-identity',
    's6-kind',
    's6-from',
    's6-to',
    's6-prepare',
    's6-prepare-result',
    's6-walk',
    's6-members',
    's6-next-page',
    's6-confirm',
    's6-execute',
    's6-batch-result',
    'v02-target-ref-field',
    'v02-output-root-field',
    'v02-target-ref',
    'v02-output-root',
    'v02-submit',
    'v02-result',
    'scan-error-details',
    'scan-error-raw',
  ];
  const nodes = Object.fromEntries(ids.map((id) => [id, makeNode()])) as Record<string, StubNode>;
  const modeTabs = ['page', 'batch', 'collection', 'advanced'].map((mode) => {
    const node = makeNode();
    node.dataset.mode = mode;
    return node;
  });
  const modePanels = ['page', 'batch', 'collection', 'advanced'].map((mode) => {
    const node = makeNode();
    node.dataset.modePanel = mode;
    return node;
  });
  const links = LINKS;
  const tab = { id: 42, url: 'https://publisher.example.org/list.html' };
  const sent: { kind: string; [key: string]: unknown }[] = [];
  const sideEffects = { permissionRequests: 0 };
  let scans = 0;
  const respond =
    options.respond ?? (() => ({ ok: false, error: 'S5_CORE_CARRIER_NOT_INSTALLED' }));
  const intervalCallbacks = new Map<number, () => Promise<void> | void>();
  let nextIntervalId = 1;
  const setManualInterval = (callback: () => Promise<void> | void) => {
    const id = nextIntervalId++;
    intervalCallbacks.set(id, callback);
    return id;
  };
  const clearManualInterval = (id: number) => {
    intervalCallbacks.delete(id);
  };
  const instrumentedPopupSource = popupSource.replace(
    '  void s6RestoreActiveJourney();',
    `  globalThis.__popupTestInternals = {
    descriptor: STRUCTURED_FORM_DESCRIPTOR,
    validateDescriptor: validateStructuredFormDescriptor,
    renderForm: renderStructuredForm,
  };
  void s6RestoreActiveJourney();`,
  );
  const context: { __popupTestInternals?: PopupInternals; [key: string]: unknown } = {
    URL,
    setInterval: options.manualTimers ? setManualInterval : setInterval,
    clearInterval: options.manualTimers ? clearManualInterval : clearInterval,
    document: {
      getElementById: (id: string) => nodes[id],
      querySelectorAll: (selector: string) =>
        selector === '.mode-tab' ? modeTabs : selector === '[data-mode-panel]' ? modePanels : [],
      createElement: () => {
        const node = makeNode();
        let id = '';
        Object.defineProperty(node, 'id', {
          configurable: true,
          get: () => id,
          set: (value: string) => {
            id = value;
            nodes[value] = node;
          },
        });
        return node;
      },
      createTextNode: (text: string) => ({ textContent: text }),
    },
    chrome: {
      tabs: {
        query: async () => [
          options.changed && scans > 0
            ? { ...tab, url: 'https://publisher.example.org/next' }
            : tab,
        ],
      },
      scripting: {
        executeScript: async () => {
          scans += 1;
          if (options.scanError && scans === 1) throw new Error(options.scanError);
          if (options.s6Scan && scans > 1) {
            return [
              {
                result: {
                  links: options.s6Scan.links,
                  observedCount: options.s6Scan.observedCount,
                  nextPageHref: options.s6Scan.nextPageHref ?? null,
                  pageUrl: options.s6Scan.pageUrl ?? tab.url,
                },
              },
            ];
          }
          return [
            {
              result: {
                links:
                  options.staleMembers && scans > 1
                    ? [{ ...links[0], href: 'https://publisher.example.org/changed.mp4' }, links[1]]
                    : links,
                observedCount: options.total ?? links.length,
              },
            },
          ];
        },
      },
      runtime: {
        sendMessage: async (payload: { kind: string; [key: string]: unknown }) => {
          sent.push(structuredClone(payload) as { kind: string });
          return respond(payload);
        },
      },
      permissions: {
        request: async () => {
          sideEffects.permissionRequests += 1;
          return false;
        },
      },
    },
  };
  runInNewContext(instrumentedPopupSource, context);
  const timers = {
    tick: async () => {
      for (const callback of [...intervalCallbacks.values()]) await callback();
    },
    size: () => intervalCallbacks.size,
  };
  return {
    nodes,
    sent,
    links,
    modeTabs,
    modePanels,
    sideEffects,
    timers,
    internals: context.__popupTestInternals!,
  };
}

async function ready(nodes: Record<string, StubNode>) {
  await vi.waitFor(() => expect(nodes['attachments']!.children.length).toBe(2));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

/** R1 P2-02: the popup's S6 restore query on open is not an S5 gesture. */
function s5Gestures(sent: readonly { kind: string }[]): readonly { kind: string }[] {
  return sent.filter((message) => message.kind !== 'S6_ACTIVE_COLLECTION_QUERY');
}

describe('#329 schema-driven popup forms and initial scan diagnostics', () => {
  it('renders only the frozen S6/v0.2 fields and preserves panel visibility and local validation', async () => {
    const { nodes, sent, modeTabs, modePanels, sideEffects, internals } = startPopup();
    await ready(nodes);
    expect(Object.isFrozen(internals.descriptor)).toBe(true);
    expect(internals.validateDescriptor(internals.descriptor)).toBe(true);
    expect(nodes['s6-identity']!.placeholder).toBe('playlist/my-list');
    expect(nodes['s6-kind']!.children.map((option) => option.value)).toEqual([
      'playlist',
      'gallery',
    ]);
    expect(nodes['s6-from']!.attributes['inputmode']).toBe('numeric');
    expect(nodes['s6-from']!.value).toBe('1');
    expect(nodes['s6-to']!.value).toBe('1');
    expect(nodes['v02-target-ref']!.placeholder).toBe('ref:your-host-target');
    expect(nodes['v02-output-root']!.placeholder).toBe('C:\\Users\\me\\Downloads');
    expect(modePanels[2]!.hidden).toBe(true);
    expect(modePanels[3]!.hidden).toBe(true);

    const beforeMessages = sent.length;
    const beforePermissions = sideEffects.permissionRequests;
    modeTabs[2]!.handlers['click']!();
    expect(modePanels[2]!.hidden).toBe(false);
    expect(modePanels[3]!.hidden).toBe(true);
    expect(sent).toHaveLength(beforeMessages);
    expect(sideEffects.permissionRequests).toBe(beforePermissions);

    await nodes['v02-submit']!.handlers['click']!();
    expect(sent.some((message) => message.kind === 'V02_ADD_DOWNLOAD')).toBe(false);
    expect(nodes['v02-result']!.textContent).toContain('请先填写 Host 签发的目标句柄');
  });

  it('fails closed for unknown schema versions, operation IDs and field kinds', () => {
    const { internals } = startPopup();
    const unknownVersion = structuredClone(internals.descriptor);
    unknownVersion.schemaVersion = 2;
    expect(internals.validateDescriptor(unknownVersion)).toBe(false);
    expect(internals.renderForm('S6_PREPARE_COLLECTION', unknownVersion)).toBe(false);

    const unknownOperation = structuredClone(internals.descriptor);
    unknownOperation.operations['UNKNOWN_OPERATION'] = { fields: [] };
    expect(internals.validateDescriptor(unknownOperation)).toBe(false);
    expect(internals.renderForm('UNKNOWN_OPERATION')).toBe(false);

    const unknownKind = structuredClone(internals.descriptor);
    unknownKind.operations['S6_PREPARE_COLLECTION']!.fields[0]!.kind = 'date';
    expect(internals.validateDescriptor(unknownKind)).toBe(false);
    expect(internals.renderForm('S6_PREPARE_COLLECTION', unknownKind)).toBe(false);
  });

  it('localizes only the known page-access denial and preserves the exact raw diagnostic without a permission request', async () => {
    const diagnostic =
      'Cannot access contents of url "chrome://extensions/". Extension manifest must request permission to access this host.';
    const rawDiagnostic = `Error: ${diagnostic}`;
    const { nodes, sideEffects } = startPopup({ scanError: diagnostic });
    await vi.waitFor(() => {
      expect(nodes['state']!.textContent).toContain('当前页面不允许扩展读取内容');
    });
    expect(nodes['state']!.textContent).not.toContain('Cannot access contents');
    expect(nodes['state']!.textContent).toContain('未自动申请权限');
    expect(nodes['scan-error-details']!.hidden).toBe(false);
    expect(nodes['scan-error-raw']!.textContent).toBe(rawDiagnostic);
    expect(sideEffects.permissionRequests).toBe(0);
  });

  it('keeps an unknown initial scan error distinguishable with its original detail', async () => {
    const { nodes, sideEffects } = startPopup({ scanError: 'unexpected scan backend failure' });
    await vi.waitFor(() => {
      expect(nodes['state']!.textContent).toContain('unexpected scan backend failure');
    });
    expect(nodes['state']!.textContent).not.toContain('当前页面不允许扩展读取内容');
    expect(nodes['scan-error-raw']!.textContent).toBe('Error: unexpected scan backend failure');
    expect(sideEffects.permissionRequests).toBe(0);
  });
});

describe('#329 monotonic S6 and v0.2 polling', () => {
  it('coalesces S6 timer ticks and ignores an old-generation refusal after a newer terminal', async () => {
    const statusResponses: {
      promise: Promise<unknown>;
      resolve: (value: unknown) => void;
    }[] = [];
    const { nodes, sent, timers } = startPopup({
      manualTimers: true,
      respond: (payload) => {
        if (payload.kind === 'S6_ACTIVE_COLLECTION_QUERY') return { ok: true, journey: null };
        if (payload.kind === 'S6_PREPARE_COLLECTION') {
          return {
            ok: true,
            contractId: 'contract-s6-race',
            facts: {
              prepareId: 'prepare-s6-race',
              snapshotId: 'snapshot-s6-race',
              observedTupleDigest: 'a'.repeat(64),
            },
          };
        }
        if (payload.kind === 'S6_PAGE_RECORD') {
          return { ok: true, facts: { memberIds: ['s6-member-race'] } };
        }
        if (payload.kind === 'S6_CONFIRM_COLLECTION') {
          return {
            ok: true,
            facts: { confirmedGroupId: 'confirmed-s6-race', selectedMemberIds: ['s6-member-race'] },
          };
        }
        if (payload.kind === 'S6_EXECUTE_COLLECTION') return { ok: true, status: 'RUNNING' };
        if (payload.kind === 'S6_COLLECTION_JOURNEY_STATUS') {
          const response = deferred<unknown>();
          statusResponses.push(response);
          return response.promise;
        }
        return { ok: false, error: 'unexpected message' };
      },
    });
    await ready(nodes);
    nodes['s6-identity']!.value = 'playlist/race';
    nodes['s6-kind']!.value = 'playlist';
    nodes['s6-from']!.value = '1';
    nodes['s6-to']!.value = '1';
    await nodes['s6-prepare']!.handlers['click']!();
    expect(sent.find((message) => message.kind === 'S6_PREPARE_COLLECTION')).toMatchObject({
      collectionIdentity: 'playlist/race',
      collectionKind: 'playlist',
      fromPage: 1,
      toPage: 1,
    });
    nodes['s6-members']!.querySelectorAll = () => {
      const selected = makeNode();
      selected.checked = true;
      selected.dataset.memberId = 's6-member-race';
      return [selected];
    };
    await nodes['s6-confirm']!.handlers['click']!();
    await nodes['s6-execute']!.handlers['click']!();
    expect(statusResponses).toHaveLength(1);

    const overlappingTickA = timers.tick();
    const overlappingTickB = timers.tick();
    await Promise.resolve();
    expect(statusResponses).toHaveLength(1);

    await nodes['s6-execute']!.handlers['click']!();
    expect(statusResponses).toHaveLength(2);
    statusResponses[1]!.resolve({
      ok: true,
      status: 'TERMINAL',
      facts: {
        terminal: { requestFulfillment: 'COMPLETE', marker: 'NEW_S6_TERMINAL' },
        members: [],
      },
    });
    await vi.waitFor(() => expect(nodes['s6-batch-result']!.className).toBe('state COMPLETE'));

    statusResponses[0]!.resolve({ ok: false, error: 'LATE_OLD_S6_FAILURE' });
    await Promise.all([overlappingTickA, overlappingTickB]);
    await Promise.resolve();
    expect(nodes['s6-batch-result']!.className).toBe('state COMPLETE');
    expect(nodes['s6-batch-result']!.textContent).toContain('NEW_S6_TERMINAL');
    expect(nodes['s6-batch-result']!.textContent).not.toContain('LATE_OLD_S6_FAILURE');
    expect(timers.size()).toBe(0);
  });

  it('keeps v0.2 single-flight and prevents an old lineage RUNNING response from replacing a newer terminal', async () => {
    const statusResponses = new Map<
      string,
      { promise: Promise<unknown>; resolve: (value: unknown) => void }[]
    >();
    let submissions = 0;
    const { nodes, timers } = startPopup({
      manualTimers: true,
      respond: (payload) => {
        if (payload.kind === 'V02_ADD_DOWNLOAD') {
          submissions += 1;
          const lineageId = submissions === 1 ? 'lineage-old' : 'lineage-new';
          return {
            outcome: 'ADMITTED',
            lineageId,
            requestId: `request-${String(submissions)}`,
            acceptance: { requestId: `request-${String(submissions)}`, aggregateId: lineageId },
          };
        }
        if (payload.kind === 'V02_JOB_STATUS') {
          const lineageId = String(payload['lineageId']);
          const response = deferred<unknown>();
          const responses = statusResponses.get(lineageId) ?? [];
          responses.push(response);
          statusResponses.set(lineageId, responses);
          return response.promise;
        }
        return { outcome: 'REFUSED', code: 'V02_MESSAGE_MALFORMED', detail: 'unexpected' };
      },
    });
    await ready(nodes);
    nodes['v02-target-ref']!.value = 'ref:old';
    nodes['v02-output-root']!.value = 'C:/tmp/authorized-root';
    await nodes['v02-submit']!.handlers['click']!();
    expect(statusResponses.get('lineage-old')).toHaveLength(1);

    const overlappingTickA = timers.tick();
    const overlappingTickB = timers.tick();
    await Promise.resolve();
    expect(statusResponses.get('lineage-old')).toHaveLength(1);

    nodes['v02-target-ref']!.value = 'ref:new';
    await nodes['v02-submit']!.handlers['click']!();
    expect(statusResponses.get('lineage-new')).toHaveLength(1);
    statusResponses.get('lineage-new')![0]!.resolve({
      outcome: 'PROJECTION',
      projection: { lineageId: 'lineage-new', owner: 'new-owner', status: 'COMPLETE' },
    });
    await vi.waitFor(() => expect(nodes['v02-result']!.className).toBe('state COMPLETE'));

    statusResponses.get('lineage-old')![0]!.resolve({
      outcome: 'PROJECTION',
      projection: { lineageId: 'lineage-old', owner: 'old-owner', status: 'RUNNING' },
    });
    await Promise.all([overlappingTickA, overlappingTickB]);
    await Promise.resolve();
    expect(nodes['v02-result']!.className).toBe('state COMPLETE');
    expect(nodes['v02-result']!.textContent).toContain('new-owner');
    expect(nodes['v02-result']!.textContent).not.toContain('old-owner');
    expect(timers.size()).toBe(0);
  });
});

describe('#152 packaged S5 popup -> worker gesture (Core carrier absent)', () => {
  it('sends one bounded full-page gesture and renders the truthful lane refusal', async () => {
    const { nodes, sent } = startPopup();
    await ready(nodes);
    const list = nodes['attachments']!;
    expect(list.children.length).toBe(2);
    await nodes['s5-prepare']!.handlers['click']!();
    expect(s5Gestures(sent)).toHaveLength(1);
    expect(decodeS5PageGroupGesture(s5Gestures(sent)[0]).ok).toBe(true);
    expect(nodes['s5-preview-result']!.textContent).toContain('S5_CORE_CARRIER_NOT_INSTALLED');
    expect(nodes['s5-prepare']!.disabled).toBe(false);
    // No frozen-member rows were fabricated without Core facts.
    expect(nodes['s5-frozen']!.children).toHaveLength(0);
  });

  it('does not submit truncated scan, tab change or changed membership', async () => {
    for (const scenario of [{ total: 21 }, { changed: true }, { staleMembers: true }]) {
      const { nodes, sent } = startPopup(scenario);
      await ready(nodes);
      await nodes['s5-prepare']!.handlers['click']!();
      expect(s5Gestures(sent)).toHaveLength(0);
      expect(nodes['s5-preview-result']!.textContent).toMatch(/拒绝|变化/iu);
    }
  });
});

describe('#152 packaged S5 popup -> installed batch flow', () => {
  function installedResponses(payload: { kind: string }): unknown {
    if (payload.kind === 'S5_PREPARE_CURRENT_PAGE_GROUP') {
      return {
        ok: true,
        contractId: 'contract-s5-installed-001',
        facts: {
          prepareId: 's5prepare:contract-s5-installed-001:snapshot-s5-001',
          snapshotId: 'snapshot-s5-001',
          members: FROZEN_MEMBERS,
          observedTupleDigest: 'd'.repeat(64),
        },
      };
    }
    if (payload.kind === 'S5_CONFIRM_GROUP') {
      return {
        ok: true,
        status: 'CONFIRM',
        facts: {
          confirmedGroupId: 's5group:contract-s5-installed-001:snapshot-s5-001',
          selectedMemberIds: FROZEN_MEMBERS.map((member) => member.memberId),
          contractStatus: 'CONFIRMED',
        },
      };
    }
    if (payload.kind === 'S5_EXECUTE_GROUP') {
      return {
        ok: true,
        status: 'TERMINAL',
        facts: {
          terminal: { requestFulfillment: 'PARTIAL', coverage: 'UNKNOWN' },
          members: [
            {
              memberId: 's5m-0000000000000001',
              href: LINKS[0]!.href,
              outcome: 'ACQUIRED',
              accepted: true,
              detail: 'durably accepted with verified bytes',
            },
            {
              memberId: 's5m-0000000000000002',
              href: LINKS[1]!.href,
              outcome: 'ACQUIRED',
              accepted: false,
              detail: 'transfer failed',
            },
          ],
        },
      };
    }
    return { ok: false, error: 'unexpected message' };
  }

  it('renders the Core-frozen members after prepare and never claims them before', async () => {
    const { nodes, sent } = startPopup({ respond: installedResponses });
    await ready(nodes);
    await nodes['s5-prepare']!.handlers['click']!();
    expect(s5Gestures(sent)).toHaveLength(1);
    const frozen = nodes['s5-frozen']!;
    expect(frozen.children).toHaveLength(2);
    expect(nodes['s5-batch']!.hidden).toBe(false);
    // Execute stays disabled until Core durably confirms the chosen subset.
    expect(nodes['s5-execute']!.disabled).toBe(true);
  });

  it('carries the exact Core member identities through confirm and renders the verbatim terminal', async () => {
    const { nodes, sent } = startPopup({ respond: installedResponses });
    await ready(nodes);
    await nodes['s5-prepare']!.handlers['click']!();
    // The frozen checkboxes select the subset; the stub leaves both checked.
    nodes['s5-frozen']!.querySelectorAll = () => {
      const a = makeNode();
      a.checked = true;
      a.dataset.memberId = FROZEN_MEMBERS[0]!.memberId;
      const b = makeNode();
      b.checked = true;
      b.dataset.memberId = FROZEN_MEMBERS[1]!.memberId;
      return [a, b];
    };
    await nodes['s5-confirm']!.handlers['click']!();
    expect(s5Gestures(sent)).toHaveLength(2);
    expect(s5Gestures(sent)[1]).toMatchObject({
      kind: 'S5_CONFIRM_GROUP',
      contractId: 'contract-s5-installed-001',
      selectedMemberIds: FROZEN_MEMBERS.map((member) => member.memberId),
    });
    expect(nodes['s5-execute']!.disabled).toBe(false);
    await nodes['s5-execute']!.handlers['click']!();
    expect(s5Gestures(sent)).toHaveLength(3);
    expect(s5Gestures(sent)[2]).toMatchObject({
      kind: 'S5_EXECUTE_GROUP',
      confirmedGroupId: 's5group:contract-s5-installed-001:snapshot-s5-001',
    });
    const text = nodes['s5-batch-result']!.textContent;
    expect(text).toContain('[OK] https://publisher.example.org/a.mp4');
    expect(text).toContain('transfer failed');
    expect(text).toContain('"requestFulfillment": "PARTIAL"');
  });

  it('renders a typed refusal when Core refuses the confirmation', async () => {
    const { nodes } = startPopup({
      respond: (payload) =>
        payload.kind === 'S5_PREPARE_CURRENT_PAGE_GROUP'
          ? installedResponses(payload)
          : { ok: false, error: 'S5 lane rejection at CORE_SUBMIT' },
    });
    await ready(nodes);
    await nodes['s5-prepare']!.handlers['click']!();
    nodes['s5-frozen']!.querySelectorAll = () => {
      const a = makeNode();
      a.checked = true;
      a.dataset.memberId = FROZEN_MEMBERS[0]!.memberId;
      return [a];
    };
    await nodes['s5-confirm']!.handlers['click']!();
    expect(nodes['s5-batch-result']!.textContent).toContain('Core 拒绝了确认');
    expect(nodes['s5-execute']!.disabled).toBe(true);
  });
});

describe('#154 S6 popup truncation guard (R1 P1-02)', () => {
  it('refuses to record a truncated declared page and never forwards it to Core', async () => {
    const twenty = Array.from({ length: 20 }, (_unused, index) => ({
      href: `https://publisher.example.org/s6-file-${String(index)}.mp4`,
      text: `F${String(index)}`,
    }));
    const { nodes, sent } = startPopup({
      s6Scan: {
        links: twenty,
        observedCount: 21,
        nextPageHref: 'https://publisher.example.org/list.html?p=2',
        pageUrl: 'https://publisher.example.org/list.html',
      },
      respond: (payload) => {
        if (payload.kind === 'S6_ACTIVE_COLLECTION_QUERY') {
          return { ok: true, journey: null };
        }
        if (payload.kind === 'S6_PREPARE_COLLECTION') {
          return {
            ok: true,
            contractId: 'contract-s6-truncated',
            facts: {
              prepareId: 's6prepare:contract-s6-truncated:snapshot-s6-truncated',
              snapshotId: 'snapshot-s6-truncated',
              collectionPageUrl: 'https://publisher.example.org/list.html',
              fromPage: 1,
              toPage: 2,
              observedTupleDigest: 'c'.repeat(64),
            },
          };
        }
        return { ok: false, error: 'S6_CORE_CARRIER_NOT_INSTALLED' };
      },
    });
    await ready(nodes);
    nodes['s6-identity']!.value = 'playlist/truncated';
    nodes['s6-kind']!.value = 'playlist';
    nodes['s6-from']!.value = '1';
    nodes['s6-to']!.value = '2';
    await nodes['s6-prepare']!.handlers['click']!();
    await vi.waitFor(() =>
      expect(sent.some((message) => message.kind === 'S6_PREPARE_COLLECTION')).toBe(true),
    );
    // The 21-anchor page is a TRUNCATED observation: the popup must stop
    // truthfully BEFORE any RECORD reaches Core — a truncated page can never
    // become a full requested-scope or VERIFIED_COMPLETE claim.
    await vi.waitFor(() => {
      expect(nodes['s6-batch-result']!.textContent).toContain('当前扫描只读取了');
    });
    expect(sent.some((message) => message.kind === 'S6_PAGE_RECORD')).toBe(false);
  });

  it('refuses a fromPage greater than 1 truthfully (R1 P2-01)', async () => {
    const { nodes, sent } = startPopup({
      respond: (payload) => {
        if (payload.kind === 'S6_ACTIVE_COLLECTION_QUERY') {
          return { ok: true, journey: null };
        }
        return { ok: false, error: 'S6_CORE_CARRIER_NOT_INSTALLED' };
      },
    });
    await ready(nodes);
    nodes['s6-identity']!.value = 'playlist/late-start';
    nodes['s6-kind']!.value = 'playlist';
    nodes['s6-from']!.value = '2';
    nodes['s6-to']!.value = '3';
    await nodes['s6-prepare']!.handlers['click']!();
    await vi.waitFor(() => {
      expect(nodes['s6-prepare-result']!.textContent).toContain('fromPage 必须为 1');
    });
    expect(sent.some((message) => message.kind === 'S6_PREPARE_COLLECTION')).toBe(false);
  });
});

describe('v0.2.1 T05 popup v0.2 submission panel', () => {
  it('submits the bounded gesture with the tab-grounded page facts and no browser context', async () => {
    const { nodes, sent } = startPopup({
      respond: (message) =>
        message.kind === 'V02_ADD_DOWNLOAD'
          ? {
              outcome: 'ADMITTED',
              lineageId: 'lineage-v02-001',
              requestId: 'req-v02-001',
              acceptance: { requestId: 'req-v02-001', aggregateId: 'lineage-v02-001' },
            }
          : { outcome: 'REFUSED', code: 'V02_MESSAGE_MALFORMED', detail: 'unexpected poll' },
    });
    await ready(nodes);
    nodes['v02-target-ref']!.value = 'ref:target-001';
    nodes['v02-output-root']!.value = 'C:/tmp/authorized-root';
    await nodes['v02-submit']!.handlers['click']!();
    const gestures = sent.filter((message) => message.kind === 'V02_ADD_DOWNLOAD');
    expect(gestures).toHaveLength(1);
    const gesture = gestures[0]!;
    expect(gesture['tabId']).toBe(42);
    expect(gesture['pageUrl']).toBe('https://publisher.example.org/list.html');
    const action = gesture['action'] as Record<string, unknown>;
    expect(action['targetRef']).toBe('ref:target-001');
    expect(action['outputRootScope']).toBe('C:/tmp/authorized-root');
    expect(action['allowedOperation']).toBe('acquisition.acquire');
    expect(action['slice']).toBe('S1');
    // No browser context rides the gesture: the closed action interface has
    // no field for cookies/tabs/page content, and the popup adds none.
    expect(Object.keys(action).sort()).toEqual([
      'allowedOperation',
      'caller',
      'outputRootScope',
      'slice',
      'targetRef',
    ]);
    await vi.waitFor(() => {
      expect(nodes['v02-result']!.textContent).toContain('lineage-v02-001');
    });
  });

  it('renders a typed refusal verbatim and never fabricates admission', async () => {
    const { nodes, sent } = startPopup({
      respond: (message) =>
        message.kind === 'V02_ADD_DOWNLOAD'
          ? {
              outcome: 'REFUSED',
              code: 'V02_HOST_ABSENT',
              detail: 'the trusted local xDownload Host is not reachable',
            }
          : { outcome: 'REFUSED', code: 'V02_MESSAGE_MALFORMED', detail: 'unexpected poll' },
    });
    await ready(nodes);
    nodes['v02-target-ref']!.value = 'ref:target-001';
    nodes['v02-output-root']!.value = 'C:/tmp/authorized-root';
    await nodes['v02-submit']!.handlers['click']!();
    expect(sent.filter((message) => message.kind === 'V02_JOB_STATUS')).toHaveLength(0);
    await vi.waitFor(() => {
      expect(nodes['v02-result']!.textContent).toContain('V02_HOST_ABSENT');
      expect(nodes['v02-result']!.textContent).toContain('not reachable');
    });
    expect(nodes['v02-result']!.className).toBe('state FAILED');
  });

  it('polls the Core-owned projection after admission and renders UNKNOWN truthfully', async () => {
    const { nodes, sent } = startPopup({
      respond: (message) => {
        if (message.kind === 'V02_ADD_DOWNLOAD') {
          return {
            outcome: 'ADMITTED',
            lineageId: 'lineage-v02-001',
            requestId: 'req-v02-001',
            acceptance: { requestId: 'req-v02-001', aggregateId: 'lineage-v02-001' },
          };
        }
        if (message.kind === 'V02_JOB_STATUS') {
          return {
            outcome: 'PROJECTION',
            projection: {
              schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
              lineageId: 'lineage-v02-001',
              owner: 'new-k',
              status: 'UNKNOWN',
              attempts: [{ attemptId: 'attempt-1', sequence: 1, status: 'UNKNOWN' }],
              currentAttemptId: 'attempt-1',
            },
          };
        }
        return { outcome: 'REFUSED', code: 'V02_MESSAGE_MALFORMED', detail: 'unexpected' };
      },
    });
    await ready(nodes);
    nodes['v02-target-ref']!.value = 'ref:target-001';
    nodes['v02-output-root']!.value = 'C:/tmp/authorized-root';
    await nodes['v02-submit']!.handlers['click']!();
    await vi.waitFor(() => {
      expect(nodes['v02-result']!.textContent).toContain('Core 任务状态：UNKNOWN');
      expect(nodes['v02-result']!.textContent).toContain('所有者：new-k');
    });
    expect(sent.some((message) => message.kind === 'V02_JOB_STATUS')).toBe(true);
  });
});

describe('#154 S6 reopened popup recovery (R2 P1)', () => {
  const contractId = 'contract-s6-restored';
  const pageUrl = 'https://publisher.example.org/list.html';
  const nextUrl = 'https://publisher.example.org/playlist/page-2';
  const coreFacts = {
    prepared: {
      prepareId: 's6prepare:contract-s6-restored:snapshot-s6-restored',
      snapshotId: 'snapshot-s6-restored',
      collectionOrigin: 'https://publisher.example.org',
      collectionPageUrl: pageUrl,
      fromPage: 1,
      toPage: 2,
    },
    pages: [
      {
        pageNumber: 1,
        pageUrl,
        members: [{ memberId: 's6member-001', href: LINKS[0]!.href, text: 'A' }],
      },
    ],
    confirmed: null,
  };

  it('requests the active journey and re-scans its recorded page to recover the next link', async () => {
    const { nodes, sent } = startPopup({
      s6Scan: {
        links: [LINKS[0]!],
        observedCount: 1,
        nextPageHref: nextUrl,
        pageUrl,
      },
      respond: (message) =>
        message.kind === 'S6_ACTIVE_COLLECTION_QUERY'
          ? { ok: true, journey: { contractId, status: 'WALK', facts: coreFacts } }
          : { ok: false, error: 'unexpected' },
    });
    await ready(nodes);
    await vi.waitFor(() => {
      expect(nodes['s6-prepare-result']!.textContent).toContain('已从 Core 恢复 S6 任务');
      expect(nodes['s6-next-page']!.disabled).toBe(false);
    });
    expect(sent.some((message) => message.kind === 'S6_PAGE_ADMIT')).toBe(false);
    expect(nodes['s6-members']!.children).toHaveLength(1);
  });

  it('refuses to restore a next link on another origin before Core admission', async () => {
    const { nodes, sent } = startPopup({
      s6Scan: {
        links: [LINKS[0]!],
        observedCount: 1,
        nextPageHref: 'https://unrelated.example/playlist/page-2',
        pageUrl,
      },
      respond: (message) =>
        message.kind === 'S6_ACTIVE_COLLECTION_QUERY'
          ? { ok: true, journey: { contractId, status: 'WALK', facts: coreFacts } }
          : { ok: false, error: 'unexpected' },
    });
    await ready(nodes);
    await vi.waitFor(() =>
      expect(nodes['s6-prepare-result']!.textContent).toContain('已从 Core 恢复 S6 任务'),
    );
    expect(nodes['s6-next-page']!.disabled).toBe(true);
    expect(sent.some((message) => message.kind === 'S6_PAGE_ADMIT')).toBe(false);
  });

  it('declares the minimal storage permission needed for worker session recovery', () => {
    const manifestPath = new URL('../manifest.json', import.meta.url);
    const manifestText = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestText) as { permissions?: string[] };
    expect(manifest.permissions).toContain('storage');
  });
  it('localizes renderer-owned labels without rewriting Core terminal JSON or error details', () => {
    const match = popupSource.match(/function localizeUiMessage\(value\) \{[\s\S]*?\n {2}\}/u);
    expect(match).not.toBeNull();
    const localize = runInNewContext('(' + match![0] + ')') as (value: string) => string;
    expect(localize('selection rejected: unknown error')).toBe('文件选择被拒绝：未知错误');
    expect(localize('batch failed: unknown failure')).toBe('批量任务失败：未知原因');
    const rawTerminal = JSON.stringify({
      detail: ' Error: preserve exactly',
      transferred: 'Transferred:',
    });
    expect(localize('Core terminal projection (verbatim):\n' + rawTerminal)).toBe(
      'Core 原始终态（原样）：\n' + rawTerminal,
    );
    expect(localize('Core aggregate terminal (verbatim):\n' + rawTerminal)).toBe(
      'Core 汇总终态（原样）：\n' + rawTerminal,
    );
    expect(localize('Core refused the confirmation: CODE: Error: original detail')).toBe(
      'Core 拒绝了确认：CODE: Error: original detail',
    );
    expect(
      localize('journey status unreadable (service worker may have restarted): ERR: exact detail'),
    ).toBe('无法读取任务状态（服务工作线程可能已重启）：ERR: exact detail');
  });

  it('changes popup panels with click and keyboard only, without worker or permission side effects', async () => {
    const { nodes, sent, modeTabs, modePanels, sideEffects } = startPopup();
    await ready(nodes);
    const beforeMessages = sent.length;
    const beforePermissions = sideEffects.permissionRequests;

    modeTabs[1]!.handlers['click']!();
    expect(modePanels[1]!.hidden).toBe(false);
    expect(modePanels[0]!.hidden).toBe(true);
    expect(modeTabs[1]!.attributes['aria-selected']).toBe('true');
    expect(modeTabs[1]!.tabIndex).toBe(0);

    let prevented = false;
    modeTabs[1]!.handlers['keydown']!({
      key: 'End',
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(modePanels[3]!.hidden).toBe(false);
    expect(modeTabs[3]!.focused).toBe(true);
    expect(modeTabs[3]!.attributes['aria-selected']).toBe('true');

    modeTabs[3]!.handlers['keydown']!({ key: 'ArrowLeft', preventDefault() {} });
    expect(modePanels[2]!.hidden).toBe(false);
    expect(modeTabs[2]!.focused).toBe(true);
    modeTabs[2]!.handlers['keydown']!({ key: 'ArrowRight', preventDefault() {} });
    expect(modePanels[3]!.hidden).toBe(false);
    expect(modeTabs[3]!.focused).toBe(true);

    modeTabs[3]!.handlers['keydown']!({ key: 'Home', preventDefault() {} });
    expect(modePanels[0]!.hidden).toBe(false);
    expect(modeTabs[0]!.focused).toBe(true);
    expect(sent).toHaveLength(beforeMessages);
    expect(sideEffects.permissionRequests).toBe(beforePermissions);
  });

  it('respects system dark theme, forced colors and reduced motion preferences', () => {
    expect(popupHtml).toContain('color-scheme: light dark;');
    expect(popupHtml).toContain('@media (prefers-color-scheme: dark)');
    expect(popupHtml).toContain('@media (forced-colors: active)');
    expect(popupHtml).toContain('@media (prefers-reduced-motion: reduce)');
    expect(popupHtml).toContain('background: Canvas;');
    expect(popupHtml).toContain('outline: 2px solid Highlight;');
    expect(popupHtml).toContain('transition: none !important;');
    expect(popupHtml).toContain('.state.FAILED');
  });

  it('declares an accessible tab/tabpanel relationship and keyboard navigation', () => {
    expect(popupHtml).toContain('lang="zh-CN"');
    for (const mode of ['page', 'batch', 'collection', 'advanced']) {
      expect(popupHtml).toContain('id="tab-' + mode + '"');
      expect(popupHtml).toContain('aria-controls="panel-' + mode + '"');
      expect(popupHtml).toContain('id="panel-' + mode + '"');
      expect(popupHtml).toContain('aria-labelledby="tab-' + mode + '"');
    }
    expect(popupSource).toContain("event.key === 'ArrowRight'");
    expect(popupSource).toContain("event.key === 'ArrowLeft'");
    expect(popupSource).toContain("event.key === 'Home'");
    expect(popupSource).toContain("event.key === 'End'");
  });
});
