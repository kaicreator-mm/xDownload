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
  connectionLine.textContent =
    state.connection === null ? 'Core connection: unknown' : `Core connection: ${state.connection}`;

  const destinationLabel = byId('destination-label');
  destinationLabel.textContent =
    chosenDestination === null ? 'no destination folder chosen' : chosenDestination;
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
  render();
  const input = byId('url') as HTMLInputElement;
  input.value = '';
  input.focus();
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
  if (BRIDGE === undefined || BRIDGE === null) {
    state = bridgeMissing(state);
    render();
    return;
  }
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
