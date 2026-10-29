/**
 * T010 broker-test fixtures. Deterministic clock seam and a canonical exact
 * binding tuple; every negative case derives from this base by single-field
 * mutation (binding-matrix discipline from the T010 Reference Pack §1.1).
 */

import type { AuthBroker } from '../src/index.ts';
import { createAuthBroker, type CapabilityBinding } from '../src/index.ts';

export interface TestClock {
  readonly nowMs: () => number;
  advanceMs: (delta: number) => void;
  readonly current: () => number;
}

export function fixedClock(startMs = 1_000_000): TestClock {
  let now = startMs;
  return {
    nowMs: () => now,
    advanceMs: (delta) => {
      now += delta;
    },
    current: () => now,
  };
}

/** Canonical exact binding used for issue and the matching use. */
export const BASE_BINDING: CapabilityBinding = {
  origin: 'https://media.example.org',
  target: 'target-file-001',
  contract: 'contract-001',
  snapshot: 'snapshot-001',
  provenanceChain: 'tab-1/frame-0/https://media.example.org/req-0042',
  partition: 'partition-A',
  requestedScopeKey: 'entire_supported_collection:collection/playlist-001',
};

export const ISSUE_DECISION = 'user-confirm:selection-001' as const;
export const REISSUE_DECISION = 'explicit-reissue:operator-001' as const;

export function brokerWith(clock: TestClock): AuthBroker {
  return createAuthBroker({ clock, brokerScope: 'authctx/test' });
}

export const ALLOWED_EXTENSION_ORIGIN = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
export const OTHER_EXTENSION_ORIGIN = 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/';
