/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * T08 download-manager renderer page binding — the thin DOM layer over the
 * pure state machine (`manager-state.ts`).
 *
 * Security discipline (pinned by the static security-invariant tests):
 * - The ONLY privileged surface is the typed preload bridge
 *   (`window.xdownloadShell`, frozen allowlist). No network API, no dynamic
 *   import, no eval, no inline handlers, no HTML-injection API: every text
 *   node is written with `textContent`, every listener with
 *   `addEventListener`.
 * - The page never derives status: it renders the shell's verbatim Core
 *   projection documents and re-polls the allowlisted refresh channel.
 *
 * Accessibility: the add flow is fully keyboard-operable (Enter submits the
 * form, Escape discards the preview dialog, all actions are native buttons);
 * state changes are announced through an aria-live region; empty, loading
 * and error states are first-class.
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
  noticeShown,
  previewOpened,
  setBusy,
  type ManagerRendererState,
} from './manager-state.ts';

const BRIDGE = window.xdownloadShell;
const REFRESH_INTERVAL_MS = 2000;

let state: ManagerRendererState = initialManagerState();
let chosenDestination: string | null = null;
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
    row.present &&
    terminal !== null &&
    terminal.targetResolution === 'RESOLVED' &&
    terminal.selectionAcquisition === 'ACQUIRED' &&
    terminal.coverage === 'VERIFIED_COMPLETE' &&
    terminal.requestFulfillment === 'COMPLETE' &&
    terminal.validationSummary.status === 'ALL_PASSED'
  );
}

function isActive(row: ManagerJobRowDocument): boolean {
  return row.present && row.terminal === null;
}

function isFailed(row: ManagerJobRowDocument): boolean {
  return row.present && row.terminal !== null && !verifiedComplete(row);
}

