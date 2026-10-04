/**
 * T014 desktop display tree.
 *
 * The desktop adapter renders a deterministic, frozen plain-data display
 * tree. There is deliberately no widget framework at this stage: U9/ADR-012
 * leave the concrete desktop shell/renderer unfrozen, and T014 proves the
 * adapter with deterministic component/interaction tests, not visual
 * claims. A real renderer would map this tree 1:1 onto widgets; all
 * interaction semantics live in the adapter, not in the tree.
 *
 * Recorded F2 choices (all zero new runtime dependencies):
 * - component model: headless frozen display tree + adapter interaction
 *   methods (this file);
 * - test harness: vitest on the existing Node environment against the
 *   loopback seam transport — no DOM emulator, no renderer dependency.
 */

import { deepFreeze } from '@xdownload/domain-contracts';
import type { DesktopConnectionState } from './view-model.ts';

export interface DisplayLine {
  readonly label: string;
  readonly value: string;
  readonly note?: string;
}

export interface DisplaySection {
  readonly title: string;
  readonly lines: readonly DisplayLine[];
}

export interface SurfaceView {
  readonly screen: string;
  readonly connection: DesktopConnectionState;
  readonly sections: readonly DisplaySection[];
}

/** Deterministic text rendering of the display tree (for assertions). */
export function surfaceToText(view: SurfaceView): string {
  const parts: string[] = [`[${view.screen}]`, `connection=${view.connection}`];
  for (const section of view.sections) {
    parts.push(`# ${section.title}`);
    for (const line of section.lines) {
      let text = `${line.label}: ${line.value}`;
      if (line.note !== undefined) {
        text += ` (${line.note})`;
      }
      parts.push(text);
    }
  }
  return parts.join('\n');
}

export function section(title: string, lines: DisplayLine[]): DisplaySection {
  return { title, lines };
}

export function line(label: string, value: string, note?: string): DisplayLine {
  return note === undefined ? { label, value } : { label, value, note };
}

export function bannerLine(banner: string): DisplayLine {
  return { label: 'state', value: banner };
}

export function buildSurface(input: {
  readonly screen: string;
  readonly connection: DesktopConnectionState;
  readonly sections: readonly DisplaySection[];
}): SurfaceView {
  // Display trees are frozen read-only values: an interaction can rebuild a
  // tree, but nothing can mutate a rendered display in place.
  return deepFreeze({
    screen: input.screen,
    connection: input.connection,
    sections: input.sections.map((s) =>
      deepFreeze({ title: s.title, lines: s.lines.map((l) => deepFreeze({ ...l })) }),
    ),
  });
}
