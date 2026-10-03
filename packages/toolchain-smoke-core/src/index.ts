/**
 * T001 bootstrap smoke helpers — pure toolchain truth only.
 *
 * This package is deliberately NOT a product module. It exists so the
 * bootstrap toolchain (workspace linking, typecheck, lint, unit runner)
 * has a deterministic subject to exercise. Product modules belong to
 * their owning downstream tasks.
 */

export interface ToolchainIdentity {
  node: string;
  pnpm: string;
}

/** Deterministically render a toolchain identity label. */
export function formatToolchainLabel(identity: ToolchainIdentity): string {
  return `xDownload bootstrap toolchain: node ${identity.node}, pnpm ${identity.pnpm}`;
}

/** True only for Node.js 24.x runtime tuples (the pinned T001 major line). */
export function isNode24(identity: ToolchainIdentity): boolean {
  return identity.node.startsWith('v24.');
}
