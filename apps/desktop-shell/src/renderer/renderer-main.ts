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
/** F-4/#387: whether the details panel is currently shown. */
let detailsOpen = false;
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

/**
 * F-5/#388: the row display label carries a privacy-preserving sequence
 * ordinal (the row's position in the Core's durable-index enumeration,
 * replayed in submission order on every fresh read), so every row — including
 * same-host tasks and historical rows after an app restart, for which no
 * origin URL is held — is visibly and accessibly unique. The observed origin
 * segment is appended only for tasks submitted through this renderer session;
 * no URL path, query, credential or raw lineage id is ever shown.
 */
function taskLabel(row: ManagerJobRowDocument): string {
  const position = state.jobs.findIndex((item) => item.lineageId === row.lineageId) + 1;
  const sequence = position > 0 ? `任务 ${String(position)}` : '下载任务';
  const origin = taskDisplayNames.get(row.lineageId);
  return origin === undefined ? sequence : `${sequence} · ${origin}`;
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
  const pending = state.pendingCommand;
  if (pending !== null) {
    if (pending.status !== 'UNKNOWN' || pending.aggregateId === null) return;
    if (pending.commandType === 'EXECUTE_S1_DIRECT_ACQUISITION') {
      // The contract was already accepted; this existing Add entry point
      // explicitly reconciles the exact retained S1 envelope.
      void confirmPreview();
    } else if (pending.commandType === 'CANCEL_LINEAGE') {
      void runControl('cancel', pending.aggregateId);
    } else if (pending.commandType === 'RETRY_FAILED_MEMBERS') {
      void runControl('retry', pending.aggregateId);
    }
    return;
  }
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
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), summary',
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

/** F-4/#387: whether the details panel is presented as a modal dialog right now. */
let detailsModal = false;
/** F-4/#387: the row control that invoked the details panel (focus restore target). */
let detailsInvoker: HTMLElement | null = null;
/**
 * F-4/#387: the invoking row's lineage id. Refreshes re-create the row
 * controls on every read, so restore resolves the CURRENT control for the
 * same aggregate rather than trusting a possibly-detached element reference.
 */
let detailsInvokerLineage: string | null = null;
/**
 * F-4/#387: at viewport widths where the details panel overlays the
 * workspace (the ≤1050px fixed-overlay rule) it is presented as a genuine
 * modal dialog; where it is a non-overlapping side panel it keeps plain
 * disclosure semantics. Feature-guarded so the Node fake-DOM unit tests
 * (no matchMedia) deterministically take the non-modal path.
 */
const OVERLAY_QUERY = '(max-width: 1050px)';

function isOverlayViewport(): boolean {
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(OVERLAY_QUERY).matches;
}

/**
 * F-4/#387: apply or drop the modal dialog semantics of the details panel.
 * In the modal presentation the panel exposes role=dialog + aria-modal=true
 * (named by details-title) and every covered background area becomes inert —
 * unfocusable and unavailable to assistive technology.
 */
function applyDetailsModality(panel: HTMLElement, overlay: boolean): void {
  if (overlay === detailsModal) return;
  detailsModal = overlay;
  if (overlay) {
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
  } else {
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
  }
  for (const id of ['nav-sidebar', 'workspace-main']) {
    const area = document.getElementById(id);
    if (area === null) continue;
    if (overlay) area.setAttribute('inert', '');
    else area.removeAttribute('inert');
  }
}

/** F-4/#387: on close, restore focus to the invoking row control, else to the task search. */
function restoreDetailsInvokerFocus(): void {
  const lineage = detailsInvokerLineage;
  detailsInvokerLineage = null;
  const invoker = detailsInvoker;
  detailsInvoker = null;
  if (lineage !== null && typeof document.querySelector === 'function') {
    const current = document.querySelector(
      `#jobs-body button.link-button[data-lineage="${CSS.escape(lineage)}"]`,
    );
    if (current !== null) {
      (current as HTMLElement).focus();
      return;
    }
  }
  if (invoker !== null && typeof document.contains === 'function' && document.contains(invoker)) {
    invoker.focus();
    return;
  }
  byId('job-search').focus();
}

