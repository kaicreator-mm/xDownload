/**
 * #151 S5 seam-1.2 closed payload codec — positive/negative decode matrix
 * (mirrors the S4 payload suite): version gate, closed command vocabulary,
 * closed field sets, canonical observed-URI rules (#157 frozen semantics),
 * member bounds/uniqueness, subset id rules, digest/challenge syntax.
 */
import { describe, expect, it } from 'vitest';
import {
  decodeS5Seam12Payload,
  s5GroupTupleDigest,
  s5SelectionTupleDigest,
} from '../src/s5-seam12-payload.ts';

const V = '1.2.0';
const PAGE = 'http://127.0.0.1:8000';
const HREF = (n: number) => `http://127.0.0.1:8000/file-${String(n)}.bin`;

function preparePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    snapshotId: 'snapshot-s5-abc',
    pageOrigin: PAGE,
    provenanceKey: 'tab-7/frame-0/http://127.0.0.1:8000/a/-/-',
    members: [
      { href: HREF(1), text: 'file one' },
      { href: HREF(2), text: 'file two' },
    ],
    ...overrides,
  };
}

describe('decodeS5Seam12Payload: version and vocabulary gates', () => {
  it('accepts a canonical PREPARE payload at a final 1.2+ version', () => {
    const decoded = decodeS5Seam12Payload('PREPARE_S5_PAGE_GROUP', V, preparePayload());
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error('expected ok');
    if (decoded.value.commandType !== 'PREPARE_S5_PAGE_GROUP') throw new Error('wrong command');
    expect(decoded.value.payload.members).toHaveLength(2);
    expect(Object.isFrozen(decoded.value.payload)).toBe(true);
  });

  it('rejects a pre-1.2 version, an unknown command and a non-final version', () => {
    expect(decodeS5Seam12Payload('PREPARE_S5_PAGE_GROUP', '1.1.0', preparePayload()).ok).toBe(false);
    expect(decodeS5Seam12Payload('PREPARE_S5_PAGE_GROUP', '2.0.0', preparePayload()).ok).toBe(false);
    expect(decodeS5Seam12Payload('PREPARE_S5_PAGE_GROUP', '1.2.0-rc1', preparePayload()).ok).toBe(false);
    expect(decodeS5Seam12Payload('STEAL_S5_GROUP', V, preparePayload()).ok).toBe(false);
  });
});

describe('decodeS5Seam12Payload: PREPARE closed shape', () => {
  it('rejects unknown fields, missing fields and non-object payloads', () => {
    expect(decodeS5Seam12Payload('PREPARE_S5_PAGE_GROUP', V, { ...preparePayload(), extra: 1 }).ok).toBe(false);
    const missing = preparePayload();
    delete missing['snapshotId'];
    expect(decodeS5Seam12Payload('PREPARE_S5_PAGE_GROUP', V, missing).ok).toBe(false);
    expect(decodeS5Seam12Payload('PREPARE_S5_PAGE_GROUP', V, []).ok).toBe(false);
    expect(decodeS5Seam12Payload('PREPARE_S5_PAGE_GROUP', V, 'x').ok).toBe(false);
  });

  it('rejects non-canonical page origins and provenance keys', () => {
    for (const bad of ['http://user:pw@127.0.0.1:8000', 'not a url', 'http://127.0.0.1:8000/']) {
      expect(decodeS5Seam12Payload('PREPARE_S5_PAGE_GROUP', V, preparePayload({ pageOrigin: bad })).ok).toBe(false);
    }
    expect(
      decodeS5Seam12Payload('PREPARE_S5_PAGE_GROUP', V, preparePayload({ provenanceKey: '' })).ok,
    ).toBe(false);
    expect(
      decodeS5Seam12Payload('PREPARE_S5_PAGE_GROUP', V, preparePayload({ provenanceKey: 'x'.repeat(513) })).ok,
    ).toBe(false);
  });

  it('enforces the frozen canonical observed-URI rule on every member', () => {
    const bad = [
      'http://127.0.0.1:8000/a?token=1', // query secret
      'http://127.0.0.1:8000/a#frag', // fragment
      'http://user:pass@127.0.0.1:8000/a', // credentials
      'ftp://127.0.0.1/a', // scheme
      'http://127.0.0.1:8000/a b', // space (non-canonical href)
      `http://127.0.0.1:8000/${'a'.repeat(2100)}`, // length
    ];
    for (const href of bad) {
      expect(
        decodeS5Seam12Payload(
          'PREPARE_S5_PAGE_GROUP',
          V,
          preparePayload({ members: [{ href, text: 't' }] }),
        ).ok,
      ).toBe(false);
    }
  });

  it('bounds the member set (1..20) and rejects duplicates and extra member fields', () => {
    expect(
      decodeS5Seam12Payload('PREPARE_S5_PAGE_GROUP', V, preparePayload({ members: [] })).ok,
    ).toBe(false);
    const tooMany = Array.from({ length: 21 }, (_, i) => ({ href: HREF(i), text: 't' }));
    expect(decodeS5Seam12Payload('PREPARE_S5_PAGE_GROUP', V, preparePayload({ members: tooMany })).ok).toBe(false);
    expect(
      decodeS5Seam12Payload(
        'PREPARE_S5_PAGE_GROUP',
        V,
        preparePayload({ members: [{ href: HREF(1), text: 'a', secret: 1 }] }),
      ).ok,
    ).toBe(false);
    expect(
      decodeS5Seam12Payload(
        'PREPARE_S5_PAGE_GROUP',
        V,
        preparePayload({ members: [{ href: HREF(1), text: 'a' }, { href: HREF(1), text: 'b' }] }),
      ).ok,
    ).toBe(false);
    expect(
      decodeS5Seam12Payload(
        'PREPARE_S5_PAGE_GROUP',
        V,
        preparePayload({ members: [{ href: HREF(1), text: 'x'.repeat(257) }] }),
      ).ok,
    ).toBe(false);
  });
});

