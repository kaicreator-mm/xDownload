/**
 * T002 canonical support-slice representations S1–S6 (frozen PRD §28).
 *
 * Representation at the contract/type level only: no browser, transfer,
 * media, persistence or UI behavior belongs here. Each slice declares its
 * surface class, default continuation and required validation layers.
 */

import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type ValidationDiagnostic,
} from './diagnostics.ts';
import { asRecord, rejectUnknownFields, requireLiteral } from './decode.ts';
import type { ValidationLayer } from './evidence.ts';
import type { ContinuationScope } from './scope.ts';

export const SUPPORT_SLICE_IDS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] as const;

export type SupportSliceId = (typeof SUPPORT_SLICE_IDS)[number];

export type SupportSliceSurfaceClass = 'DIRECT_TRANSFER' | 'BROWSER_MEDIATED' | 'COLLECTION';

/**
 * Canonical representation of one required support slice. `representationOnly`
 * is a literal: the slice registry describes product support contracts and
 * never implements behavior.
 */
export interface SupportSliceRepresentation {
  readonly sliceId: SupportSliceId;
  readonly title: string;
  readonly surfaceClass: SupportSliceSurfaceClass;
  readonly defaultContinuation: ContinuationScope;
  readonly requiredValidationLayers: readonly ValidationLayer[];
  readonly representationOnly: true;
}

const SLICE_REGISTRY: Readonly<
  Record<SupportSliceId, Omit<SupportSliceRepresentation, 'representationOnly'>>
> = Object.freeze({
  S1: {
    sliceId: 'S1',
    title: 'Direct HTTP/HTTPS File',
    surfaceClass: 'DIRECT_TRANSFER',
    defaultContinuation: deepFreeze({ kind: 'NONE' as const }),
    requiredValidationLayers: ['target', 'transfer', 'format'],
  },
  S2: {
    sliceId: 'S2',
    title: 'Browser Download Handoff / Explicit Current-page Attachment',
    surfaceClass: 'BROWSER_MEDIATED',
    defaultContinuation: deepFreeze({ kind: 'NONE' as const }),
    requiredValidationLayers: ['target', 'transfer', 'format'],
  },
  S3: {
    sliceId: 'S3',
    title: 'Direct Media File',
    surfaceClass: 'DIRECT_TRANSFER',
    defaultContinuation: deepFreeze({ kind: 'NONE' as const }),
    requiredValidationLayers: ['target', 'transfer', 'format', 'media'],
  },
  S4: {
    sliceId: 'S4',
    title: 'HLS VOD Basic',
    surfaceClass: 'BROWSER_MEDIATED',
    defaultContinuation: deepFreeze({ kind: 'NONE' as const }),
    requiredValidationLayers: ['target', 'transfer', 'format', 'media'],
  },
  S5: {
    sliceId: 'S5',
    title: 'Current-page Resource Collection',
    surfaceClass: 'COLLECTION',
    // R01: confirmed current-page membership snapshot, continuation NONE by default.
    defaultContinuation: deepFreeze({ kind: 'NONE' as const }),
    requiredValidationLayers: ['membership', 'target', 'transfer', 'format', 'coverage'],
  },
  S6: {
    sliceId: 'S6',
    title: 'Explicit Playlist / Gallery Collection',
    surfaceClass: 'COLLECTION',
    defaultContinuation: deepFreeze({ kind: 'NONE' as const }),
    requiredValidationLayers: ['membership', 'target', 'transfer', 'coverage'],
  },
});

const SLICE_KEYS: readonly string[] = ['sliceId'];

/** All six required v0.1.0 support slices as canonical representations. */
export function supportSliceRepresentations(): readonly SupportSliceRepresentation[] {
  return SUPPORT_SLICE_IDS.map((sliceId) =>
    deepFreeze({ ...SLICE_REGISTRY[sliceId]!, representationOnly: true as const }),
  );
}

/**
 * Decode a slice reference. Unknown slice ids fail closed — the v0.1.0
 * registry contains exactly S1–S6 (frozen PRD §28).
 */
export function decodeSupportSliceRef(
  value: unknown,
): DomainValidationResult<SupportSliceRepresentation> {
  const diagnostics: ValidationDiagnostic[] = [];
  const record = unwrap(asRecord(value, 'supportSlice'), diagnostics);
  if (record === undefined) {
    return fail(diagnostics);
  }
  pushAll(rejectUnknownFields(record, SLICE_KEYS, 'supportSlice'), diagnostics);
  const sliceId = unwrap(
    requireLiteral(record, 'sliceId', SUPPORT_SLICE_IDS, 'supportSlice'),
    diagnostics,
  );
  if (diagnostics.length > 0 || sliceId === undefined) {
    return fail(
      diagnostics.length > 0
        ? diagnostics
        : [diagnostic('UNKNOWN_ENUM_VALUE', 'supportSlice.sliceId', 'unknown slice')],
    );
  }
  return ok(deepFreeze({ ...SLICE_REGISTRY[sliceId]!, representationOnly: true as const }));
}

function unwrap<T>(
  result: DomainValidationResult<T>,
  diagnostics: ValidationDiagnostic[],
): T | undefined {
  if (result.ok) {
    return result.value;
  }
  diagnostics.push(...result.diagnostics);
  return undefined;
}

function pushAll(result: DomainValidationResult<void>, diagnostics: ValidationDiagnostic[]): void {
  if (!result.ok) {
    diagnostics.push(...result.diagnostics);
  }
}
