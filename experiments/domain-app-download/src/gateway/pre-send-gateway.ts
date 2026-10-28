/**
 * xDownload #183 PoC — trusted pre-send gateway (N08).
 *
 * Upstream #1437: malformed stable-Case input can be rejected only INSIDE the
 * Kernel effect path, after the Effect Journal row was reserved, poisoning the
 * stable identity for a later valid attempt. v0.10.3 does not fix this, so the
 * trusted Host application validates the FULL confirmed request — schema,
 * identity, source/targetRef, output root and operation scope — here, BEFORE
 * `DomainApp.send` is ever called. A rejected request must yield
 * sendCallCount === 0 and zero Effect Journal rows; the same stable identity
 * may then be lawfully re-used by a valid request.
 *
 * This gateway validates; it never repairs, clears or retries anything.
 */

export interface ConfirmedDownloadRequest {
  readonly requestId: string;
  readonly url: string;
  readonly expectedSha256: string;
  readonly expectedTotalBytes: number;
  readonly allowedHost: string;
  readonly outputRoot: string;
}

export type GatewayDecision =
  | { readonly accepted: true; readonly request: ConfirmedDownloadRequest }
  | { readonly accepted: false; readonly code: string; readonly message: string };

const REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class PreSendGateway {
  /** Public transport counter: physical `send` calls issued through it. */
  sendCallCount = 0;

  constructor(
    private readonly allowedHosts: readonly string[],
    private readonly outputRoot: string,
  ) {}

  /** Seal a user/recipe/browser-proposed request into the confirmed scope. */
  validate(proposed: unknown): GatewayDecision {
    if (typeof proposed !== "object" || proposed === null || Array.isArray(proposed)) {
      return { accepted: false, code: "GATEWAY_SCHEMA", message: "request must be a plain object" };
    }
    const record = proposed as Record<string, unknown>;
    const allowedKeys = [
      "requestId",
      "url",
      "expectedSha256",
      "expectedTotalBytes",
      "allowedHost",
      "outputRoot",
    ];
    for (const key of Object.keys(record)) {
      if (!allowedKeys.includes(key)) {
        return { accepted: false, code: "GATEWAY_UNKNOWN_FIELD", message: `unexpected field: ${key}` };
      }
    }
    const requestId = record.requestId;
    if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) {
      return {
        accepted: false,
        code: "GATEWAY_IDENTITY",
        message: "requestId must match ^[a-z0-9][a-z0-9-]{0,63}$",
      };
    }
    const url = record.url;
    if (typeof url !== "string") {
      return { accepted: false, code: "GATEWAY_SOURCE", message: "url must be a string" };
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { accepted: false, code: "GATEWAY_SOURCE", message: "url is not an absolute URI" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { accepted: false, code: "GATEWAY_SOURCE", message: `refused protocol: ${parsed.protocol}` };
    }
    if (parsed.protocol === "http:" && !isLoopbackHost(parsed.host)) {
      return {
        accepted: false,
        code: "GATEWAY_SOURCE",
        message: "plain http is only permitted for loopback fixtures",
      };
    }
    const allowedHost = record.allowedHost;
    if (typeof allowedHost !== "string" || allowedHost !== parsed.host) {
      return {
        accepted: false,
        code: "GATEWAY_SCOPE_HOST",
        message: "allowedHost must equal the url host (confirmed scope is not widenable)",
      };
    }
    if (!this.allowedHosts.includes(parsed.host)) {
      return {
        accepted: false,
        code: "GATEWAY_SCOPE_HOST",
        message: `host ${parsed.host} is outside the confirmed allow-list`,
      };
    }
    const expectedSha256 = record.expectedSha256;
    if (typeof expectedSha256 !== "string" || !SHA256_PATTERN.test(expectedSha256)) {
      return {
        accepted: false,
        code: "GATEWAY_DIGEST",
        message: "expectedSha256 must be lowercase 64-hex",
      };
    }
    const expectedTotalBytes = record.expectedTotalBytes;
    if (
      typeof expectedTotalBytes !== "number" ||
      !Number.isFinite(expectedTotalBytes) ||
      expectedTotalBytes <= 0 ||
      expectedTotalBytes > 1048576
    ) {
      return {
        accepted: false,
        code: "GATEWAY_SIZE",
        message: "expectedTotalBytes must be a finite byte count in (0, 1048576]",
      };
    }
    const outputRoot = record.outputRoot;
    if (typeof outputRoot !== "string" || outputRoot !== this.outputRoot) {
      return {
        accepted: false,
        code: "GATEWAY_SCOPE_ROOT",
        message: "outputRoot must equal the configured authorized root",
      };
    }
    return {
      accepted: true,
      request: {
        requestId,
        url,
        expectedSha256,
        expectedTotalBytes,
        allowedHost,
        outputRoot,
      },
    };
  }

  /** The only path that issues a physical Kernel send through this gateway. */
  async send(runtime: { send: (intent: unknown) => Promise<unknown> }, confirmed: ConfirmedDownloadRequest) {
    this.sendCallCount += 1;
    return runtime.send({
      intentType: "confirmDownload",
      instanceKey: `download-${confirmed.requestId}`,
      messageId: `msg-${confirmed.requestId}`,
      input: {
        requestId: confirmed.requestId,
        url: confirmed.url,
        expectedSha256: confirmed.expectedSha256,
        expectedTotalBytes: confirmed.expectedTotalBytes,
        allowedHost: confirmed.allowedHost,
        outputRoot: confirmed.outputRoot,
      },
    });
  }
}

function isLoopbackHost(host: string): boolean {
  const hostname = host.split(":")[0] ?? "";
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}
