/**
 * T06 S4 HLS VOD Capability package. This external-effect handler runs only
 * after the selected Kernel's durable permit gate and reaches one trusted
 * Host pin. It has no URL fetch, filesystem or retry authority.
 */
export const MODULE_ID = 'capability-s4-hls-vod@0.2.1';
export const PACKAGE_KIND = 'capability';
export const ABI_VERSION = 'v08-capability-abi/1';
export const ENDPOINTS = [{ endpointId: 'capability:s4-hls-vod', kind: 'capability-endpoint' }];
export const OPERATIONS = [
  {
    operationId: 'media.acquire',
    effectClass: 'non-idempotent',
    intentType: 'confirmDownload',
    resource: { key: 'media', operation: 'media.acquire' },
    externalEffect: true,
  },
];

function bridge() {
  const value = globalThis.__xdownloadS4HlsVodBridge;
  if (value === undefined || value === null || typeof value.acquireS4HlsVod !== 'function') {
    throw new Error('S4 HLS media.acquire requires the trusted T06 Host bridge pin');
  }
  return value;
}

export function acquireS4HlsVod(payload, dispatchContext) {
  if (arguments.length !== 2) throw new Error('S4 HLS receives exactly (payload, dispatchContext)');
  const record = payload === null || typeof payload !== 'object' ? {} : payload;
  const permit =
    dispatchContext && typeof dispatchContext === 'object'
      ? dispatchContext.effectPermit
      : undefined;
  return bridge().acquireS4HlsVod(record, permit);
}
