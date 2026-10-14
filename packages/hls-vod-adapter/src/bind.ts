/**
 * T009 — manifest/rendition binding to a frozen logical target.
 *
 * Selection binds an explicit master-playlist/rendition identity to the
 * frozen logical target (frozen L2 invariant 4: logical target is not
 * locator). The binding is immutable once made; rendition substitution is a
 * successor-identity event that this adapter has no authority to mint, so it
 * is rejected instead of silently applied. All locator transitions descend
 * from the selected manifest through canonical provenance rules
 * (assertLocatorTransitionPreservesTarget).
 */

import {
  assertLocatorTransitionPreservesTarget,
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
  type LocatorBinding,
  type LogicalTargetId,
} from '@xdownload/domain-contracts';
import type { MasterPlaylist, VariantStream } from './playlist.ts';

export interface RenditionDeclared {
  readonly bandwidth: number;
  readonly codecs: readonly string[];
  readonly resolution?: { readonly width: number; readonly height: number };
}

export interface HlsRenditionBinding {
  readonly kind: 'hls-rendition-binding';
  readonly logicalTargetId: LogicalTargetId;
  /** The selected master manifest locator, bound to the frozen logical target. */
  readonly manifestLocator: LocatorBinding<LogicalTargetId>;
  /** Logical rendition identity: the variant URI declared by the selected manifest. */
  readonly renditionId: string;
  /** First locator instance of the selected rendition, descending from the manifest locator. */
  readonly renditionLocator: LocatorBinding<LogicalTargetId>;
  readonly declared: RenditionDeclared;
}

/**
 * Bind the selected variant to the frozen logical target. The manifest
 * locator must already be a canonical LocatorBinding for the target; the
 * rendition locator is derived as a provenance-bound transition from it.
 */
export function bindRenditionToTarget(input: {
  readonly logicalTargetId: LogicalTargetId;
  readonly manifestLocator: LocatorBinding<LogicalTargetId>;
  readonly master: MasterPlaylist;
  readonly selectedVariant: VariantStream;
}): DomainValidationResult<HlsRenditionBinding> {
  const { logicalTargetId, manifestLocator, master, selectedVariant } = input;
  const declared = master.variants.find((variant) => variant.uri === selectedVariant.uri);
  if (declared === undefined) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'selectedVariant.uri',
        'selected rendition is not declared by the frozen master playlist',
      ),
    ]);
  }
  // Exact URI alone is insufficient. A caller could reuse the frozen URI
  // while supplying a different codec/resolution/bandwidth, changing the
  // Media probe's expected truth without any manifest or identity change.
  // Bind the *decoded manifest* declaration and reject every mismatched
  // caller-selected field, including index and codec order.
  if (
    selectedVariant.index !== declared.index ||
    selectedVariant.bandwidth !== declared.bandwidth ||
    selectedVariant.codecs.length !== declared.codecs.length ||
    selectedVariant.codecs.some((codec, index) => codec !== declared.codecs[index]) ||
    selectedVariant.resolution?.width !== declared.resolution?.width ||
    selectedVariant.resolution?.height !== declared.resolution?.height
  ) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'selectedVariant',
        'selected rendition declaration differs from the frozen manifest',
      ),
    ]);
  }
  const renditionLocator = assertLocatorTransitionPreservesTarget(
    manifestLocator,
    { kind: 'direct', uri: selectedVariant.uri },
    {
      binding: 'SELECTED_RESOURCE_PROVENANCE',
      originLocatorUri: manifestLocator.locator.uri,
    },
  );
  if (!renditionLocator.ok) {
    return renditionLocator;
  }
  return ok(
    deepFreeze({
      kind: 'hls-rendition-binding' as const,
      logicalTargetId,
      manifestLocator,
      renditionId: selectedVariant.uri,
      renditionLocator: renditionLocator.value,
      declared: deepFreeze({
        bandwidth: declared.bandwidth,
        codecs: declared.codecs,
        resolution: declared.resolution,
      }),
    }),
  );
}

/**
 * Binding immutability rule: a different rendition identity for the same
 * frozen logical target is never a silent update. Substitution is a
 * successor-identity event that only the Core authority can mint; the
 * adapter rejects it.
 */
export function forbidRenditionSubstitution(
  binding: HlsRenditionBinding,
  attemptedRenditionId: string,
): DomainValidationResult<void> {
  if (attemptedRenditionId !== binding.renditionId) {
    return fail([
      diagnostic(
        'SNAPSHOT_MUTATION',
        'binding.renditionId',
        `rendition substitution '${binding.renditionId}' -> '${attemptedRenditionId}' after binding is not permitted without a successor logical-target identity`,
        'L2-inv4',
      ),
    ]);
  }
  return ok(undefined);
}
