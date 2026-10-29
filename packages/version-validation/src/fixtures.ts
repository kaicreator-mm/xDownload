/**
 * Controlled, deterministic fixture resources (frozen PRD §33; TEST_MATRIX
 * suite `corpus-identity`).
 *
 * Fixtures are static, in-process, byte-deterministic resources: no live
 * network, no wall clock, no randomness. Repeated evaluation of the same
 * fixture id returns byte-identical content with a stable digest, so a
 * controlled fixture can never inject nondeterministic truth.
 */

import { createHash } from 'node:crypto';
import {
  deepFreeze,
  diagnostic,
  fail,
  ok,
  type DomainValidationResult,
} from '@xdownload/domain-contracts';
import { makeFixtureResourceId, type FixtureResourceId } from './identity.ts';

export type FixtureResourceKind = 'STATIC_BYTES' | 'MEMBER_LIST';

export interface FixtureResource {
  readonly resourceId: FixtureResourceId;
  readonly kind: FixtureResourceKind;
  /**
   * Stable byte content as a frozen plain array (typed-array views cannot be
   * frozen); for MEMBER_LIST fixtures this is the serialized identity list.
   */
  readonly bytes: readonly number[];
  readonly sha256: string;
  readonly declaredMediaType?: string;
  /** For MEMBER_LIST fixtures: the logical member identities, in frozen order. */
  readonly memberIds?: readonly string[];
}

interface FixtureSeed {
  readonly id: string;
  readonly kind: FixtureResourceKind;
  readonly content: string;
  readonly declaredMediaType?: string;
  readonly memberIds?: readonly string[];
}

const SEEDS: readonly FixtureSeed[] = Object.freeze([
  {
    id: 'fixture/s1-direct-report',
    kind: 'STATIC_BYTES',
    content: 'xdownload-fixture:s1-direct-report:application/pdf:v1:stable-bytes',
    declaredMediaType: 'application/pdf',
  },
  {
    id: 'fixture/s2-page-attachment',
    kind: 'STATIC_BYTES',
    content: 'xdownload-fixture:s2-page-attachment:application/zip:v1:stable-bytes',
    declaredMediaType: 'application/zip',
  },
  {
    id: 'fixture/s3-media-file',
    kind: 'STATIC_BYTES',
    content: 'xdownload-fixture:s3-media-file:video/mp4:v1:stable-bytes',
    declaredMediaType: 'video/mp4',
  },
  {
    id: 'fixture/s4-hls-manifest',
    kind: 'STATIC_BYTES',
    content: 'xdownload-fixture:s4-hls-manifest:application/vnd.apple.mpegurl:v1:stable-bytes',
    declaredMediaType: 'application/vnd.apple.mpegurl',
  },
  {
    id: 'fixture/s5-current-page-members',
    kind: 'MEMBER_LIST',
    content: 'xdownload-fixture:s5-current-page-members:v1',
    memberIds: ['member-page-001', 'member-page-002', 'member-page-003', 'member-page-004'],
  },
  {
    id: 'fixture/s6-playlist-members',
    kind: 'MEMBER_LIST',
    content: 'xdownload-fixture:s6-playlist-members:v1',
    memberIds: [
      'member-playlist-001',
      'member-playlist-002',
      'member-playlist-003',
      'member-playlist-004',
      'member-playlist-005',
    ],
  },
  {
    id: 'fixture/s6-large-member-set',
    kind: 'MEMBER_LIST',
    content: 'xdownload-fixture:s6-large-member-set:v1:150-members',
    memberIds: Array.from(
      { length: 150 },
      (_v, i) => `member-large-${String(i + 1).padStart(3, '0')}`,
    ),
  },
  {
    id: 'fixture/holdout-new-session-members',
    kind: 'MEMBER_LIST',
    content: 'xdownload-fixture:holdout-new-session-members:v1',
    memberIds: ['member-holdout-001', 'member-holdout-002', 'member-holdout-003'],
  },
]);

function buildResource(seed: FixtureSeed): FixtureResource {
  const encoded = new TextEncoder().encode(seed.content);
  const sha256 = createHash('sha256').update(encoded).digest('hex');
  return deepFreeze({
    resourceId: seed.id as FixtureResourceId,
    kind: seed.kind,
    bytes: deepFreeze(Array.from(encoded)),
    sha256,
    declaredMediaType: seed.declaredMediaType,
    memberIds: seed.memberIds === undefined ? undefined : deepFreeze([...seed.memberIds]),
  });
}

const REGISTRY: ReadonlyMap<string, FixtureResource> = new Map(
  SEEDS.map((seed) => [seed.id, buildResource(seed)]),
);

/** All controlled fixture resources, sorted by id for deterministic iteration. */
export function fixtureResources(): readonly FixtureResource[] {
  return [...REGISTRY.values()].sort((a, b) => (a.resourceId < b.resourceId ? -1 : 1));
}

/**
 * Resolve a controlled fixture by id. Unknown ids fail closed; repeated
 * resolution is byte-identical by construction.
 */
export function fixtureResource(id: string): DomainValidationResult<FixtureResource> {
  const checked = makeFixtureResourceId(id);
  if (!checked.ok) {
    return checked;
  }
  const resource = REGISTRY.get(id);
  if (resource === undefined) {
    return fail([
      diagnostic(
        'UNKNOWN_ENUM_VALUE',
        'fixture.resourceId',
        `unknown controlled fixture '${id}'; controlled corpora may only reference registered static fixtures`,
        'PRD-§33',
      ),
    ]);
  }
  return ok(resource);
}
