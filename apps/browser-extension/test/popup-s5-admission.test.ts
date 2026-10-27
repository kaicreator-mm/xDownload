import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { decodeS5PageGroupGesture } from '../src/background/s5-group-intent.ts';

const popupSource = readFileSync(new URL('../src/popup/popup.js', import.meta.url), 'utf8');

type StubNode = {
  dataset: Record<string, string>;
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  checked: boolean;
  className: string;
  value: string;
  appendChild(child: StubNode): void;
  addEventListener(type: string, handler: () => Promise<void> | void): void;
  children: StubNode[];
  handlers: Record<string, () => Promise<void> | void>;
  querySelectorAll(selector: string): StubNode[];
  setAttribute(name: string, value: string): void;
};

function makeNode(): StubNode {
  return {
    dataset: {},
    textContent: '',
    hidden: false,
    disabled: false,
    checked: false,
    className: '',
    value: '',
    children: [],
    handlers: {},
    appendChild(child) {
      this.children.push(child);
    },
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    querySelectorAll() {
      return [];
    },
    setAttribute() {},
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
    respond?: (payload: { kind: string }) => unknown;
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
  ];
  const nodes = Object.fromEntries(ids.map((id) => [id, makeNode()])) as Record<string, StubNode>;
  const links = LINKS;
  const tab = { id: 42, url: 'https://publisher.example.org/list.html' };
  const sent: { kind: string; [key: string]: unknown }[] = [];
  let scans = 0;
  const respond =
    options.respond ?? (() => ({ ok: false, error: 'S5_CORE_CARRIER_NOT_INSTALLED' }));
  runInNewContext(popupSource, {
    URL,
    setInterval,
    clearInterval,
    document: {
      getElementById: (id: string) => nodes[id],
      createElement: () => makeNode(),
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
        sendMessage: async (payload: { kind: string }) => {
          sent.push(structuredClone(payload) as { kind: string });
          return respond(payload);
        },
      },
      permissions: { request: async () => false },
    },
  });
  return { nodes, sent, links };
}

async function ready(nodes: Record<string, StubNode>) {
  await vi.waitFor(() => expect(nodes['attachments']!.children.length).toBe(2));
}

/** R1 P2-02: the popup's S6 restore query on open is not an S5 gesture. */
function s5Gestures(sent: readonly { kind: string }[]): readonly { kind: string }[] {
  return sent.filter((message) => message.kind !== 'S6_ACTIVE_COLLECTION_QUERY');
}

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
      expect(nodes['s5-preview-result']!.textContent).toMatch(/refused|changed/iu);
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
    expect(nodes['s5-batch-result']!.textContent).toContain('Core refused the confirmation');
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
      expect(nodes['s6-batch-result']!.textContent).toContain('truncated');
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
      expect(nodes['s6-prepare-result']!.textContent).toContain('fromPage must be 1');
    });
    expect(sent.some((message) => message.kind === 'S6_PREPARE_COLLECTION')).toBe(false);
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
      expect(nodes['s6-prepare-result']!.textContent).toContain('Restored the active S6 journey');
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
      expect(nodes['s6-prepare-result']!.textContent).toContain('Restored the active S6 journey'),
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
});
