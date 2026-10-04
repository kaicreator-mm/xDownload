/**
 * T014 suite: Core-disconnect behavior.
 *
 * TEST_MATRIX `core-disconnect-behavior`:
 * - seam unavailability presents an explicit degraded/disconnected state with
 *   no fabricated progress/status/completion;
 * - reconnect/re-entry restores the UI from Core projections without
 *   UI-local durable truth.
 */

import { describe, expect, it } from 'vitest';
import {
  confirmSingleResourceTask,
  coreProjection,
  desktopAdapter,
  projectionPayloadScript,
  scriptedTransport,
  sectionLines,
  startCore,
} from './helpers.ts';
import { createDesktopUiAdapter, verifyProjectionPayload } from '../src/index.ts';
import { FIXED_NOW } from './helpers.ts';

describe('core disconnect behavior', () => {
  it('seam unavailability presents an explicit degraded state with no fabricated progress', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    const liveText = adapter.currentDisplayText();

    // Core goes away.
    await core.stop();

    const degraded = await adapter.refresh();
    expect(degraded.display.connection).toBe('DISCONNECTED');
    expect(degraded.display.screen).toBe('task-status');
    const banner = sectionLines(degraded.display, 'Connection').join('\n');
    expect(banner).toContain('DEGRADED: Core is disconnected');
    expect(banner).toContain('no live progress, status or completion');
    // No new status appeared: the display holds the last known Core state only.
    expect(degraded.display.sections.some((s) => s.title.startsWith('Result explanation'))).toBe(
      outcome.display.sections.some((s) => s.title.startsWith('Result explanation')),
    );
    expect(adapter.currentDisplayText()).not.toBe('');
    expect(liveText).not.toContain('DEGRADED');
    await adapter.close();
  });

  it('commands are not fabricated as accepted while Core is disconnected; nothing is routed locally', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const outcome = await confirmSingleResourceTask(adapter);
    const routesBefore = adapter.lastRouted().length;
    const projectionBefore = coreProjection(core, outcome.routed[0]?.aggregateId ?? '');
    await core.stop();

    const failed = await adapter.cancel();
    expect(failed.display.connection).toBe('DISCONNECTED');
    // The cancel attempt is recorded as routed-then-lost, never as accepted:
    // no CANCELLED state appears in the display.
    expect(sectionLines(failed.display, 'Selection / progress')).not.toContain(
      'lineage status: CANCELLED',
    );
    expect(failed.display.sections.some((s) => s.title.startsWith('Core rejections'))).toBe(false);
    expect(adapter.lastRouted().length).toBe(routesBefore + 1);
    expect(projectionBefore?.lineage.status).toBe('ACTIVE');
    await adapter.close();
  });

  it('reconnect/re-entry restores the UI from Core projections without UI-local durable truth', async () => {
    const firstCore = await startCore();
    const adapter = desktopAdapter(firstCore);
    const outcome = await confirmSingleResourceTask(adapter);
    const contractId = outcome.routed[0]?.aggregateId ?? '';
    await firstCore.stop();

    const degraded = await adapter.refresh();
    expect(degraded.display.connection).toBe('DISCONNECTED');

    // Core restarts (new endpoint). The adapter re-binds and re-enters: all
    // displayed state after re-entry comes from the restarted Core's
    // projections, never from UI-local durable state.
    const restartedCore = await startCore();
    adapter.rebindTarget(restartedCore.target);
    const restored = await confirmSingleResourceTask(adapter);
    expect(restored.rejections).toStrictEqual([]);
    expect(restored.display.connection).toBe('CONNECTED');
    expect(sectionLines(restored.display, 'Connection').join('\n')).not.toContain('DEGRADED');
    expect(sectionLines(restored.display, 'Selection / progress')).toContain(
      'lineage status: ACTIVE',
    );

    // The pre-restart aggregate shows only its LAST-KNOWN Core state (read
    // before the restart); nothing is fabricated on top of it.
    adapter.viewAggregate(contractId);
    const staleView = adapter.currentDisplay();
    expect(sectionLines(staleView, 'Contract').find((l) => l.startsWith('projection'))).toContain(
      'revision 1',
    );
    expect(sectionLines(staleView, 'Selection / progress')).toContain('lineage status: ACTIVE');
    await adapter.close();
    await restartedCore.stop();
  });

  it('a projection that fails verification degrades instead of rendering unverified data', async () => {
    const adapter = createDesktopUiAdapter({
      transport: scriptedTransport(
        projectionPayloadScript({ garbage: true, terminal: { requestFulfillment: 'COMPLETE' } }),
      ),
      target: { host: '127.0.0.1', port: 1 },
      installId: 'install-001',
      userId: 'user-001',
      now: () => FIXED_NOW,
    });
    // Attach directly to an aggregate id; the scripted wire returns garbage.
    const outcome = await adapter.attachAggregate('contract-desktop-000001');
    expect(outcome.display.connection).toBe('UNPARSEABLE_PROJECTION');
    const banner = sectionLines(outcome.display, 'Connection').join('\n');
    expect(banner).toContain('DEGRADED: the latest projection failed verification');
    expect(banner).toContain('no status is shown from unverified data');
    // No fabricated result section from the garbage payload.
    expect(outcome.display.sections.some((s) => s.title.startsWith('Result explanation'))).toBe(
      false,
    );
    await adapter.close();
  });

  it('a rejected projection read degrades with a faithful rejected label, never a stale-projection claim (T014-REV-P2-2)', async () => {
    const core = await startCore();
    const adapter = desktopAdapter(core);
    const done = await confirmSingleResourceTask(adapter);
    const contractId = done.routed[0]?.aggregateId ?? '';
    // Pointing the view at an aggregate this surface does not know refuses.
    const switched = adapter.viewAggregate('contract-does-not-exist');
    expect(switched.refusals[0]).toContain('unknown aggregate');

    // A projection read Core REJECTS (unknown aggregate → AGGREGATE_NOT_FOUND)
    // is exactly that: a rejected read. The degraded state is labeled
    // faithfully — it never claims the last projection is "stale".
    const rejected = await adapter.attachAggregate('contract-does-not-exist');
    expect(rejected.display.connection).toBe('REJECTED_PROJECTION');
    const banner = sectionLines(rejected.display, 'Connection').join('\n');
    expect(banner).toContain('DEGRADED: Core rejected the last projection read');
    expect(banner).not.toContain('stale');
    // The typed rejection is surfaced verbatim on the outcome; nothing
    // renders from it.
    expect(rejected.rejections.map((r) => r.code)).toContain('AGGREGATE_NOT_FOUND');

    // The known aggregate stays healthy: re-viewing and re-reading it
    // restores CONNECTED.
    adapter.viewAggregate(contractId);
    const refreshed = await adapter.refresh();
    expect(refreshed.refusals).toStrictEqual([]);
    expect(refreshed.display.connection).toBe('CONNECTED');
    await adapter.close();
    await core.stop();
  });

  it('projection verification rejects wire payloads that do not bind the addressed aggregate', () => {
    const payload = {
      schemaIdentity: { schema: 'xdownload.domain-contracts', version: '1.0.0' },
      contract: {
        contractId: 'contract-other-999',
        status: 'CONFIRMED',
        intentType: 'SINGLE_RESOURCE',
        revision: 3,
      },
      lineage: { status: 'ACTIVE', failedMemberCount: 0, retriedMemberIds: [] },
    };
    const verified = verifyProjectionPayload(payload, 'contract-desktop-000001');
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.reason).toBe('PROJECTION_AGGREGATE_BINDING_MISMATCH');
    }
  });
});
