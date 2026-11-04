/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * U05-T03 download-manager renderer page binding — the thin DOM layer over
 * the pure state machine (`manager-state.ts`).
 *
 * Security discipline (pinned by the static security-invariant tests):
 * - The ONLY privileged surface is the typed preload bridge
 *   (`window.xdownloadShell`, frozen allowlist). No network API, no dynamic
 *   import, no eval, no inline handlers, no HTML-injection API: every text
 *   node is written with `textContent`, every listener with
 *   `addEventListener`.
 * - The page never invents transfer progress, output paths or destinations.
 *   U05-T03: the only rendered output-location string is the fixed label
 *   "保存位置由 Core 配置管理" — the page holds no picker, no reveal, no path.
 *
 * Accessibility: the add flow is fully keyboard-operable (Enter submits the
 * form, Escape discards the preview dialog, all actions are native buttons);
 * state changes are announced through an aria-live region; empty, loading,
 * truncated and error states are first-class.
 */
/* global window, document */

import type { ManagerJobRowDocument } from '../main/shell-contract.ts';
import { getFormDescriptor, validatePreviewUrl } from './form-schema.ts';
import {
  applyAction,
  applyList,
  bridgeMissing,
  initialManagerState,
  jobActions,
  jobStatusText,
  previewOpened,
  setBusy,
  truncationNoticeText,
  type ManagerRendererState,
} from './manager-state.ts';

const BRIDGE = window.xdownloadShell;
const REFRESH_INTERVAL_MS = 2000;
/** U05-T03: the one lawful output-location string; never a path, never guessed. */
const DESTINATION_LABEL = '保存位置由 Core 配置管理';

let state: ManagerRendererState = initialManagerState();
let refreshTimer = 0;
type TaskFilter = 'all' | 'active' | 'complete' | 'failed';
let taskFilter: TaskFilter = 'all';
let searchTerm = '';
let selectedLineage: string | null = null;
let addOpen = false;
const taskDisplayNames = new Map<string, string>();

function verifiedComplete(row: ManagerJobRowDocument): boolean {
  const terminal = row.terminal;
  return (
    row.lineageStatus === 'TERMINAL' &&
    terminal !== null &&
    terminal.targetResolution === 'RESOLVED' &&
    terminal.selectionAcquisition === 'COMPLETE' &&
    // Direct single-resource results carry NOT_APPLICABLE coverage by domain
    // contract (PRD §18.1); completion is proven by the other terminal
    // dimensions, never by coverage alone.
    (terminal.coverage === 'VERIFIED_COMPLETE' || terminal.coverage === 'NOT_APPLICABLE') &&
    terminal.requestFulfillment === 'COMPLETE' &&
    terminal.validationSummary.status === 'ALL_PASSED'
  );
}

function isActive(row: ManagerJobRowDocument): boolean {
  return row.lineageStatus === 'ACTIVE' && row.terminal === null;
}

function isFailed(row: ManagerJobRowDocument): boolean {
  return (
    row.lineageStatus === 'CANCELLED' ||
    (row.terminal !== null && !verifiedComplete(row)) ||
    (row.lineageStatus === 'TERMINAL' && row.terminal === null)
  );
}

function statusLabel(row: ManagerJobRowDocument): string {
  if (row.lineageStatus === 'CANCELLED') return '已取消';
  if (verifiedComplete(row)) return '已完成';
  if (row.terminal !== null) return '已结束 · 未完成';
  if (row.lineageStatus === 'ACTIVE') return '已提交 · 未结束';
  if (row.lineageStatus === 'TERMINAL') return '已结束 · 终态明细缺失';
  return '状态待核实';
}

/** Display only the user-entered origin; never expose URL paths, query strings or credentials. */
function taskLabelFromUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    return '来源站点 · ' + parsed.host;
  } catch {
    return '下载任务';
  }
}

function taskLabel(row: ManagerJobRowDocument): string {
  return taskDisplayNames.get(row.lineageId) ?? '下载任务';
}