describe('decodeS5Seam12Payload: CONFIRM phases', () => {
  const begin = {
    phase: 'BEGIN',
    snapshotId: 'snapshot-s5-abc',
    prepareId: 's5prepare:contract-s5-001:snapshot-s5-abc',
    selectedMemberIds: ['s5m-0000000000000001'],
    displayedTupleDigest: 'a'.repeat(64),
  };

  it('accepts BEGIN and rejects an unknown phase or bad digest/challenge syntax', () => {
    expect(decodeS5Seam12Payload('CONFIRM_S5_PAGE_GROUP', V, begin).ok).toBe(true);
    expect(decodeS5Seam12Payload('CONFIRM_S5_PAGE_GROUP', V, { ...begin, phase: 'MAYBE' }).ok).toBe(false);
    expect(decodeS5Seam12Payload('CONFIRM_S5_PAGE_GROUP', V, { ...begin, displayedTupleDigest: 'XYZ' }).ok).toBe(false);
    expect(
      decodeS5Seam12Payload('CONFIRM_S5_PAGE_GROUP', V, {
        ...begin,
        phase: 'COMMIT',
        confirmationChallenge: 'short',
      }).ok,
    ).toBe(false);
    expect(
      decodeS5Seam12Payload('CONFIRM_S5_PAGE_GROUP', V, {
        ...begin,
        phase: 'COMMIT',
        confirmationChallenge: 'A'.repeat(24),
      }).ok,
    ).toBe(true);
  });

  it('bounds selectedMemberIds (nonempty, unique, id charset)', () => {
    expect(decodeS5Seam12Payload('CONFIRM_S5_PAGE_GROUP', V, { ...begin, selectedMemberIds: [] }).ok).toBe(false);
    expect(
      decodeS5Seam12Payload('CONFIRM_S5_PAGE_GROUP', V, {
        ...begin,
        selectedMemberIds: ['s5m-1', 's5m-1'],
      }).ok,
    ).toBe(false);
    expect(
      decodeS5Seam12Payload('CONFIRM_S5_PAGE_GROUP', V, {
        ...begin,
        selectedMemberIds: ['not an id!'],
      }).ok,
    ).toBe(false);
  });
});

describe('decodeS5Seam12Payload: EXECUTE closed shape', () => {
  it('accepts the exact pair and rejects unknown/missing fields', () => {
    const payload = { snapshotId: 'snapshot-s5-abc', confirmedGroupId: 's5group:c:s' };
    expect(decodeS5Seam12Payload('EXECUTE_S5_COLLECTION', V, payload).ok).toBe(true);
    expect(decodeS5Seam12Payload('EXECUTE_S5_COLLECTION', V, { ...payload, phase: 'BEGIN' }).ok).toBe(false);
    expect(decodeS5Seam12Payload('EXECUTE_S5_COLLECTION', V, { snapshotId: 's' }).ok).toBe(false);
  });
});

describe('canonical digests', () => {
  it('derives deterministically and order-sensitively', () => {
    const a = s5GroupTupleDigest({ pageOrigin: PAGE, provenanceKey: 'p', hrefs: [HREF(1), HREF(2)] });
    const b = s5GroupTupleDigest({ pageOrigin: PAGE, provenanceKey: 'p', hrefs: [HREF(1), HREF(2)] });
    const c = s5GroupTupleDigest({ pageOrigin: PAGE, provenanceKey: 'p', hrefs: [HREF(2), HREF(1)] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/u);

    const s1 = s5SelectionTupleDigest({
      contractId: 'c',
      snapshotId: 's',
      prepareId: 'p',
      selectedMemberIds: ['a', 'b'],
    });
    const s2 = s5SelectionTupleDigest({
      contractId: 'c',
      snapshotId: 's',
      prepareId: 'p',
      selectedMemberIds: ['b', 'a'],
    });
    expect(s1).not.toBe(s2);
  });
});
