/**
 * @xdownload/download-domain-host / src/direct — v0.2 T04 public face.
 *
 * The trusted C/Host bridge over the EXISTING direct-acquisition engine:
 * permit-gated acquisition, registry-resolved opaque targetRefs, single
 * canonical budget truth and digest-backed atomic materialization. No new
 * fetch engine, no hidden retry, no secondary ledger (frozen T04 contract).
 */
export {
  InMemoryTargetRefRegistry,
  isRawLocatorShape,
  type TargetRefRecord,
  type TargetRefRegistry,
} from './target-ref-registry.ts';
export { CanonicalBudgetLedger } from './budget-ledger.ts';
export {
  DirectAcquisitionBridge,
  type DirectAcquisitionBridgeCounters,
  type DirectAcquisitionBridgeOptions,
  type KernelPermitContext,
  type TransferStartRecord,
} from './direct-acquisition-bridge.ts';
