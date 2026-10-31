/**
 * T07 desktop-shell IPC surface — the ONLY channel registry of the shell
 * (frozen L2 §4: validate IPC sender and every payload; no arbitrary IPC
 * authority for renderer content).
 *
 * Discipline:
 * - The registry is closed: every `ipcMain.handle` is registered here from
 *   the `SHELL_IPC_CHANNELS` allowlist; no dynamic channel names exist.
 * - Every call passes the sender gate (the caller must be the main frame of
 *   the one shell window) and the payload gate (exact-shape decoder for the
 *   method's declared payload) before any answer is built.
 * - Failures are typed refusal documents (never raw errors, stacks or paths).
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
import { decodeUnitPayload } from './validators.ts';

/** Dependencies injected by the main entry (no module state). */
export interface ShellIpcOptions {
  /** The one shell window; its main frame is the only admitted sender. */
  readonly getWindow: () => BrowserWindow | undefined;
  /** Build the status document (already the main process's truth). */
  readonly status: () => ShellStatusDocument;
}

function refusal(detail: string): ShellRefusal {
  return { ok: false, code: 'SHELL_IPC_REFUSED', detail };
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
 * registration set IS the allowlist (there is no second registration site).
 */
export function registerShellIpc(options: ShellIpcOptions): void {
  ipcMain.handle(SHELL_IPC_CHANNELS.status, (event: IpcMainInvokeEvent, payload: unknown) => {
    if (!isAdmittedSender(event, options.getWindow())) {
      return refusal('sender is not the shell window main frame');
    }
    const payloadGate = decodeUnitPayload(payload);
    if (!payloadGate.ok) {
      return refusal(`${payloadGate.code}: ${payloadGate.detail}`);
    }
    return options.status();
  });
}

/** Remove all shell handlers (used by tests/smoke teardown). */
export function unregisterShellIpc(): void {
  ipcMain.removeHandler(SHELL_IPC_CHANNELS.status);
}
