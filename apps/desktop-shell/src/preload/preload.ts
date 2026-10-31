/**
 * T07/T08 desktop-shell preload — the narrow, typed renderer bridge (frozen
 * L2 §4: preload exposes a narrow, typed allowlist only; no raw filesystem,
 * shell, process, network, arbitrary IPC or Host authority reaches renderer
 * content).
 *
 * Discipline:
 * - The sandboxed preload script runs with context isolation; it exposes ONE
 *   frozen object under ONE key (`xdownloadShell`) whose method set is
 *   EXACTLY the closed `SHELL_IPC_CHANNELS` allowlist (T08 joins the same
 *   discipline: every method is one explicit allowlisted channel, none is
 *   dynamic).
 * - Each method maps to exactly one allowlisted channel in
 *   `SHELL_IPC_CHANNELS`; channel strings are never taken from arguments,
 *   there is no listener/send exposure and no pass-through invoke of a
 *   caller-chosen channel.
 * - Everything the renderer receives is a plain JSON document typed in
 *   `shell-contract.ts` (status/manager documents or typed refusals).
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  SHELL_BRIDGE_KEY,
  SHELL_IPC_CHANNELS,
  type ManagerActionDocument,
  type ManagerDestinationDocument,
  type ManagerJobListDocument,
  type ManagerPreviewDocument,
  type ManagerRevealDocument,
  type ShellRefusal,
  type ShellStatusDocument,
  type XDownloadShellBridge,
} from '../main/shell-contract.ts';

const bridge: XDownloadShellBridge = {
  status: (): Promise<ShellStatusDocument | ShellRefusal> =>
    ipcRenderer.invoke(SHELL_IPC_CHANNELS.status),
  managerRefresh: (): Promise<ManagerJobListDocument | ShellRefusal> =>
    ipcRenderer.invoke(SHELL_IPC_CHANNELS.managerRefresh),
  managerPreviewAdd: (input: {
    readonly url: string;
    readonly destination?: string;
  }): Promise<ManagerPreviewDocument | ShellRefusal> =>
    ipcRenderer.invoke(SHELL_IPC_CHANNELS.managerPreviewAdd, input),
  managerConfirmAdd: (): Promise<ManagerActionDocument | ShellRefusal> =>
    ipcRenderer.invoke(SHELL_IPC_CHANNELS.managerConfirmAdd),
  managerDiscardPreview: (): Promise<ManagerActionDocument | ShellRefusal> =>
    ipcRenderer.invoke(SHELL_IPC_CHANNELS.managerDiscardPreview),
  managerCancelJob: (input: {
    readonly lineageId: string;
  }): Promise<ManagerActionDocument | ShellRefusal> =>
    ipcRenderer.invoke(SHELL_IPC_CHANNELS.managerCancelJob, input),
  managerRetryJob: (input: {
    readonly lineageId: string;
  }): Promise<ManagerActionDocument | ShellRefusal> =>
    ipcRenderer.invoke(SHELL_IPC_CHANNELS.managerRetryJob, input),
  managerChooseDestination: (): Promise<ManagerDestinationDocument | ShellRefusal> =>
    ipcRenderer.invoke(SHELL_IPC_CHANNELS.managerChooseDestination),
  managerRevealJob: (input: {
    readonly lineageId: string;
  }): Promise<ManagerRevealDocument | ShellRefusal> =>
    ipcRenderer.invoke(SHELL_IPC_CHANNELS.managerRevealJob, input),
};

contextBridge.exposeInMainWorld(SHELL_BRIDGE_KEY, Object.freeze(bridge));