function closeDetails(): void {
  selectedLineage = null;
  renderDetails();
}

function renderDetails(): void {
  const panel = byId('job-details');
  const stale = state.snapshotFreshness === 'stale';
  const current = state.jobs.find((row) => row.lineageId === selectedLineage);
  if (current === undefined) {
    const wasOpen = detailsOpen;
    selectedLineage = null;
    detailsOpen = false;
    panel.hidden = true;
    applyDetailsModality(panel, false);
    if (wasOpen) restoreDetailsInvokerFocus();
    return;
  }
  const wasOpen = detailsOpen;
  const overlay = isOverlayViewport();
  panel.hidden = false;
  detailsOpen = true;
  applyDetailsModality(panel, overlay);
  byId('details-title').textContent = taskLabel(current);
  byId('details-status').textContent = stale
    ? `上次成功读取：${statusLabel(current)}`
    : statusLabel(current);
  byId('details-progress').textContent = stale
    ? `上次成功读取：${progressSummary(current)}`
    : progressSummary(current);
  byId('details-destination').textContent = DESTINATION_LABEL;
  byId('details-lineage').textContent = current.lineageId;
  byId('details-revision').textContent = stale
    ? `上次成功读取：${String(current.revision)}`
    : String(current.revision);
  const reason = current.terminal?.stopReason ?? '暂无';
  byId('details-reason').textContent = stale ? `上次成功读取：${reason}` : reason;
  // F-4/#387: on open in the modal presentation, move focus into the dialog
  // (the named dialog element itself). Re-renders of an already-open panel
  // never steal focus.
  if (!wasOpen && detailsModal) {
    panel.focus();
  }
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
  const stale = state.snapshotFreshness === 'stale';
  notice.dataset.kind = state.notice === null ? 'none' : state.notice.kind;

  // U05-T03: the truncation banner states plainly that the visible page is
  // not the complete history — words come only from the Core index counters.
  const truncation = byId('truncation-notice');
  const truncationText = truncationNoticeText({
    truncated: state.truncated,
    totalCount: state.totalCount,
    visibleCount: state.jobs.length,
  });
  truncation.textContent =
    truncationText === null ? '' : stale ? `上次成功读取：${truncationText}` : truncationText;
  truncation.hidden = truncationText === null;

  const connectionLine = byId('connection-line');
  const connected = state.snapshotFreshness === 'fresh' && state.connection === 'CONNECTED';
  connectionLine.textContent = stale
    ? 'Core 状态未确认 · 以下为上次成功读取的数据（已过期）'
    : connected
      ? 'Core 已连接'
      : state.connection === null
        ? state.phase === 'ready'
          ? 'Core 未连接（尚无权威任务列表）'
          : '正在连接 Core…'
        : 'Core 状态：' + state.connection;
  connectionLine.dataset.status = connected ? 'connected' : stale ? 'stale' : 'disconnected';

  const pendingCommand = state.pendingCommand;
  const newDownload = byId('new-download') as HTMLButtonElement;
  const emptyAdd = byId('empty-add') as HTMLButtonElement;
  const canReconcileFromToolbar =
    pendingCommand?.status === 'UNKNOWN' &&
    pendingCommand.aggregateId !== null &&
    (pendingCommand.commandType === 'EXECUTE_S1_DIRECT_ACQUISITION' ||
      pendingCommand.commandType === 'CANCEL_LINEAGE' ||
      pendingCommand.commandType === 'RETRY_FAILED_MEMBERS');
  newDownload.textContent = canReconcileFromToolbar ? '核对待处理命令' : '新建下载';
  newDownload.disabled = state.busy || (pendingCommand !== null && !canReconcileFromToolbar);
  emptyAdd.disabled = state.busy || pendingCommand !== null;

  byId('add-dialog').hidden = !addOpen || state.pendingPreview !== null;

  const addSubmit = byId('add-submit') as HTMLButtonElement;
  addSubmit.disabled = state.busy || state.pendingPreview !== null || pendingCommand !== null;

  const urlInput = byId('url') as HTMLInputElement;
  urlInput.disabled = state.busy || state.pendingPreview !== null || pendingCommand !== null;

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
  const reconcilingContract =
    state.pendingCommand?.status === 'UNKNOWN' &&
    state.pendingCommand.commandType === 'SUBMIT_CONTRACT';
  confirm.textContent = reconcilingContract ? '核对提交' : '确认并开始';
  confirm.disabled = state.busy || (state.pendingCommand !== null && !reconcilingContract);
  discard.disabled = state.busy || state.pendingCommand !== null;
  if (wasClosed) {
    confirm.focus();
  }
}

