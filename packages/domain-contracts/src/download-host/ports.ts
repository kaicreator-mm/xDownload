/**
 * V022 A01 — neutral Host-operation contracts: narrow shared Host ports.
 *
 * Only the port types BOTH sides require with identical shapes live here:
 * Domain App/Core dispatches a validated Host request DTO through the port;
 * the trusted Host independently re-validates the DTO, executes the
 * physical effect behind its Kernel permit gate and settles with the typed
 * EffectEnvelope plus validated MaterializedEvidence. The Kernel permit
 * itself stays Host-side: the port carries it as `unknown` and the Host
 * validates it with its own fail-closed permit grammar before any effect.
 * Pure types only: no I/O, no implementations.
 */
import type { DirectHostAcquisitionRequest } from './direct-request.ts';
import type { EffectEnvelope, MaterializedEvidence } from './envelope.ts';
import type { S4HostAcquisitionRequest } from './s4-request.ts';

/** Settlement returned by every Host acquisition port: typed terminal envelope plus bounded evidence when materialized. */
export interface HostAcquisitionSettlement {
  readonly envelope: EffectEnvelope;
  readonly evidence: MaterializedEvidence | undefined;
}

/** The direct-acquisition lane: executes validated direct requests only. */
export interface DirectAcquisitionHostPort {
  executeDirect(
    request: DirectHostAcquisitionRequest,
    permit: unknown,
  ): Promise<HostAcquisitionSettlement>;
}

/** The S4 selected-HLS media lane: executes validated S4 requests only. */
export interface S4MediaAcquisitionHostPort {
  executeS4Media(
    request: S4HostAcquisitionRequest,
    permit: unknown,
  ): Promise<HostAcquisitionSettlement>;
}

/** The closed Host request union: exactly one lane per validated request. */
export type HostAcquisitionRequest = DirectHostAcquisitionRequest | S4HostAcquisitionRequest;
