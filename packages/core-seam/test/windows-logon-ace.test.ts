/** #150 Windows TOKEN_GROUPS unsigned-DWORD logon ACE regression. */
import { describe, expect, it } from 'vitest';
import { hasWindowsLogonGroupAttributes } from '../src/win-ipc.ts';

describe('#150 required Windows logon SID ACE unsigned group flags', () => {
  it('recognizes the real host 0xC0000007 logon group DWORD', () => {
    expect(hasWindowsLogonGroupAttributes(0xc0000007)).toBe(true);
    expect(hasWindowsLogonGroupAttributes(0xc0000000)).toBe(true);
    // Previous signed Int32 comparison always returned false for this bit.
    expect((0xc0000007 & 0xc0000000) === 0xc0000000).toBe(false);
  });

  it.each([
    0, 7, 0x80000007, 0x40000007, 0x00000007,
    -1073741817, -1, 0x1c0000007, Number.NaN, Infinity,
  ])('rejects incomplete, negative, overflow and invalid flags: %s', (flags) => {
    expect(hasWindowsLogonGroupAttributes(flags)).toBe(false);
  });
});