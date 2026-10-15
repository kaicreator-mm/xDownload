/**
 * Two-stage S4 selected manifest admission under the ONE Core-owned T009
 * transfer ledger. This function is an internal post-intent capability.
 *
 * The trusted Core must already have persisted an accepted HLS effect before
 * invoking it. It never creates a scheduler task, user confirmation, budget
 * or media truth. Both bytes and request effects are recorded with the
 * caller's authoritative ledger; pre-HTTP admission is fail-closed.
 */
import { diagnostic, fail, type DomainValidationResult } from '@xdownload/domain-contracts';
import type { LocatorBinding, LogicalTargetId } from '@xdownload/domain-contracts';
import type { TransferLedger } from './budget.ts';
import type { AuthorizedHlsManifestPort } from './manifest-http.ts';
import { decodeMasterPlaylist } from './playlist.ts';
import { preflightSelectedHlsVod, type SelectedHlsPreflight } from './selected-preflight.ts';

export interface BudgetedManifestAdmission {
  readonly logicalTargetId: LogicalTargetId;
  readonly manifestLocator: LocatorBinding<LogicalTargetId>;
  readonly selectedRenditionUri: string;
  readonly ledger: TransferLedger;
  readonly port: AuthorizedHlsManifestPort;
}

export async function acquireSelectedHlsManifests(
  input: BudgetedManifestAdmission,
): Promise<DomainValidationResult<SelectedHlsPreflight>> {
  if (input.manifestLocator.identity !== input.logicalTargetId) {
    return fail([
      diagnostic(
        'CONTRACT_BINDING_MISMATCH',
        'manifestLocator.identity',
        'S4 manifest target differs from the frozen selected target',
      ),
    ]);
  }

  async function read(
    uri: string,
    path: string,
  ): Promise<DomainValidationResult<string>> {
    const remaining = input.ledger.remaining();
    const bytesLeft = remaining.transfer.perLimit['bytes'];
    if (
      !Number.isSafeInteger(input.port.maxResponseBytes) ||
      input.port.maxResponseBytes < 1 ||
      (bytesLeft !== undefined && bytesLeft < input.port.maxResponseBytes)
    ) {
      return fail([
        diagnostic(
          'ADMISSION_REJECTED',
          path,
          'remaining Core transfer byte budget cannot cover one manifest request',
        ),
      ]);
    }
    const admitted = input.ledger.admitTransferWork('MANIFEST_REQUEST');
    if (!admitted.ok) return admitted;
    const result = await input.port.fetchManifest(uri);
    // Record the fact that a manifest request occurred even on a typed
    // failure; only actually returned payload bytes may be consumed.
    input.ledger.recordTransfer(
      'MANIFEST_REQUEST',
      result.ok ? result.byteLength : 0,
    );
    if (!result.ok) {
      return fail([
        diagnostic(
          'ADMISSION_REJECTED',
          path,
          `approved S4 manifest read refused: ${result.reason}`,
        ),
      ]);
    }
    return { ok: true, value: result.text };
  }

  const master = await read(input.manifestLocator.locator.uri, 'masterManifest');
  if (!master.ok) return master;

  const decoded = decodeMasterPlaylist(
    master.value,
    input.manifestLocator.locator.uri,
  );
  if (!decoded.ok) return decoded;
  const candidates = decoded.value.variants.filter(
    (variant) => variant.uri === input.selectedRenditionUri,
  );
  if (candidates.length !== 1) {
    return fail([
      diagnostic(
        'ADMISSION_REJECTED',
        'selectedRenditionUri',
        'S4 cannot request an undeclared or ambiguous selected rendition',
      ),
    ]);
  }
  // Only a declared, exact rendition may authorize the second HTTP request.
  const media = await read(candidates[0]!.uri, 'mediaManifest');
  if (!media.ok) return media;

  return preflightSelectedHlsVod({
    logicalTargetId: input.logicalTargetId,
    manifestLocator: input.manifestLocator,
    masterText: master.value,
    selectedRenditionUri: input.selectedRenditionUri,
    mediaText: media.value,
  });
}
