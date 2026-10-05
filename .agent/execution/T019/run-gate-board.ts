/**
 * T019 gate status board runner — evidence-only tooling (never shipped).
 *
 * Imports the T003 version-validation gate machinery exactly as merged on the
 * candidate and records its output verbatim:
 *   1. gateStatusBoard() — the standing board, recorded as emitted.
 *   2. evaluateGate() on non-evidence inputs — recorded as-is to demonstrate
 *      honest machinery behavior on the candidate (no fabricated evidence,
 *      no manual status promotion).
 * Writes .agent/execution/T019/gate-board.json (evidence only).
 */
import fs from 'node:fs';
import { GATE_DEFINITIONS, evaluateGate, gateStatusBoard } from '../../../packages/version-validation/src/gates.ts';

const board = gateStatusBoard();
const probe = (label, input) => {
  try {
    const r = evaluateGate(input);
    return {
      probe: label,
      ok: r.ok,
      value: r.ok
        ? { gateId: r.value.gateId, result: r.value.result, diagnostics: r.value.diagnostics }
        : undefined,
      error: r.ok ? undefined : JSON.parse(JSON.stringify(r.error)),
    };
  } catch (e) {
    return { probe: label, threw: String(e && e.message ? e.message : e) };
  }
};

const out = {
  suite: 'g0-g1-gate-status-board',
  executedAt: new Date().toISOString(),
  candidateHead: null, // filled below
  definitions: GATE_DEFINITIONS.map((g) => ({
    gateId: g.gateId,
    title: g.title,
    prdRef: g.prdRef,
    applicability: g.applicability,
    metrics: g.metrics.map((m) => m.metric),
  })),
  statusBoard: board.map((e) => ({ ...e })),
  probes: [
    probe('evaluateGate-undefined', undefined),
    probe('evaluateGate-empty-object', {}),
  ],
};

import cp from 'node:child_process';
out.candidateHead = cp.execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();

const dst = new URL('./gate-board.json', import.meta.url);
fs.writeFileSync(dst, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