function renderJobs(): void {
  // F-4/#387 keyboard stability: capture the focused row control BEFORE the
  // rebuild below detaches it (capture must precede body.textContent = '').
  // Structural checks only: the Node fake-DOM unit tests define neither
  // HTMLElement nor a body/activeElement pair.
  const activeBeforeRender: Element | null = document.activeElement;
  const activeDataset =
    activeBeforeRender !== null && 'dataset' in activeBeforeRender
      ? (activeBeforeRender as HTMLElement).dataset
      : undefined;
  const activeLineage = activeDataset?.lineage ?? null;
  const activeLabel =
    activeLineage === null || activeBeforeRender === null
      ? null
      : typeof activeBeforeRender.textContent === 'string'
        ? activeBeforeRender.textContent
        : null;
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
    byId(id).textContent =
      state.snapshotFreshness === 'stale'
        ? `上次 ${String(count)}`
        : state.snapshotFreshness === 'unavailable'
          ? '—'
          : String(count);
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
  empty.hidden = !(
    state.snapshotFreshness === 'fresh' &&
    state.connection === 'CONNECTED' &&
    allCount === 0
  );
  filterEmpty.hidden = allCount === 0 || matching.length !== 0;
  table.hidden = matching.length === 0;
  // F-4/#387 keyboard stability: every read re-creates the row controls, and
  // without this re-bind a refresh silently drops keyboard focus to <body>
  // while the user is on a row. Re-focus the same aggregate's control (same
  // label) in the fresh DOM; presentation elsewhere is unchanged. The fake
  // DOM of the Node unit tests has no body/activeElement — guarded, no-op.
  for (const row of matching) body.appendChild(jobRowElement(row));
  if (
    activeLineage !== null &&
    typeof document.querySelector === 'function' &&
    document.activeElement === document.body
  ) {
    const candidates = document.querySelectorAll(
      `#jobs-body button[data-lineage="${CSS.escape(activeLineage)}"]`,
    );
    const replacement =
      Array.from(candidates).find((element) => element.textContent === activeLabel) ??
      candidates[0];
    if (replacement !== undefined && replacement !== null) {
      (replacement as HTMLElement).focus();
    }
  }
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
  title.dataset.lineage = row.lineageId;
  title.addEventListener('click', () => {
    // Reopen: the row's facts are re-read from the Core on the next
    // managerRefresh (the index replays the durable journal per query); the
    // detail panel renders the freshest listed projection of this aggregate.
    selectedLineage = row.lineageId;
    detailsInvoker = title;
    detailsInvokerLineage = row.lineageId;
    renderDetails();
    void refresh();
  });
  lineage.append(title);
  tr.appendChild(lineage);

  const status = document.createElement('td');
  const tag = document.createElement('span');
  const stale = state.snapshotFreshness === 'stale';
  tag.className = stale
    ? 'status-tag stale'
    : 'status-tag ' + (verifiedComplete(row) ? 'complete' : isFailed(row) ? 'failed' : '');
  tag.textContent = stale ? `上次成功读取：${statusLabel(row)}` : statusLabel(row);
  tag.title = stale
    ? `上次成功读取时的 Core 原始状态：${jobStatusText(row)}；当前状态未确认`
    : 'Core 原始状态：' + jobStatusText(row);
  status.appendChild(tag);
  tr.appendChild(status);

  const progress = document.createElement('td');
  // “已验证完成” claims measured coverage evidence; NOT_APPLICABLE rows are
  // completed without it, so they keep the honest coverage detail text.
  const progressText =
    verifiedComplete(row) && row.terminal !== null && row.terminal.coverage === 'VERIFIED_COMPLETE'
      ? '已验证完成'
      : progressSummary(row);
  progress.textContent = stale ? `上次成功读取：${progressText}` : progressText;
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
      'CANCEL_LINEAGE',
      row.lineageId,
      availability.cancelEnabled,
      () => void runControl('cancel', row.lineageId),
    ),
    actionButton(
      '重试',
      'RETRY_FAILED_MEMBERS',
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
  commandType: 'CANCEL_LINEAGE' | 'RETRY_FAILED_MEMBERS',
  lineageId: string,
  enabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.lineage = lineageId;
  const pending = state.pendingCommand;
  const reconciling =
    pending?.status === 'UNKNOWN' &&
    pending.commandType === commandType &&
    pending.aggregateId === lineageId;
  const blockedByPending = pending !== null && !reconciling;
  const snapshotUnavailable = state.snapshotFreshness !== 'fresh';
  button.textContent = reconciling ? `核对${label}` : label;
  button.disabled =
    state.busy || blockedByPending || (!reconciling && (!enabled || snapshotUnavailable));
  if (reconciling && pending !== null) {
    button.title = `使用同一 requestId 核对 ${pending.requestId}；不会创建新的控制命令`;
  } else if (blockedByPending) {
    button.title = '另一个命令尚未获得 Core 确认；请先核对该命令';
  } else if (snapshotUnavailable) {
    button.title = 'Core 当前状态未确认；刷新成功后才能操作';
  } else if (!enabled) {
    button.title = 'Core 当前未证明此操作可用';
  }
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
  const pending = state.pendingCommand;
  const expected = action === 'cancel' ? 'CANCEL_LINEAGE' : 'RETRY_FAILED_MEMBERS';
  if (
    pending !== null &&
    !(
      pending.status === 'UNKNOWN' &&
      pending.commandType === expected &&
      pending.aggregateId === lineageId
    )
  ) {
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
  if (state.pendingCommand !== null) return;
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
    answer.previewConsumed &&
    answer.lineageId !== null
  ) {
    // F-5/#388: store the observed origin only when it parses; rows without
    // one stay uniquely labeled through their sequence ordinal alone.
    const origin = taskLabelFromUrl(pending.url);
    if (origin !== '下载任务') taskDisplayNames.set(answer.lineageId, origin);
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
    closeDetails();
  });
  // F-4/#387: while the details panel is modal, keyboard focus stays inside
  // it and Escape closes it. In the non-modal side-panel presentation the
  // existing disclosure behavior is preserved.
  byId('job-details').addEventListener('keydown', (event) => {
    const keyboard = event as KeyboardEvent;
    if (!detailsModal) return;
    trapDialogTab(keyboard, byId('job-details'));
    if (keyboard.key === 'Escape') {
      event.preventDefault();
      closeDetails();
    }
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
  // F-4/#387: keep the details-panel modality honest across window resizes
  // (overlay ⇄ non-overlapping side panel) while it is open.
  window.addEventListener('resize', () => {
    if (!detailsOpen) return;
    applyDetailsModality(byId('job-details'), isOverlayViewport());
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
