import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFormDescriptor, validatePreviewUrl } from '../src/renderer/form-schema.ts';
import type { ManagerJobRowDocument } from '../src/main/shell-contract.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'src/renderer/index.html'), 'utf8');
const renderer = readFileSync(join(root, 'src/renderer/renderer-main.ts'), 'utf8');

describe('UI R0 trusted dynamic form descriptor', () => {
  it('exposes only a known, versioned, confirm-first operation', () => {
    const form = getFormDescriptor('url-preview');
    expect(form?.schemaVersion).toBe(1);
    expect(form?.requiresCoreConfirmation).toBe(true);
    expect(form?.fields.map((f) => f.id)).toEqual(['url']);
    expect(getFormDescriptor('hls')).toBeNull();
    expect(getFormDescriptor('batch')).toBeNull();
    expect(getFormDescriptor('arbitrary-privileged-action')).toBeNull();
  });

  it('rejects unsafe URL shapes locally without authorizing a command', () => {
    for (const raw of [
      '',
      '  https://example.test/a',
      'ftp://example.test/a',
      'https://name:secret@example.test/private',
      'bad url',
      'https://example.test/' + 'a'.repeat(8192),
    ]) {
      expect(validatePreviewUrl(raw).ok, raw.slice(0, 50)).toBe(false);
    }
    expect(validatePreviewUrl('https://example.test/download.zip').ok).toBe(true);
    expect(validatePreviewUrl('http://example.test/a').ok).toBe(true);
  });
});

describe('UI R0 renderer containment and user navigation', () => {
  it('keeps existing IPC bridge, Core preview and destructive confirmation split', () => {
    for (const method of [
      'managerRefresh',
      'managerPreviewAdd',
      'managerConfirmAdd',
      'managerDiscardPreview',
      'managerCancelJob',
      'managerRetryJob',
    ]) {
      expect(renderer).toContain('BRIDGE.' + method);
    }
    expect(renderer).toContain('window.xdownloadShell');
    expect(renderer).toContain('renderFormFields()');
    expect(renderer).toContain("getFormDescriptor('url-preview')");
  });
  it('exposes user-familiar navigation with accessible localized state and no fake bytes', () => {
    expect(html).toContain('lang="zh-CN"');
    for (const id of [
      'app',
      'new-download',
      'job-search',
      'empty-state',
      'filter-empty',
      'add-dialog',
      'preview',
      'job-details',
      'jobs-table',
      'jobs-body',
      'form-fields',
      'connection-line',
      'bridge-missing',
    ]) {
      expect(html).toContain('id="' + id + '"');
    }
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('aria-modal="true"');
    expect(renderer).toContain('尚无权威字节进度');
    expect(renderer).not.toContain('innerHTML');
  });
  it('describes only the fields that the task search actually indexes', () => {
    expect(html).toContain('placeholder="搜索来源、状态或失败原因"');
    expect(html).not.toContain('placeholder="搜索链接来源、状态或目录"');
    expect(renderer).toContain(
      "[taskLabel(row), statusLabel(row), row.terminal?.stopReason ?? '']",
    );
  });

  it('keeps unsupported destination selection and reveal controls out of the renderer', () => {
    expect(html).not.toContain('id="destination-label"');
    expect(html).not.toContain('id="choose-destination"');
    expect(renderer).not.toContain('choose-destination');
    expect(renderer).not.toContain('destination.id');
    expect(renderer).not.toContain('browse.id');
  });

  it('hides lineage IDs from the ordinary list and requires every Core completion dimension', () => {
    expect(renderer).not.toContain('row.lineageId.slice');
    expect(renderer).toContain("byId('details-lineage').textContent = current.lineageId");
    for (const marker of [
      "terminal.targetResolution === 'RESOLVED'",
      "terminal.selectionAcquisition === 'COMPLETE'",
      "terminal.coverage === 'VERIFIED_COMPLETE'",
      "terminal.requestFulfillment === 'COMPLETE'",
      "terminal.validationSummary.status === 'ALL_PASSED'",
    ]) {
      expect(renderer).toContain(marker);
    }
    expect(html).toContain('未结束');
    expect(renderer).toContain('已提交 · 未结束');
    expect(renderer).toContain("row.lineageStatus === 'ACTIVE'");
    expect(renderer).toContain("row.lineageStatus === 'CANCELLED'");
    expect(renderer).toContain("row.lineageStatus === 'TERMINAL'");
    expect(renderer).toContain("validation.status === 'FAILED'");
    expect(renderer).toContain("validation.status === 'INSUFFICIENT_EVIDENCE'");
    expect(renderer).not.toContain("validation.status === 'NONE_PASSED'");
    expect(renderer).not.toContain("terminal.selectionAcquisition === 'ACQUIRED'");
    expect(renderer).not.toContain('runReveal');
    expect(renderer).not.toContain('managerRevealJob');
    expect(renderer).not.toContain('managerChooseDestination');
    expect(renderer).toContain('保存位置由 Core 配置管理');
    expect(html).toContain('桌面入口不提供按任务选择或修改输出目录');
    expect(html).not.toContain('打开目录');
  });

  it('uses only the source host as a friendly label and keeps Core diagnostics intact', () => {
    expect(renderer).toContain("return '来源站点 · ' + parsed.host");
    expect(renderer).not.toContain('parsed.pathname');
    expect(renderer).not.toContain('parsed.search');
    expect(renderer).toContain('function localizeNotice');
    expect(renderer).toContain('Core 拒绝了');
    expect(renderer).toContain('m[3]');
    expect(renderer).toContain('Core 原始状态：');
    expect(renderer).toContain("m[2] === 'refused' ? 'Core 未确认受理' : m[2]");
  });
});

