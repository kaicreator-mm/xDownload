/**
 * @xdownload/domain-contracts — T002 canonical domain contracts, schemas and
 * semantic kernel, extended additively by T007 with the typed evidence,
 * validation, coverage-accounting and result-projection semantic layer
 * (Core-owned per frozen L2 §6.7/ADR-009).
 *
 * Core-owned, versioned contract/schema vocabulary for AcquisitionContract,
 * SelectionSnapshot, logical identities, immutable scope/continuation,
 * budget domains, typed Evidence/Validation/Result identities and stable
 * adapter ports. Pure: no I/O, no surfaces, no persistence, no network.
 */

export * from './diagnostics.ts';
export * from './version.ts';
export * from './ids.ts';
export * from './decode.ts';
export * from './scope.ts';
export * from './budget.ts';
export * from './evidence.ts';
export * from './contract.ts';
export * from './snapshot.ts';
export * from './result.ts';
export * from './ledger.ts';
export * from './validation-record.ts';
export * from './coverage-accounting.ts';
export * from './result-projector.ts';
export * from './slices.ts';
export * from './ports.ts';