function progressSummary(row: ManagerJobRowDocument): string {
  if (row.terminal === null) {
    if (row.lineageStatus === 'CANCELLED') return 'Core 已标记取消 · 终态明细尚未返回';
    if (row.lineageStatus === 'TERMINAL') return 'Core 已标记终结 · 终态明细缺失';
    if (row.lineageStatus !== 'ACTIVE') return 'Core 尚未确认任务状态';
    // The S1 lane projection carries no authoritative byte sample: no
    // percentage, speed or ETA is ever derived here.
    return '已提交 Core · 尚无权威字节进度 · 终态以 Core 投影为准';
  }
  const validation = row.terminal.validationSummary;
  const validationLabel =
    validation.status === 'ALL_PASSED'
      ? '全部通过'
      : validation.status === 'PARTIAL'
        ? '部分通过'
        : validation.status === 'FAILED'
          ? '未通过'
          : validation.status === 'INSUFFICIENT_EVIDENCE'
            ? '证据不足'
            : validation.status === 'NOT_PERFORMED'
              ? '尚未执行'
              : validation.status;
  const coverageLabel =
    row.terminal.coverage === 'VERIFIED_COMPLETE' ? '范围已验证完成' : row.terminal.coverage;
  return (
    '覆盖：' +
    coverageLabel +
    ' · 校验：' +
    validationLabel +
    '（通过 ' +
    validation.passedCount +
    ' 项，失败 ' +
    validation.failedCount +
    ' 项）'
  );
}

/** Translate renderer-authored phrases; preserve Core refusal details verbatim. */
function localizeNotice(text: string): string {
  const fixed: Record<string, string> = {
    'refresh refused: unexpected document': '刷新失败：Core 返回了无法识别的任务列表',
    'preview refused: unexpected document': '预览失败：Core 返回了无法识别的预览结果',
    'action refused: unexpected document': '操作失败：Core 返回了无法识别的操作结果',
    "the add was accepted by the Core (admission — the job list below shows the Core's projection)":
      '任务已提交至 Core（仅表示已受理，实际状态以任务列表为准）',
    "the cancel was accepted by the Core (admission — the job list below shows the Core's projection)":
      '取消请求已提交至 Core（实际结果以任务列表为准）',
    "the retry was accepted by the Core (admission — the job list below shows the Core's projection)":
      '重试请求已提交至 Core（实际结果以任务列表为准）',
  };
  const exact = fixed[text];
  if (exact !== undefined) return exact;
  const patterns: readonly [RegExp, (match: RegExpMatchArray) => string][] = [
    [/^refresh refused: (.*)$/u, (m) => '刷新失败：' + m[1]],
    [/^preview refused: (.*)$/u, (m) => '预览失败：' + m[1]],
    [/^action refused: (.*)$/u, (m) => '操作失败：' + m[1]],
    [
      /^the Core refused the (add|cancel|retry) \(([^)]+)\): (.*)$/u,
      (m) =>
        'Core 拒绝了' +
        ({ add: '添加任务', cancel: '取消任务', retry: '重试任务' }[m[1] ?? ''] ?? '操作') +
        '（' +
        m[2] +
        '）：' +
        m[3],
    ],
    [
      /^the (add|cancel|retry) was not routed: (.*)$/u,
      (m) => {
        const action =
          { add: '添加任务', cancel: '取消任务', retry: '重试任务' }[m[1] ?? ''] ?? '操作';
        const detail = m[2] === 'refused' ? 'Core 未确认受理' : m[2];
        return action + '未提交：' + detail;
      },
    ],
  ];
  for (const [pattern, translate] of patterns) {
    const match = text.match(pattern);
    if (match !== null) return translate(match);
  }
  return text;
}

function renderFormFields(): void {
  const descriptor = getFormDescriptor('url-preview');
  if (
    descriptor === null ||
    descriptor.schemaVersion !== 1 ||
    !descriptor.requiresCoreConfirmation
  ) {
    throw new Error('unsupported local form descriptor');
  }
  const host = byId('form-fields');
  host.textContent = '';
  for (const field of descriptor.fields) {
    const group = document.createElement('div');
    group.className = 'field-stack';
    const label = document.createElement('label');
    label.htmlFor = field.id;
    label.textContent = field.label;
    const input = document.createElement('input');
    input.id = field.id;
    input.name = field.id;
    input.type = field.kind;
    input.required = field.required;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = field.placeholder;
    input.addEventListener('input', () => input.setCustomValidity(''));
    const hint = document.createElement('small');
    hint.textContent = field.help;
    group.append(label, input, hint);
    host.appendChild(group);
  }
}

function openAdd(): void {
  addOpen = true;
  render();
  (byId('url') as HTMLInputElement).focus();
}

