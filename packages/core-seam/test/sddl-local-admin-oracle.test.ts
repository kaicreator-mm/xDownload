import { describe, expect, it } from 'vitest';
import { hasExactExpectedUserAce } from './sddl-local-admin-oracle.ts';

const LOCAL_ADMIN = 'S-1-5-21-111-222-333-500';
const DOMAIN_ADMIN = 'S-1-5-21-444-555-666-500';
const ORDINARY = 'S-1-5-21-111-222-333-1001';
const LA_ONLY = 'D:(A;;GA;;;SY)(A;;GA;;;LA)';

describe('Windows LA SID alias must refer to the exact local machine principal', () => {
  it('allows LA for OS-resolved local Administrator full SID', () => {
    expect(hasExactExpectedUserAce(LA_ONLY, LOCAL_ADMIN, LOCAL_ADMIN)).toBe(true);
  });

  it('rejects same RID500 from another domain/machine even if LA is present', () => {
    expect(hasExactExpectedUserAce(LA_ONLY, DOMAIN_ADMIN, LOCAL_ADMIN)).toBe(false);
  });

  it('rejects non-admin user even when LA is allowed in SDDL', () => {
    expect(hasExactExpectedUserAce(LA_ONLY, ORDINARY, LOCAL_ADMIN)).toBe(false);
  });

  it('fails closed if local machine Administrator SID is not OS-resolved', () => {
    expect(hasExactExpectedUserAce(LA_ONLY, LOCAL_ADMIN, undefined)).toBe(false);
  });

  it('fails closed on a nonmachine SID or an inconsistent resolved principal', () => {
    expect(hasExactExpectedUserAce(LA_ONLY, LOCAL_ADMIN, DOMAIN_ADMIN)).toBe(false);
    expect(hasExactExpectedUserAce(LA_ONLY, LOCAL_ADMIN, ORDINARY)).toBe(false);
    expect(hasExactExpectedUserAce(LA_ONLY, LOCAL_ADMIN, 'S-1-5-32-544')).toBe(false);
  });

  it('accepts exact numeric user ACE without requiring a local Administrator lookup', () => {
    const literal = `D:(A;;GA;;;SY)(A;;GA;;;${DOMAIN_ADMIN})`;
    expect(hasExactExpectedUserAce(literal, DOMAIN_ADMIN, undefined)).toBe(true);
    expect(hasExactExpectedUserAce(literal, LOCAL_ADMIN, undefined)).toBe(false);
  });

  it('rejects unsound expected SID strings', () => {
    expect(hasExactExpectedUserAce(LA_ONLY, 'S-1-5-21-333-500', LOCAL_ADMIN)).toBe(false);
    expect(hasExactExpectedUserAce(LA_ONLY, 'LA', LOCAL_ADMIN)).toBe(false);
  });
});
