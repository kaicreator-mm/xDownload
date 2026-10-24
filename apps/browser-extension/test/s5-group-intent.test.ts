import { describe, expect, it } from 'vitest';
import {
  decodeS5PageGroupGesture,
  isS5PageGroupGesture,
} from '../src/background/s5-group-intent.ts';

const valid = {
  kind: 'S5_PREPARE_CURRENT_PAGE_GROUP',
  tabId: 42,
  pageUrl: 'https://publisher.example.org/list.html',
  observedMemberCount: 2,
  members: [
    { href: 'https://publisher.example.org/media/a.mp4', text: 'A' },
    { href: 'https://cdn.example.net/media/b.mp4', text: 'B' },
  ],
};

describe('#152 shipped-popup untrusted S5 group gesture (not Core authority)', () => {
  it('decodes only a unique bounded current-page observed member set', () => {
    const result = decodeS5PageGroupGesture(valid);
    expect(result).toMatchObject({ ok: true, value: valid });
    expect(isS5PageGroupGesture(valid)).toBe(true);
  });

  it.each([
    null,
    'not a message',
    {},
    { ...valid, kind: 'S5_DOWNLOAD_WITHOUT_CORE' },
    { ...valid, extraAuthority: 'force-complete' },
    { ...valid, observedMemberCount: 3 },
    { ...valid, observedMemberCount: 1 },
    { ...valid, members: [] },
    { ...valid, members: [valid.members[0], valid.members[0]] },
    { ...valid, members: Array.from({ length: 21 }, (_, i) => ({
      href: 'https://publisher.example.org/file' + i,
      text: 'x',
    })), observedMemberCount: 21 },
    { ...valid, tabId: -1 },
    { ...valid, tabId: 3.5 },
    { ...valid, pageUrl: 'file:///etc/passwd' },
    { ...valid, pageUrl: 'https://alice:secret@publisher.example.org/list.html' },
    { ...valid, pageUrl: 'https://publisher.example.org/list.html?token=private' },
    { ...valid, members: [{ href: 'https://publisher.example.org/a.mp4', text: 'a', cookie: 'secret' }] },
    { ...valid, members: [{ href: 'javascript:alert(1)', text: 'a' }] },
    { ...valid, members: [{ href: 'https://cdn.example.net/file.mp4?auth=secret', text: 'a' }] },
    { ...valid, members: [{ href: 'https://publisher.example.org/a.mp4', text: 'x'.repeat(257) }] },
  ])('rejects malformed/privilege-confusing untrusted S5 group messages: %#', (bad) => {
    expect(decodeS5PageGroupGesture(bad).ok).toBe(false);
  });

  it('refuses accessor-throwing or prototype-bearing input without effect', () => {
    const crafted = { ...valid, get members(): never { throw new Error('getter'); } };
    expect(decodeS5PageGroupGesture(crafted).ok).toBe(false);
    expect(decodeS5PageGroupGesture(new Date()).ok).toBe(false);
    expect(isS5PageGroupGesture(Object.create(null))).toBe(false);
  });
});
