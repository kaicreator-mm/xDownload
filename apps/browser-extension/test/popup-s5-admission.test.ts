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
    setAttribute() {},
  };
}

function startPopup(options: { total?: number; changed?: boolean; staleMembers?: boolean } = {}) {
  const ids = ['attachments', 'state', 's5-group', 's5-preview', 's5-prepare', 's5-preview-result'];
  const nodes = Object.fromEntries(ids.map((id) => [id, makeNode()])) as Record<string, StubNode>;
  const links = [
    { href: 'https://publisher.example.org/a.mp4', text: 'A' },
    { href: 'https://cdn.example.net/b.mp4', text: 'B' },
  ];
  const tab = { id: 42, url: 'https://publisher.example.org/list.html' };
  const sent: unknown[] = [];
  let scans = 0;
  runInNewContext(popupSource, {
    URL,
    setInterval,
    clearInterval,
    document: {
      getElementById: (id: string) => nodes[id],
      createElement: () => makeNode(),
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
        sendMessage: async (payload: unknown) => {
          sent.push(structuredClone(payload));
          return { ok: false, error: 'S5_CORE_CARRIER_NOT_INSTALLED' };
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

describe('#152 packaged S5 popup -> worker gesture (Core not installed)', () => {
  it('sends one bounded full-page gesture and renders the real worker refusal', async () => {
    const { nodes, sent } = startPopup();
    await ready(nodes);
    const list = nodes['attachments']!;
    expect(list.children.length).toBe(2);
    for (const li of list.children) li.children[1]!.checked = true;
    await nodes['s5-prepare']!.handlers['click']!();
    expect(sent).toHaveLength(1);
    expect(decodeS5PageGroupGesture(sent[0]).ok).toBe(true);
    expect(nodes['s5-preview-result']!.textContent).toContain('S5_CORE_CARRIER_NOT_INSTALLED');
    expect(nodes['s5-prepare']!.disabled).toBe(false);
  });

  it('does not submit partial group, truncated scan, tab change or changed membership', async () => {
    for (const scenario of [{}, { total: 21 }, { changed: true }, { staleMembers: true }]) {
      const { nodes, sent } = startPopup(scenario);
      await ready(nodes);
      const list = nodes['attachments']!;
      list.children[0]!.children[1]!.checked = true;
      if (scenario.total || scenario.changed || scenario.staleMembers) {
        list.children[1]!.children[1]!.checked = true;
      }
      await nodes['s5-prepare']!.handlers['click']!();
      expect(sent).toHaveLength(0);
      expect(nodes['s5-preview-result']!.textContent).toMatch(/refused|requires|changed/iu);
    }
  });
});