// ---- U03 #333: behavior-level completion predicate regression --------------
//
// The completion predicate lives in renderer-main.ts, which binds to the DOM
// at import time. A minimal local fake DOM lets the REAL module render REAL
// Core projection rows under the Node unit runner; no production export is
// added or reshaped for testing, and fixtures use only protocol-valid
// terminal dimensions.

type FakeListener = (event: unknown) => void;

class FakeElement {
  readonly children: FakeElement[] = [];
  private ownText = '';
  readonly listeners = new Map<string, FakeListener[]>();
  readonly dataset: Record<string, string> = {};
  hidden = false;
  disabled = false;
  value = '';
  className = '';
  type = '';
  required = false;
  autocomplete = '';
  spellcheck = false;
  placeholder = '';
  htmlFor = '';
  scope = '';
  title = '';
  readonly classList = {
    toggle: (_className: string, _on: boolean): void => {
      /* presentation only */
    },
  };

  get textContent(): string {
    return this.children.length === 0
      ? this.ownText
      : this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.ownText = value;
    if (value === '') this.children.length = 0;
  }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  addEventListener(type: string, listener: FakeListener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  setAttribute(_name: string, _value: string): void {
    /* presentation only */
  }

  hasAttribute(_name: string): boolean {
    return false;
  }

  focus(): void {
    /* no-op */
  }

  setCustomValidity(_message: string): void {
    /* no-op */
  }

  reportValidity(): boolean {
    return true;
  }

  contains(_other: unknown): boolean {
    return false;
  }

  querySelectorAll(_selector: string): FakeElement[] {
    return [];
  }
}

const RENDERER_IDS = [
  'loading',
  'app',
  'bridge-missing',
  'notice',
  'truncation-notice',
  'connection-line',
  'add-dialog',
  'add-submit',
  'url',
  'preview',
  'preview-url',
  'preview-destination',
  'preview-requests',
  'preview-confirm',
  'preview-discard',
  'form-fields',
  'new-download',
  'empty-add',
  'add-close',
  'add-cancel',
  'details-close',
  'job-search',
  'add-form',
  'count-all',
  'count-active',
  'count-complete',
  'count-failed',
  'summary-all',
  'summary-active',
  'summary-complete',
  'empty-state',
  'filter-empty',
  'jobs-table',
  'jobs-body',
  'job-details',
  'details-title',
  'details-status',
  'details-progress',
  'details-destination',
  'details-lineage',
  'details-revision',
  'details-reason',
] as const;

interface BootedRenderer {
  readonly dom: ReadonlyMap<string, FakeElement>;
  readonly nav: readonly FakeElement[];
}

function installFakeDom(bridge: unknown): BootedRenderer {
  const byId = new Map<string, FakeElement>();
  for (const id of RENDERER_IDS) byId.set(id, new FakeElement());
  const nav = (['all', 'active', 'complete', 'failed'] as const).map((filter) => {
    const button = new FakeElement();
    button.dataset.filter = filter;
    return button;
  });
  const documentFake = {
    getElementById: (id: string) => byId.get(id) ?? null,
    createElement: () => new FakeElement(),
    querySelectorAll: (selector: string) => (selector === '.nav-item[data-filter]' ? [...nav] : []),
    visibilityState: 'visible',
    activeElement: null,
  };
  const windowFake = {
    xdownloadShell: bridge,
    setInterval: () => 0,
    clearInterval: () => undefined,
    addEventListener: () => undefined,
  };
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = windowFake;
  globals.document = documentFake;
  return { dom: byId, nav };
}

function presentRow(overrides: Partial<ManagerJobRowDocument> = {}): ManagerJobRowDocument {
  return {
    lineageId: 'contract-desktop-u03-000001',
    lane: 's1',
    contractStatus: 'CONFIRMED',
    revision: 3,
    lineageStatus: 'ACTIVE',
    terminal: null,
    retry: { available: false, reason: 'NO_FAILED_MEMBERS' },
    ...overrides,
  };
}

function terminalResult(
  overrides: Partial<NonNullable<ManagerJobRowDocument['terminal']>> = {},
): NonNullable<ManagerJobRowDocument['terminal']> {
  return {
    requestFulfillment: 'COMPLETE',
    targetResolution: 'RESOLVED',
    selectionAcquisition: 'COMPLETE',
    coverage: 'NOT_APPLICABLE',
    stopReason: 'NONE',
    validationSummary: { status: 'ALL_PASSED', passedCount: 1, failedCount: 0 },
    recordedAt: '2026-11-03T00:00:00.000Z',
    ...overrides,
  };
}

/** Boot the real renderer module against a fresh fake DOM and a fixed Core projection. */
async function bootRenderer(rows: readonly ManagerJobRowDocument[]): Promise<BootedRenderer> {
  vi.resetModules();
  const bridge = {
    managerRefresh: vi.fn(async () => ({
      ok: true as const,
      document: 'xdownload.desktop.manager.jobs' as const,
      connection: 'CONNECTED' as const,
      jobs: rows,
      totalCount: rows.length,
      truncated: false,
      pendingPreview: null,
    })),
  };
  const booted = installFakeDom(bridge);
  await import('../src/renderer/renderer-main.ts');
  await new Promise((resolve) => setTimeout(resolve, 0));
  return booted;
}

function renderedRows(dom: ReadonlyMap<string, FakeElement>): FakeElement[] {
  return dom.get('jobs-body')?.children ?? [];
}

function childAt(element: FakeElement, index: number): FakeElement {
  const child = element.children[index];
  if (child === undefined) throw new Error('fake DOM child missing at index ' + index);
  return child;
}

function onlyRow(dom: ReadonlyMap<string, FakeElement>): FakeElement {
  const rows = renderedRows(dom);
  const [row] = rows;
  if (row === undefined || rows.length !== 1) {
    throw new Error('expected exactly one rendered row, got ' + rows.length);
  }
  return row;
}

function statusTagOf(row: FakeElement): FakeElement {
  return childAt(childAt(row, 1), 0);
}

function progressCellOf(row: FakeElement): FakeElement {
  return childAt(row, 2);
}

function click(element: FakeElement): void {
  for (const listener of element.listeners.get('click') ?? []) listener({});
}

function applyFilter(nav: readonly FakeElement[], filter: string): void {
  const button = nav.find((candidate) => candidate.dataset.filter === filter);
  if (button === undefined) throw new Error('missing filter button ' + filter);
  click(button);
}

describe('UI R0 completion predicate — behavior (#333)', () => {
  it('SINGLE-RESOURCE-COMPLETE-01: valid single-resource COMPLETE + NOT_APPLICABLE is 已完成, counted complete not failed', async () => {
    const row = presentRow({
      lineageId: 'contract-desktop-u03-single-na',
      lineageStatus: 'TERMINAL',
      terminal: terminalResult(),
    });
    const { dom, nav } = await bootRenderer([row]);

    expect(dom.get('count-all')?.textContent).toBe('1');
    expect(dom.get('count-complete')?.textContent).toBe('1');
    expect(dom.get('count-failed')?.textContent).toBe('0');
    expect(dom.get('summary-complete')?.textContent).toBe('1');

    const rendered = onlyRow(dom);
    const tag = statusTagOf(rendered);
    expect(tag.textContent).toBe('已完成');
    expect(tag.className).toContain('complete');
    expect(tag.className).not.toContain('failed');

    // Never “已验证完成”: NOT_APPLICABLE has no measured coverage evidence,
    // so the honest coverage detail text is kept instead.
    const progress = progressCellOf(rendered);
    expect(progress.textContent).not.toBe('已验证完成');
    expect(progress.textContent).toContain('NOT_APPLICABLE');

    // Details panel uses the same statusLabel predicate.
    click(childAt(childAt(rendered, 0), 0));
    expect(dom.get('details-status')?.textContent).toBe('已完成');

    applyFilter(nav, 'complete');
    expect(renderedRows(dom)).toHaveLength(1);
    applyFilter(nav, 'failed');
    expect(renderedRows(dom)).toHaveLength(0);
    applyFilter(nav, 'active');
    expect(renderedRows(dom)).toHaveLength(0);
  });

  it('COLLECTION-COMPLETE-01: VERIFIED_COMPLETE collection behavior stays complete with 已验证完成', async () => {
    const row = presentRow({
      lineageId: 'contract-desktop-u03-collection-vc',
      lineageStatus: 'TERMINAL',
      terminal: terminalResult({
        coverage: 'VERIFIED_COMPLETE',
        validationSummary: { status: 'ALL_PASSED', passedCount: 3, failedCount: 0 },
      }),
    });
    const { dom, nav } = await bootRenderer([row]);

    expect(dom.get('count-complete')?.textContent).toBe('1');
    expect(dom.get('count-failed')?.textContent).toBe('0');

    const rendered = onlyRow(dom);
    expect(statusTagOf(rendered).textContent).toBe('已完成');
    expect(progressCellOf(rendered).textContent).toBe('已验证完成');

    applyFilter(nav, 'complete');
    expect(renderedRows(dom)).toHaveLength(1);
    applyFilter(nav, 'failed');
    expect(renderedRows(dom)).toHaveLength(0);
  });

  it('PARTIAL-FAILED-01: PARTIAL validation, UNSATISFIED and FAILED validation remain non-complete and failed', async () => {
    const rows = [
      presentRow({
        lineageId: 'contract-desktop-u03-partial-validation',
        lineageStatus: 'TERMINAL',
        terminal: terminalResult({
          validationSummary: { status: 'PARTIAL', passedCount: 1, failedCount: 1 },
        }),
      }),
      presentRow({
        lineageId: 'contract-desktop-u03-unsatisfied',
        lineageStatus: 'TERMINAL',
        terminal: terminalResult({
          requestFulfillment: 'UNSATISFIED',
          targetResolution: 'BLOCKED',
          selectionAcquisition: 'NOT_STARTED',
          stopReason: 'AUTH_FAILED',
          validationSummary: { status: 'NOT_PERFORMED', passedCount: 0, failedCount: 0 },
        }),
      }),
      presentRow({
        lineageId: 'contract-desktop-u03-failed-validation',
        lineageStatus: 'TERMINAL',
        terminal: terminalResult({
          validationSummary: { status: 'FAILED', passedCount: 0, failedCount: 1 },
        }),
      }),
    ];
    const { dom, nav } = await bootRenderer(rows);

    expect(dom.get('count-complete')?.textContent).toBe('0');
    expect(dom.get('count-failed')?.textContent).toBe('3');

    for (const rendered of renderedRows(dom)) {
      const tag = statusTagOf(rendered);
      expect(tag.textContent).toBe('已结束 · 未完成');
      expect(tag.className).toContain('failed');
    }

    applyFilter(nav, 'complete');
    expect(renderedRows(dom)).toHaveLength(0);
    applyFilter(nav, 'failed');
    expect(renderedRows(dom)).toHaveLength(3);
  });

  it('CANCELLED-UNKNOWN-01: cancelled, missing-terminal, unrecognized-status and retry-available rows stay non-complete', async () => {
    const rows = [
      presentRow({
        lineageId: 'contract-desktop-u03-cancelled',
        lineageStatus: 'CANCELLED',
      }),
      presentRow({
        lineageId: 'contract-desktop-u03-missing-terminal',
        lineageStatus: 'TERMINAL',
        terminal: null,
      }),
      // An unrecognized Core status word renders as "状态待核实" — the S1
      // index rows are verified projections, so there is no absent-row form.
      presentRow({
        lineageId: 'contract-desktop-u03-unrecognized',
        lineageStatus: 'UNRECOGNIZED_WORD',
      }),
      // Retry availability alone never proves completion.
      presentRow({
        lineageId: 'contract-desktop-u03-retry-available',
        lineageStatus: 'ACTIVE',
        retry: { available: true, reason: null },
      }),
    ];
    const { dom, nav } = await bootRenderer(rows);

    expect(dom.get('count-all')?.textContent).toBe('4');
    expect(dom.get('count-complete')?.textContent).toBe('0');
    expect(dom.get('count-failed')?.textContent).toBe('2');
    expect(dom.get('count-active')?.textContent).toBe('1');

    // Rows render in projection order.
    const labels = renderedRows(dom).map((row) => statusTagOf(row).textContent);
    expect(labels).toEqual(['已取消', '已结束 · 终态明细缺失', '状态待核实', '已提交 · 未结束']);

    applyFilter(nav, 'complete');
    expect(renderedRows(dom)).toHaveLength(0);
  });

  it('FILTER-COUNTS-01: counters and filters agree with the shared predicate across mixed projections', async () => {
    const rows = [
      presentRow({
        lineageId: 'contract-desktop-u03-mix-na-complete',
        lineageStatus: 'TERMINAL',
        terminal: terminalResult(),
      }),
      presentRow({
        lineageId: 'contract-desktop-u03-mix-vc-complete',
        lineageStatus: 'TERMINAL',
        terminal: terminalResult({
          coverage: 'VERIFIED_COMPLETE',
          validationSummary: { status: 'ALL_PASSED', passedCount: 2, failedCount: 0 },
        }),
      }),
      presentRow({
        lineageId: 'contract-desktop-u03-mix-failed',
        lineageStatus: 'TERMINAL',
        terminal: terminalResult({
          requestFulfillment: 'UNSATISFIED',
          targetResolution: 'BLOCKED',
          selectionAcquisition: 'NOT_STARTED',
          stopReason: 'AUTH_FAILED',
          validationSummary: { status: 'NOT_PERFORMED', passedCount: 0, failedCount: 0 },
        }),
      }),
      presentRow({
        lineageId: 'contract-desktop-u03-mix-cancelled',
        lineageStatus: 'CANCELLED',
      }),
    ];
    const { dom, nav } = await bootRenderer(rows);

    expect(dom.get('count-all')?.textContent).toBe('4');
    expect(dom.get('count-complete')?.textContent).toBe('2');
    expect(dom.get('count-failed')?.textContent).toBe('2');

    applyFilter(nav, 'complete');
    const completeRows = renderedRows(dom);
    expect(completeRows).toHaveLength(2);
    for (const rendered of completeRows) {
      expect(statusTagOf(rendered).textContent).toBe('已完成');
    }

    applyFilter(nav, 'failed');
    expect(renderedRows(dom)).toHaveLength(2);

    applyFilter(nav, 'all');
    expect(renderedRows(dom)).toHaveLength(4);
  });
});
