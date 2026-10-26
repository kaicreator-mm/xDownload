/**
 * #150 Core-owned closed registry of supported S3 public media profiles.
 *
 * L2 S3 selected-media command §2.4: a CONFIRM_S3_CANDIDATE may reference
 * only a Core-registered `mediaProfileId`, and the Core derives the
 * non-waivable required Media checks from the pinned profile — the caller
 * can never author a weaker sufficient MediaPolicy. Each profile names its
 * container extension and the bounded structural signatures every accepted
 * byte stream must exhibit (probe revision pinned with the candidate).
 *
 * This is a deliberately closed, versioned subset (L2 §3: "Initial supported
 * format subset must be named"): self-contained MP4/M4A (ISO-BMFF `ftyp`
 * box), WebM (EBML magic) and MPEG-1 Layer III frame-sync MP3. Ambiguous
 * mux/codec topology, separated A/V and DRM stay UNSUPPORTED — an honest
 * named subset, never a guessed PASS.
 */

import { createHash } from 'node:crypto';
import type { MediaPolicy, MediaSignature } from './port.ts';

export type S3SupportedMediaContainer = 'mp4' | 'm4a' | 'mp3' | 'webm';

export interface S3SupportedMediaProfile extends MediaPolicy {
  /** Canonical registry identity referenced by CONFIRM_S3_CANDIDATE. */
  readonly profileId: string;
  /** Container extension the selected locator must carry. */
  readonly container: S3SupportedMediaContainer;
  /**
   * Structural probe semantics revision: pinned into the durable candidate
   * record so replay/reopen re-uses byte-identical mandatory checks or fails
   * closed (L2 replay pin).
   */
  readonly probeRevision: number;
}

/** Hex helpers keep the registry literal reviewable byte-for-byte. */
function signature(hex: string, offset: number, label: string): MediaSignature {
  return { hex, offset, label };
}

export const S3_SUPPORTED_MEDIA_PROFILES: readonly S3SupportedMediaProfile[] = Object.freeze([
  Object.freeze({
    profileId: 's3-media-mp4-v1',
    container: 'mp4',
    probeRevision: 1,
    signatures: Object.freeze([signature('66747970', 4, 'iso-bmff ftyp box')]),
  }),
  Object.freeze({
    profileId: 's3-media-m4a-v1',
    container: 'm4a',
    probeRevision: 1,
    signatures: Object.freeze([
      signature('66747970', 4, 'iso-bmff ftyp box'),
      signature('4d3441', 8, 'M4A major brand'),
    ]),
  }),
  Object.freeze({
    profileId: 's3-media-mp3-v1',
    container: 'mp3',
    probeRevision: 1,
    signatures: Object.freeze([signature('fffb', 0, 'MPEG-1 layer III frame sync')]),
  }),
  Object.freeze({
    profileId: 's3-media-webm-v1',
    container: 'webm',
    probeRevision: 1,
    signatures: Object.freeze([signature('1a45dfa3', 0, 'EBML magic')]),
  }),
]);

export function lookupSupportedMediaProfile(
  profileId: string,
): S3SupportedMediaProfile | undefined {
  return S3_SUPPORTED_MEDIA_PROFILES.find((profile) => profile.profileId === profileId);
}

/**
 * Canonical registry content digest: pinned into challenge/confirm responses
 * and the durable candidate record so a profile-registry change is visible
 * and replay-safe (identical digest re-pins; a changed digest requires a new
 * confirmation with the new registry revision).
 */
export function digestSupportedMediaProfiles(): string {
  const canonical = S3_SUPPORTED_MEDIA_PROFILES.map((profile) => ({
    profileId: profile.profileId,
    container: profile.container,
    probeRevision: profile.probeRevision,
    signatures: profile.signatures.map((entry) => ({
      hex: entry.hex,
      offset: entry.offset,
      label: entry.label,
    })),
  }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * The non-waivable Core-owned MediaPolicy of one supported profile. Caller
 * assertions may only strengthen (checked elsewhere); this derivation is the
 * only mandatory-check source for an S3 execution.
 */
export function mediaPolicyOfProfile(profile: S3SupportedMediaProfile): MediaPolicy {
  return { signatures: profile.signatures };
}
