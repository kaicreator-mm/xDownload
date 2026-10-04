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
  const admitted = master.variants.some((variant) => variant.uri === selectedVariant.uri);
  if (!admitted) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'selectedVariant.uri',
        `variant '${selectedVariant.uri}' is not a variant identity declared by the selected manifest; rendition binding requires manifest identity correspondence`,
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
        bandwidth: selectedVariant.bandwidth,
        codecs: selectedVariant.codecs,
        resolution: selectedVariant.resolution,
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
