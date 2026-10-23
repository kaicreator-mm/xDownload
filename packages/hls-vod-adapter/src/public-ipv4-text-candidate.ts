/**
 * S4 public VOD, IPv4-only *candidate* classifier for resolved address text.
 *
 * IMPORTANT: this is not an SSRF authorization, IANA-global-routing proof,
 * DNS resolver, or transport verifier. It cannot bind a DNS answer to the
 * actual remote TLS socket and must NEVER be used as an allow-to-fetch flag.
 * Core must independently approve the installed origin/playlist/redirect
 * graph, classify all resolved answers, and enforce exact connected-IP plus
 * certificate/SNI validation per request. Refuse if that is unavailable.
 *
 * This first public v0.1 subset refuses ALL IPv6 (including IPv4-mapped,
 * NAT64/6to4 and other transition forms) rather than making assumptions
 * about their routability. An approved transport may add IPv6 separately.
 */
export interface PublicIpv4TextCandidate {
  readonly address: string;
  readonly family: 4;
}

const BLOCKED_V4_CIDRS = [
  ['0.0.0.0', 8],        // current network / unspecified
  ['10.0.0.0', 8],       // RFC1918
  ['100.64.0.0', 10],    // shared carrier NAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link local
  ['172.16.0.0', 12],    // RFC1918
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.31.196.0', 24], // AS112 service
  ['192.52.193.0', 24], // AMT
  ['192.88.99.0', 24],  // deprecated 6to4 relay
  ['192.168.0.0', 16],  // RFC1918
  ['192.175.48.0', 24], // AS112 service
  ['198.18.0.0', 15],   // benchmark
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24],  // TEST-NET-3
  ['224.0.0.0', 4],     // multicast
  ['240.0.0.0', 4],     // reserved and broadcast
] as const;

function parseStrictIpv4(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(raw)) {
    return undefined;
  }
  const octets = raw.split('.');
  if (
    octets.length !== 4 ||
    octets.some(
      (part) =>
        (part.length > 1 && part.startsWith('0')) ||
        !Number.isSafeInteger(Number(part)) ||
        Number(part) > 255,
    )
  ) {
    return undefined;
  }
  const numbers = octets.map(Number);
  return (
    ((numbers[0]! << 24) |
      (numbers[1]! << 16) |
      (numbers[2]! << 8) |
      numbers[3]!) >>> 0
  );
}

function isInsideCidr(ip: number, network: number, bits: number): boolean {
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) >>> 0 === (network & mask) >>> 0;
}

/**
 * Decode only a canonical, non-special-use IPv4 address string from an
 * UNTRUSTED DNS answer or socket observation. Output is just a candidate.
 *
 * It deliberately fails closed for IPv6 and ambiguous/non-decimal IPv4;
 * actual public reachability and connected-socket IP cannot be inferred.
 */
export function parsePublicIpv4TextCandidate(raw: unknown): PublicIpv4TextCandidate | undefined {
  const ip = parseStrictIpv4(raw);
  if (ip === undefined) return undefined;

  for (const [network, bits] of BLOCKED_V4_CIDRS) {
    const subnet = parseStrictIpv4(network);
    if (subnet === undefined) return undefined; // never silently drop safety exclusions
    if (isInsideCidr(ip, subnet, bits)) return undefined;
  }
  return Object.freeze({ address: raw as string, family: 4 as const });
}
