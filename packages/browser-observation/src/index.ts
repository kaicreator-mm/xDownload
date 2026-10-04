/**
 * @xdownload/browser-observation — T010 browser observation/handoff seam.
 *
 * Untrusted-input gate, provenance-bound observation records, handoff into
 * canonical contract vocabulary and exit-sink redaction. Pure: no chrome.*
 * API calls, no I/O. The privileged extension context (apps/browser-extension)
 * consumes this package at the browser boundary.
 */

export * from './result.ts';
export * from './provenance.ts';
export * from './messageGate.ts';
export * from './observation.ts';
export * from './sinkRedaction.ts';
export * from './handoff.ts';
