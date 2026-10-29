/**
 * @xdownload/browser-auth-broker — T010 native host/broker/scoped
 * authorization seam.
 *
 * Native Messaging framing, strict `allowed_origins` enforcement with no
 * fallback transport, expiring scoped capabilities bound to an exact
 * (origin, target, contract, snapshot, provenance, partition, scope) tuple,
 * truthful issue/use/revoke lifecycle and exit-sink secret containment.
 * Pure authorization semantics; the stdio serving loop is the only I/O.
 */

export * from './result.ts';
export * from './nativeFrame.ts';
export * from './allowedOrigins.ts';
export * from './brokerChannel.ts';
export * from './capability.ts';
export * from './broker.ts';
export * from './secretZone.ts';
export * from './projection.ts';
export * from './nativeHost.ts';