function statusLabel(row: ManagerJobRowDocument): string {
  if (!row.present) return '状态未知';
  if (verifiedComplete(row)) return '已完成';
  if (isFailed(row)) return '已结束 · 未完成';
  if (isActive(row)) return '已提交 · 未结束';
  return '等待 Core 状态';
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
  if (!row.present) return 'Core 尚未返回可验证的任务状态';
  if (row.terminal === null) {
    return row.selectedMemberCount === null
      ? '尚未获得终态 · 暂无可靠字节进度'
      : 'Core 已记录 ' + row.selectedMemberCount + ' 个目标 · 尚未获得终态 · 暂无可靠字节进度';
  }
  const validation = row.terminal.validationSummary;
  const validationLabel =
    validation.status === 'ALL_PASSED'
      ? '全部通过'
      : validation.status === 'NONE_PASSED'
        ? '全部未通过'
        : validation.status;
  const coverageLabel =
    row.terminal.coverage === 'VERIFIED_COMPLETE' ? '范围已验证完成' : row.terminal.coverage;
  return '覆盖：' + coverageLabel + ' · 校验：' + validationLabel +
    '（通过 ' + validation.passedCount + ' 项，失败 ' + validation.failedCount + ' 项）';
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
        '（' + m[2] + '）：' + m[3],
    ],
    [
      /^the (add|cancel|retry) was not routed: (.*)$/u,
      (m) =>
        ({ add: '添加任务', cancel: '取消任务', retry: '重试任务' }[m[1] ?? ''] ?? '操作') +
        '未提交：' + m[2],
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
    label.textContent = field.label;
    if (field.kind === 'url') {
      label.htmlFor = field.id;
      const input = document.createElement('input');
      input.id = 'url';
      input.name = field.id;
      input.type = 'url';
      input.required = field.required;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = field.placeholder;
      input.addEventListener('input', () => input.setCustomValidity(''));
      const hint = document.createElement('small');
      hint.textContent = field.help;
      group.append(label, input, hint);
    } else if (field.kind === 'directory-choice') {
      label.htmlFor = 'choose-destination';
      const picker = document.createElement('div');
      picker.className = 'folder-picker';
      const destination = document.createElement('span');
      destination.id = 'destination-label';
      destination.textContent = '未指定保存目录';
      const browse = document.createElement('button');
      browse.id = 'choose-destination';
      browse.type = 'button';
      browse.className = 'button subtle';
      browse.textContent = '浏览…';
      picker.append(destination, browse);
      const hint = document.createElement('small');
      hint.textContent = field.help;
      group.append(label, picker, hint);
    }
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
  byId('details-destination').textContent = current.destination ?? '未指定';
  byId('details-lineage').textContent = current.lineageId;
  byId('details-revision').textContent =
    current.revision === null ? '未知' : String(current.revision);
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

  const connectionLine = byId('connection-line');
  const connected = state.connection === 'CONNECTED';
  connectionLine.textContent = connected
    ? 'Core 已连接'
    : state.connection === null
      ? '正在连接 Core…'
      : 'Core 状态：' + state.connection;
  connectionLine.dataset.status = connected ? 'connected' : 'disconnected';
  byId('add-dialog').hidden = !addOpen || state.pendingPreview !== null;

  const destinationLabel = byId('destination-label');
  destinationLabel.textContent = chosenDestination === null ? '未指定保存目录' : chosenDestination;
  const addSubmit = byId('add-submit') as HTMLButtonElement;
  const chooseDestination = byId('choose-destination') as HTMLButtonElement;
  addSubmit.disabled = state.busy || state.pendingPreview !== null;
  chooseDestination.disabled = state.busy;

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
  byId('preview-destination').textContent =
    pending.destination === null ? '未指定保存目录' : pending.destination;
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
      [taskLabel(row), row.destination ?? '', statusLabel(row), row.terminal?.stopReason ?? ''].some(
        (field) => field.toLocaleLowerCase().includes(query),
      )
    );
  });
  const empty = byId('empty-state');
  const filterEmpty = byId('filter-empty');
  const table = byId('jobs-table');
  const body = byId('jobs-body');
  body.textContent = '';
  empty.hidden = allCount !== 0;
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
    selectedLineage = row.lineageId;
    renderDetails();
  });
  lineage.append(title);
  tr.appendChild(lineage);

  const status = document.createElement('td');
  const tag = document.createElement('span');
  tag.className =
    'status-tag ' +
    (verifiedComplete(row) ? 'complete' : isFailed(row) ? 'failed' : !row.present ? 'unknown' : '');
  tag.textContent = statusLabel(row);
  tag.title = 'Core 原始状态：' + jobStatusText(row);
  status.appendChild(tag);
  tr.appendChild(status);

  const progress = document.createElement('td');
  progress.textContent = verifiedComplete(row) ? '已验证完成' : progressSummary(row);
  tr.appendChild(progress);

  const destination = document.createElement('td');
  destination.textContent = row.destination === null ? '未指定' : row.destination;
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
    actionButton(
      '打开目录',
      row.lineageId,
      availability.revealEnabled && verifiedComplete(row),
      () => void runReveal(row.lineageId),
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

async function runReveal(lineageId: string): Promise<void> {
  if (BRIDGE === undefined || BRIDGE === null) {
    return;
  }
  state = setBusy(state, true);
  render();
  const answer = await BRIDGE.managerRevealJob({ lineageId });
  if (answer.ok === false) {
    state = noticeShown(state, { kind: 'error', text: `打开保存目录失败：${answer.detail}` });
  } else if (answer.document !== 'xdownload.desktop.manager.reveal') {
    state = noticeShown(state, { kind: 'error', text: '打开保存目录失败：Core 返回了无法识别的结果' });
  } else {
    state = noticeShown(state, {
      kind: 'info',
      text: '已打开任务的保存目录',
    });
  }
  state = setBusy(state, false);
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
  const answer =
    chosenDestination === null
      ? await BRIDGE.managerPreviewAdd({ url })
      : await BRIDGE.managerPreviewAdd({ url, destination: chosenDestination });
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

async function chooseDestination(): Promise<void> {
  if (BRIDGE === undefined || BRIDGE === null) {
    return;
  }
  state = setBusy(state, true);
  render();
  const answer = await BRIDGE.managerChooseDestination();
  if (answer.ok === false) {
    state = noticeShown(state, {
      kind: 'error',
      text: `选择保存目录失败：${answer.detail}`,
    });
  } else if (answer.document !== 'xdownload.desktop.manager.destination') {
    state = noticeShown(state, {
      kind: 'error',
      text: '选择保存目录失败：Core 返回了无法识别的结果',
    });
  } else if (answer.destination === null) {
    state = noticeShown(state, { kind: 'info', text: '未选择保存目录' });
  } else {
    chosenDestination = answer.destination;
    state = noticeShown(state, {
      kind: 'info',
      text: `保存目录：${answer.destination}`,
    });
  }
  state = setBusy(state, false);
  render();
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
  byId('choose-destination').addEventListener('click', () => void chooseDestination());
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