function closeAdd(): void {
  if (state.busy || state.pendingPreview !== null) return;
  addOpen = false;
  render();
  byId('new-download').focus();
}

/** Keep keyboard focus inside a visible permission/confirmation dialog. */
function trapDialogTab(event: KeyboardEvent, root: HTMLElement): void {
  if (event.key !== 'Tab') return;
  const controls = [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled])',
    ),
  ].filter((element) => !element.hasAttribute('hidden'));
  if (controls.length === 0) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !root.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function renderDetails(): void {
  const panel = byId('job-details');
  const current = state.jobs.find((row) => row.lineageId === selectedLineage);
  if (current === undefined) {
    selectedLineage = null;
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  byId('details-title').textContent = taskLabel(current);
  byId('details-status').textContent = statusLabel(current);
  byId('details-progress').textContent = progressSummary(current);
  byId('details-destination').textContent = DESTINATION_LABEL;
  byId('details-lineage').textContent = current.lineageId;
  byId('details-revision').textContent = String(current.revision);
  byId('details-reason').textContent = current.terminal?.stopReason ?? '暂无';
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`renderer markup is missing #${id}`);
  }
  return element;
}

function render(): void {
  const loading = byId('loading');
  const app = byId('app');
  const bridgeMissingBox = byId('bridge-missing');
  if (state.phase === 'bridge-missing') {
    loading.hidden = true;
    app.hidden = true;
    bridgeMissingBox.hidden = false;
    return;
  }
  bridgeMissingBox.hidden = true;
  loading.hidden = state.phase !== 'loading';
  app.hidden = state.phase === 'loading';

  const notice = byId('notice');
  notice.textContent = state.notice === null ? '' : localizeNotice(state.notice.text);
  notice.dataset.kind = state.notice === null ? 'none' : state.notice.kind;

  // U05-T03: the truncation banner states plainly that the visible page is
  // not the complete history — words come only from the Core index counters.
  const truncation = byId('truncation-notice');
  const truncationText = truncationNoticeText({
    truncated: state.truncated,
    totalCount: state.totalCount,
    visibleCount: state.jobs.length,
  });
  truncation.textContent = truncationText ?? '';
  truncation.hidden = truncationText === null;

  const connectionLine = byId('connection-line');
  const connected = state.connection === 'CONNECTED';
  connectionLine.textContent = connected
    ? 'Core 已连接'
    : state.connection === null
      ? // R3-02: a ready page that never achieved a successful Core index
        // read (first-load unconfigured/refused) shows the disconnected
        // state — never an implied "connecting" or an empty task list.
        state.phase === 'ready'
        ? 'Core 未连接（无权威任务列表）'
        : '正在连接 Core…'
      : 'Core 状态：' + state.connection;
  connectionLine.dataset.status = connected ? 'connected' : 'disconnected';
  byId('add-dialog').hidden = !addOpen || state.pendingPreview !== null;

  const addSubmit = byId('add-submit') as HTMLButtonElement;
  addSubmit.disabled = state.busy || state.pendingPreview !== null;

  const urlInput = byId('url') as HTMLInputElement;
  urlInput.disabled = state.busy || state.pendingPreview !== null;

  renderPreview();
  renderJobs();
}

function renderPreview(): void {
  const preview = byId('preview');
  const pending = state.pendingPreview;
  if (pending === null) {
    preview.hidden = true;
    preview.dataset.open = 'false';
    return;
  }
  const wasClosed = preview.hidden || preview.dataset.open !== 'true';
  preview.hidden = false;
  preview.dataset.open = 'true';
  byId('preview-url').textContent = pending.url;
  byId('preview-destination').textContent = DESTINATION_LABEL;
  const requests = byId('preview-requests');
  requests.textContent = '';
  for (const request of pending.confirmationRequests) {
    const item = document.createElement('li');
    const description = document.createElement('span');
    description.textContent = `${request.level}: ${request.description}`;
    const proves = document.createElement('em');
    proves.textContent = ` — proves ${request.proves}`;
    item.appendChild(description);
    item.appendChild(proves);
    requests.appendChild(item);
  }
  const confirm = byId('preview-confirm') as HTMLButtonElement;
  const discard = byId('preview-discard') as HTMLButtonElement;
  confirm.disabled = state.busy;
  discard.disabled = state.busy;
  if (wasClosed) {
    confirm.focus();
  }
}

