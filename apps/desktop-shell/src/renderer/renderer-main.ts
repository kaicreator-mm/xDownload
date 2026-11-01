/// <reference lib="dom" />
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
  jobProgressText,
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

function verifiedComplete(row: ManagerJobRowDocument): boolean {
  return row.present && row.terminal?.requestFulfillment === 'COMPLETE' &&
    row.terminal.validationSummary.status === 'ALL_PASSED';
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
  if (isActive(row)) return '已提交 · 处理中';
  return '等待 Core 状态';
}

function renderFormFields(): void {
  const descriptor = getFormDescriptor('url-preview');
  if (descriptor === null || descriptor.schemaVersion !== 1 || !descriptor.requiresCoreConfirmation) {
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

function renderDetails(): void {
  const panel = byId('job-details');
  const current = state.jobs.find((row) => row.lineageId === selectedLineage);
  if (current === undefined) {
    selectedLineage = null;
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  byId('details-status').textContent = statusLabel(current);
  byId('details-progress').textContent = jobProgressText(current);
  byId('details-destination').textContent = current.destination ?? '未指定';
  byId('details-lineage').textContent = current.lineageId;
  byId('details-revision').textContent = current.revision === null ? '未知' : String(current.revision);
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
  notice.textContent = state.notice === null ? '' : state.notice.text;
  notice.dataset.kind = state.notice === null ? 'none' : state.notice.kind;

  const connectionLine = byId('connection-line');
  const connected = state.connection === 'CONNECTED';
  connectionLine.textContent = connected ? 'Core 已连接' :
    state.connection === null ? '正在连接 Core…' : 'Core 状态：' + state.connection;
  connectionLine.dataset.status = connected ? 'connected' : 'disconnected';
  byId('add-dialog').hidden = !addOpen || state.pendingPreview !== null;

  const destinationLabel = byId('destination-label');
  destinationLabel.textContent =
    chosenDestination === null ? '未指定保存目录' : chosenDestination;
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
    pending.destination === null ? 'no destination folder chosen' : pending.destination;
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
  const emptyState = byId('empty-state');
  const table = byId('jobs-table');
  const body = byId('jobs-body');
  body.textContent = '';
  if (state.jobs.length === 0) {
    emptyState.hidden = false;
    table.hidden = true;
    return;
  }
  emptyState.hidden = true;
  table.hidden = false;
  for (const row of state.jobs) {
    body.appendChild(jobRowElement(row));
  }
}

function jobRowElement(row: ManagerJobRowDocument): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const lineage = document.createElement('th');
  lineage.scope = 'row';
  lineage.textContent = row.lineageId;
  tr.appendChild(lineage);

  const status = document.createElement('td');
  status.textContent = jobStatusText(row);
  tr.appendChild(status);

  const progress = document.createElement('td');
  progress.textContent = jobProgressText(row);
  tr.appendChild(progress);

  const destination = document.createElement('td');
  destination.textContent = row.destination === null ? 'not chosen' : row.destination;
  tr.appendChild(destination);

  const actions = document.createElement('td');
  const availability = jobActions(row);
  actions.appendChild(
    actionButton(
      'Cancel',
      row.lineageId,
      availability.cancelEnabled,
      () => void runControl('cancel', row.lineageId),
    ),
  );
  actions.appendChild(
    actionButton(
      'Retry',
      row.lineageId,
      availability.retryEnabled,
      () => void runControl('retry', row.lineageId),
    ),
  );
  actions.appendChild(
    actionButton(
      'Reveal folder',
      row.lineageId,
      availability.revealEnabled,
      () => void runReveal(row.lineageId),
    ),
  );
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
    state = noticeShown(state, { kind: 'error', text: `reveal refused: ${answer.detail}` });
  } else if (answer.document !== 'xdownload.desktop.manager.reveal') {
    state = noticeShown(state, { kind: 'error', text: 'reveal refused: unexpected document' });
  } else {
    state = noticeShown(state, {
      kind: 'info',
      text: `revealed the destination folder for ${answer.lineageId}`,
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
  const answer = await BRIDGE.managerConfirmAdd();
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
      text: `destination refused: ${answer.detail}`,
    });
  } else if (answer.document !== 'xdownload.desktop.manager.destination') {
    state = noticeShown(state, {
      kind: 'error',
      text: 'destination refused: unexpected document',
    });
  } else if (answer.destination === null) {
    state = noticeShown(state, { kind: 'info', text: 'no destination folder chosen' });
  } else {
    chosenDestination = answer.destination;
    state = noticeShown(state, {
      kind: 'info',
      text: `destination folder: ${answer.destination}`,
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
