/**
 * T07/T08 desktop-shell IPC surface — the ONLY channel registry of the shell
 * (frozen L2 §4: validate IPC sender and every payload; no arbitrary IPC
 * authority for renderer content).
 *
 * Discipline:
 * - The registry is closed: every `ipcMain.handle` is registered here from
 *   the `SHELL_IPC_CHANNELS` allowlist; no dynamic channel names exist. The
 *   registration loop below is the ONE registration site (T08 extends the
 *   table, never the mechanism: same sender gate, same payload gate, same
 *   typed-refusal answers for every entry).
 * - Every call passes the sender gate (the caller must be the main frame of
 *   the one shell window) and the payload gate (the method's declared
 *   exact-shape decoder) before any answer is built.
 * - Failures are typed refusal documents (never raw errors, stacks or paths);
 *   handlers themselves never throw across the bridge.
 *
 * This module imports `electron` (it binds `ipcMain`), so its behavior is
 * pinned by the static security-invariant tests; the decoders it delegates
 * to are pure and unit-tested directly.
 */

import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  SHELL_IPC_CHANNELS,
  type ShellRefusal,
  type ShellStatusDocument,
} from './shell-contract.ts';
import type { DesktopManager } from './manager.ts';
import {
  decodeLineageRefPayload,
  decodePreviewAddPayload,
  decodeUnitPayload,
  type DecodeResult,
  type LineageRefPayload,
  type PreviewAddPayload,
} from './validators.ts';

/** Dependencies injected by the main entry (no module state). */
export interface ShellIpcOptions {
  /** The one shell window; its main frame is the only admitted sender. */
  readonly getWindow: () => BrowserWindow | undefined;
  /** Build the status document (already the main process's truth). */
  readonly status: () => ShellStatusDocument;
  /** The download-manager service (every manager channel delegates here). */
  readonly manager: DesktopManager;
}

function refusal(detail: string): ShellRefusal {
  return { ok: false, code: 'SHELL_IPC_REFUSED', detail };
}

/** One registry row: the method's payload decoder and its handler. */
interface ChannelEntry {
  readonly decode: (payload: unknown) => DecodeResult<unknown>;
  readonly handle: (value: unknown) => Promise<unknown> | unknown;
}

/** Bind a handler to its exact-shape decoder (the only crossing points). */
function entry<T>(
  decode: (payload: unknown) => DecodeResult<T>,
  handle: (value: T) => Promise<unknown> | unknown,
): ChannelEntry {
  return {
    decode,
    handle: handle as (value: unknown) => Promise<unknown> | unknown,
  };
}

/** Sender gate: only the shell window's current main frame may call. */
export function isAdmittedSender(
  event: IpcMainInvokeEvent,
  window: BrowserWindow | undefined,
): boolean {
  if (window === undefined || window.isDestroyed()) {
    return false;
  }
  const contents = window.webContents;
  if (event.sender !== contents) {
    return false;
  }
  const frame = event.senderFrame;
  return frame === contents.mainFrame;
}

/**
 * Register every allowlisted channel. Called once from the main entry; the
 * registration set IS the allowlist (there is no second registration site):
 * one loop, one `ipcMain.handle`, every entry gated identically.
 */
export function registerShellIpc(options: ShellIpcOptions): void {
  const manager = options.manager;
  const entries: readonly (readonly [string, ChannelEntry])[] = [
    [SHELL_IPC_CHANNELS.status, entry(decodeUnitPayload, () => options.status())],
    [SHELL_IPC_CHANNELS.managerRefresh, entry(decodeUnitPayload, () => manager.list())],
    [
      SHELL_IPC_CHANNELS.managerPreviewAdd,
      entry(decodePreviewAddPayload, (value: PreviewAddPayload) => manager.previewAdd(value)),
    ],
    [SHELL_IPC_CHANNELS.managerConfirmAdd, entry(decodeUnitPayload, () => manager.confirmAdd())],
    [
      SHELL_IPC_CHANNELS.managerDiscardPreview,
      entry(decodeUnitPayload, () => manager.discardPreview()),
    ],
    [
      SHELL_IPC_CHANNELS.managerCancelJob,
      entry(decodeLineageRefPayload, (value: LineageRefPayload) => manager.cancelJob(value)),
    ],
    [
      SHELL_IPC_CHANNELS.managerRetryJob,
      entry(decodeLineageRefPayload, (value: LineageRefPayload) => manager.retryJob(value)),
    ],
    [
      SHELL_IPC_CHANNELS.managerChooseDestination,
      entry(decodeUnitPayload, () => manager.chooseDestination()),
    ],
    [
      SHELL_IPC_CHANNELS.managerRevealJob,
      entry(decodeLineageRefPayload, (value: LineageRefPayload) => manager.revealJob(value)),
    ],
  ];
  const registry = new Map(entries);
  for (const [channel, channelEntry] of registry) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, payload: unknown) => {
      if (!isAdmittedSender(event, options.getWindow())) {
        return refusal('sender is not the shell window main frame');
      }
      const payloadGate = channelEntry.decode(payload);
      if (!payloadGate.ok) {
        return refusal(`${payloadGate.code}: ${payloadGate.detail}`);
      }
      return channelEntry.handle(payloadGate.value);
    });
  }
}

/** Remove all shell handlers (used by tests/smoke teardown). */
export function unregisterShellIpc(): void {
  for (const channel of Object.values(SHELL_IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}
