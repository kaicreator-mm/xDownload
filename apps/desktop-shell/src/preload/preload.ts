/**
 * T07 desktop-shell preload — the narrow, typed renderer bridge (frozen L2
 * §4: preload exposes a narrow, typed allowlist only; no raw filesystem,
 * shell, process, network, arbitrary IPC or Host authority reaches renderer
 * content).
 *
 * Discipline:
 * - The sandboxed preload script runs with context isolation; it exposes ONE
 *   frozen object under ONE key (`xdownloadShell`) with ONE typed method.
 * - Each method maps to exactly one allowlisted channel in
 *   `SHELL_IPC_CHANNELS`; channel strings are never taken from arguments,
 *   there is no listener/send exposure and no pass-through invoke of a
 *   caller-chosen channel.
 * - Everything the renderer receives is a plain JSON document typed in
 *   `shell-contract.ts` (status document or typed refusal).
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  SHELL_BRIDGE_KEY,
  SHELL_IPC_CHANNELS,
  type ShellRefusal,
  type ShellStatusDocument,
  type XDownloadShellBridge,
} from '../main/shell-contract.ts';

const bridge: XDownloadShellBridge = {
  status: (): Promise<ShellStatusDocument | ShellRefusal> =>
    ipcRenderer.invoke(SHELL_IPC_CHANNELS.status),
};

contextBridge.exposeInMainWorld(SHELL_BRIDGE_KEY, Object.freeze(bridge));
