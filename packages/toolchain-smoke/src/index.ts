/**
 * T001 bootstrap smoke package — proves workspace linking and gate wiring.
 *
 * Deliberately NOT a product module; downstream tasks own all product code.
 */

export {
  formatToolchainLabel,
  isNode24,
  type ToolchainIdentity,
} from '@xdownload/toolchain-smoke-core';