function renderJobs(): void {
  const rows = state.jobs;
  const allCount = rows.length;
  const activeCount = rows.filter(isActive).length;
  const completeCount = rows.filter(verifiedComplete).length;
  const failedCount = rows.filter(isFailed).length;
  for (const [id, count] of [
    ['count-all', allCount],
    ['count-active', activeCount],
    ['count-complete', completeCount],
    ['count-failed', failedCount],
    ['summary-all', allCount],
    ['summary-active', activeCount],
    ['summary-complete', completeCount],
  ] as const) {
    byId(id).textContent = String(count);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('.nav-item[data-filter]')) {
    const selected = button.dataset.filter === taskFilter;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  const matching = rows.filter((row) => {
    if (taskFilter === 'active' && !isActive(row)) return false;
    if (taskFilter === 'complete' && !verifiedComplete(row)) return false;
    if (taskFilter === 'failed' && !isFailed(row)) return false;
    const query = searchTerm.toLocaleLowerCase();
    return (
      query === '' ||
      [taskLabel(row), statusLabel(row), row.terminal?.stopReason ?? ''].some((field) =>
        field.toLocaleLowerCase().includes(query),
      )
    );
  });
  const empty = byId('empty-state');
  const filterEmpty = byId('filter-empty');
  const table = byId('jobs-table');
  const body = byId('jobs-body');
  body.textContent = '';
  // R3-02: "no tasks here" is truthful ONLY after a successful CONNECTED
  // Core index read returned zero rows. An unconfigured/refused Core (or a
  // not-yet-successful first load) shows the connection/error state instead.
  empty.hidden = !(state.connection === 'CONNECTED' && allCount === 0);
  filterEmpty.hidden = allCount === 0 || matching.length !== 0;
  table.hidden = matching.length === 0;
  for (const row of matching) body.appendChild(jobRowElement(row));
  renderDetails();
}

function jobRowElement(row: ManagerJobRowDocument): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const lineage = document.createElement('th');
  lineage.scope = 'row';
  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'link-button';
  title.textContent = taskLabel(row);
  title.setAttribute('aria-label', '查看' + taskLabel(row) + '详情');
  title.addEventListener('click', () => {
    // Reopen: the row's facts are re-read from the Core on the next
    // managerRefresh (the index replays the durable journal per query); the
    // detail panel renders the freshest listed projection of this aggregate.
    selectedLineage = row.lineageId;
    renderDetails();
    void refresh();
  });
  lineage.append(title);
  tr.appendChild(lineage);

  const status = document.createElement('td');
  const tag = document.createElement('span');
  tag.className =
    'status-tag ' + (verifiedComplete(row) ? 'complete' : isFailed(row) ? 'failed' : '');
  tag.textContent = statusLabel(row);
  tag.title = 'Core 原始状态：' + jobStatusText(row);
  status.appendChild(tag);
  tr.appendChild(status);

  const progress = document.createElement('td');
  // “已验证完成” claims measured coverage evidence; NOT_APPLICABLE rows are
  // completed without it, so they keep the honest coverage detail text.
  progress.textContent =
    verifiedComplete(row) && row.terminal !== null && row.terminal.coverage === 'VERIFIED_COMPLETE'
      ? '已验证完成'
      : progressSummary(row);
  tr.appendChild(progress);

  const destination = document.createElement('td');
  destination.textContent = DESTINATION_LABEL;
  tr.appendChild(destination);

  const actions = document.createElement('td');
  const group = document.createElement('div');
  group.className = 'row-actions';
  const availability = jobActions(row);
  group.append(
    actionButton(
      '取消',
      row.lineageId,
      availability.cancelEnabled,
      () => void runControl('cancel', row.lineageId),
    ),
    actionButton(
      '重试',
      row.lineageId,
      availability.retryEnabled,
      () => void runControl('retry', row.lineageId),
    ),
  );
  actions.appendChild(group);
  tr.appendChild(actions);
  return tr;
}

function actionButton(
  label: string,
  lineageId: string,
  enabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.lineage = lineageId;
  button.disabled = !enabled || state.busy;
  if (!enabled) button.title = 'Core 当前未证明此操作可用';
  button.addEventListener('click', onClick);
  return button;
}

// ---- bridge calls (allowlisted methods only) ------------------------------

async function refresh(): Promise<void> {
  if (BRIDGE === undefined || BRIDGE === null || typeof BRIDGE.managerRefresh !== 'function') {
    state = bridgeMissing(state);
    render();
    return;
  }
  const answer = await BRIDGE.managerRefresh();
  state = applyList(state, answer);
  render();
}

