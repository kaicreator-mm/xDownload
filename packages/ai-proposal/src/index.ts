/**
 * @xdownload/ai-proposal — T012 bounded AI proposal adapter.
 *
 * Optional model-provider port, model-input redaction boundary, bounded
 * proposal envelope, deterministic proposal validation/rejection policy and
 * no-model fallback (frozen L2 ADR-008: AI is proposal-only and cannot
 * grant authority). Pure decision/redaction logic: no network, no model
 * SDK, no surface, no persistence, no scheduler, no budget writer.
 *
 * A proposal is data, never authority: acceptance produces a suggested
 * Recipe value with SUGGESTIVE/DISCOVERY_DERIVED provenance that must still
 * flow through the ordinary deterministic paths — Recipe decode, capability
 * authorization, contract/snapshot scope validation, user confirmation and
 * typed evidence — exactly like a human suggestion. The deterministic
 * product path is complete and correct with the provider absent.
 */

export * from './diagnostics.ts';
export * from './providerPort.ts';
export * from './modelInput.ts';
export * from './proposalEnvelope.ts';
export * from './proposalPolicy.ts';
export * from './fallback.ts';
export * from './adapter.ts';
