/**
 * @xdownload/core-seam — T004 core command/query authority boundary.
 *
 * The versioned local command/query seam through which Desktop, CLI and
 * Browser adapters submit idempotent commands/observations and read Core-owned
 * projections: versioned envelope wire contract, declared input bounds,
 * same-install/same-user peer authorization, idempotent acceptance with
 * revision gating, lifecycle-independent clients and the read-only projection
 * facade. Canonical payload vocabulary is owned by `@xdownload/domain-contracts`;
 * this seam adds no competing domain semantics.
 */

export * from './diagnostics.ts';
export * from './ids.ts';
export * from './bounds.ts';
export * from './envelope.ts';
export * from './peer.ts';
export * from './state.ts';
export * from './projection.ts';
export * from './server.ts';
export * from './transport.ts';
export * from './transport-loopback.ts';
export * from './client.ts';