async function runControl(action: 'cancel' | 'retry', lineageId: string): Promise<void> {
  if (BRIDGE === undefined || BRIDGE === null) {
    return;
  }
  state = setBusy(state, true);
  render();
  const answer =
    action === 'cancel'
      ? await BRIDGE.managerCancelJob({ lineageId })
      : await BRIDGE.managerRetryJob({ lineageId });
  state = applyAction(state, answer);
  render();
}

async function submitPreview(event: Event): Promise<void> {
  event.preventDefault();
  if (BRIDGE === undefined || BRIDGE === null) {
    state = bridgeMissing(state);
    render();
    return;
  }
  const input = byId('url') as HTMLInputElement;
  const url = input.value;
  const checked = validatePreviewUrl(url);
  if (!checked.ok) {
    input.setCustomValidity(checked.reason ?? '链接格式无效');
    input.reportValidity();
    return;
  }
  input.setCustomValidity('');
  state = setBusy(state, true);
  render();
  const answer = await BRIDGE.managerPreviewAdd({ url });
  state = previewOpened(state, answer);
  render();
}

async function confirmPreview(): Promise<void> {
  if (BRIDGE === undefined || BRIDGE === null) {
    return;
  }
  state = setBusy(state, true);
  render();
  const pending = state.pendingPreview;
  const answer = await BRIDGE.managerConfirmAdd();
  if (
    pending !== null &&
    answer.ok === true &&
    answer.document === 'xdownload.desktop.manager.action' &&
    answer.action === 'add' &&
    answer.routed &&
    answer.lineageId !== null
  ) {
    taskDisplayNames.set(answer.lineageId, taskLabelFromUrl(pending.url));
  }
  state = applyAction(state, answer);
  if (state.pendingPreview === null) addOpen = false;
  render();
  const input = byId('url') as HTMLInputElement;
  input.value = '';
  if (addOpen) input.focus();
  else byId('new-download').focus();
}

async function discardPreview(): Promise<void> {
  if (BRIDGE === undefined || BRIDGE === null) {
    return;
  }
  state = setBusy(state, true);
  render();
  const answer = await BRIDGE.managerDiscardPreview();
  state = applyAction(state, answer);
  render();
  const input = byId('url') as HTMLInputElement;
  input.focus();
}

// ---- wiring -----------------------------------------------------------------

function wire(): void {
  renderFormFields();
  if (BRIDGE === undefined || BRIDGE === null) {
    state = bridgeMissing(state);
    render();
    return;
  }
  byId('new-download').addEventListener('click', openAdd);
  byId('empty-add').addEventListener('click', openAdd);
  byId('add-close').addEventListener('click', closeAdd);
  byId('add-cancel').addEventListener('click', closeAdd);
  byId('details-close').addEventListener('click', () => {
    selectedLineage = null;
    renderDetails();
  });
  byId('job-search').addEventListener('input', () => {
    searchTerm = (byId('job-search') as HTMLInputElement).value.trim();
    renderJobs();
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('.nav-item[data-filter]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.filter;
      if (next === 'all' || next === 'active' || next === 'complete' || next === 'failed') {
        taskFilter = next;
        renderJobs();
      }
    });
  }
  byId('add-dialog').addEventListener('keydown', (event) => {
    trapDialogTab(event as KeyboardEvent, byId('add-dialog'));
    if ((event as KeyboardEvent).key === 'Escape' && !state.busy) {
      event.preventDefault();
      closeAdd();
    }
  });
  byId('add-form').addEventListener('submit', (event) => void submitPreview(event));
  byId('preview-confirm').addEventListener('click', () => void confirmPreview());
  byId('preview-discard').addEventListener('click', () => void discardPreview());
  byId('preview').addEventListener('keydown', (event) => {
    trapDialogTab(event as KeyboardEvent, byId('preview'));
    if ((event as KeyboardEvent).key === 'Escape') {
      event.preventDefault();
      void discardPreview();
    }
  });
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && !state.busy) {
      void refresh();
    }
  }, REFRESH_INTERVAL_MS);
  void refresh();
}

function teardown(): void {
  if (refreshTimer !== 0) {
    window.clearInterval(refreshTimer);
    refreshTimer = 0;
  }
}

window.addEventListener('beforeunload', teardown);

wire();
