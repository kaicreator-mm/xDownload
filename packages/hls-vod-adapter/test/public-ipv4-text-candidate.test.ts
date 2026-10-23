import { describe, expect, it } from 'vitest';
import { parsePublicIpv4TextCandidate } from '../src/public-ipv4-text-candidate.ts';

describe('S4 v0.1 IPv4 text candidates (NOT network authorization)', () => {
  it.each(['1.1.1.1', '8.8.8.8', '9.9.9.9', '93.184.216.34', '45.8.8.8'])(
    'keeps one canonical syntactic candidate: %s',
    (address) => {
      const result = parsePublicIpv4TextCandidate(address);
      expect(result).toEqual({ address, family: 4 });
      expect(Object.isFrozen(result)).toBe(true);
      expect(result).not.toHaveProperty('allowed');
      expect(result).not.toHaveProperty('tlsPeer');
      expect(result).not.toHaveProperty('authorized');
    },
  );

  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '127.255.255.255',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.9',
    '192.0.2.1',
    '192.31.196.1',
    '192.52.193.1',
    '192.88.99.1',
    '192.168.1.1',
    '192.175.48.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.5',
    '203.0.113.1',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
  ])('rejects special, private or reserved IPv4: %s', (value) => {
    expect(parsePublicIpv4TextCandidate(value)).toBeUndefined();
  });

  it.each([
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2001:db8::1',
    '2002:808:808::',
    '2606:4700:4700::1111',
    '[::ffff:127.0.0.1]',
  ])('fails closed for all IPv6, including mapped and tunnel forms: %s', (value) => {
    expect(parsePublicIpv4TextCandidate(value)).toBeUndefined();
  });

  it.each([
    '001.001.001.001',
    '8.08.8.8',
    '8.8.8.008',
    '0x08080808',
    '134744072',
    '010.010.010.010',
    '8.8.8',
    '8.8.8.8.',
    '8.8.8.8:443',
    ' 8.8.8.8',
    '8.8.8.8\n',
    '8.8.8.256',
    '999.1.1.1',
    '8.8.8.-1',
    '8.8.8.8/32',
    '8.8.8.8\u0000',
    'localhost',
    'metadata.google.internal',
    '',
  ])('rejects ambiguous, alternate or non-IP address strings: %s', (value) => {
    expect(parsePublicIpv4TextCandidate(value)).toBeUndefined();
  });

  it('refuses malformed non-string DNS answers', () => {
    for (const value of [null, undefined, {}, [], 0, 1, true, new Uint8Array([8, 8, 8, 8])]) {
      expect(parsePublicIpv4TextCandidate(value)).toBeUndefined();
    }
  });

  it('keeps exact conservative CIDR boundaries without a DNS or socket call', () => {
    expect(parsePublicIpv4TextCandidate('100.63.255.255')).toBeDefined();
    expect(parsePublicIpv4TextCandidate('100.64.0.0')).toBeUndefined();
    expect(parsePublicIpv4TextCandidate('100.128.0.0')).toBeDefined();
    expect(parsePublicIpv4TextCandidate('172.15.255.255')).toBeDefined();
    expect(parsePublicIpv4TextCandidate('172.16.0.0')).toBeUndefined();
    expect(parsePublicIpv4TextCandidate('172.32.0.0')).toBeDefined();
    expect(parsePublicIpv4TextCandidate('198.17.255.255')).toBeDefined();
    expect(parsePublicIpv4TextCandidate('198.18.0.0')).toBeUndefined();
    expect(parsePublicIpv4TextCandidate('198.20.0.0')).toBeDefined();
  });
});
