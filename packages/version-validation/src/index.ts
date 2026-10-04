/**
 * @xdownload/version-validation — T003 version-validation harness, corpora
 * and gate instrumentation.
 *
 * Reusable, deterministic, offline-runnable validation infrastructure for
 * v0.1.0: frozen PRD §33 corpora registries, C01–C34 counterexample oracle
 * corpus (PRD §35), G0BaselinePlan pre-registration (PRD §32.2 R03),
 * §32.1 denominator/UNKNOWN/abandonment accounting, CJ-01..CJ-09 journey
 * harness definitions (PRD §31), G0/G1 gate instrumentation (PRD §32) and
 * exact-subject evidence capture/formatting (PRD §20–§22).
 *
 * Binding discipline: every corpus/oracle/plan/journey record binds the
 * canonical identities and result semantics of `@xdownload/domain-contracts`
 * (T002). Nothing here claims a Product gate PASS: all gate/oracle execution
 * remains NOT_RUN on the T003 candidate.
 */

export * from './identity.ts';
export * from './canonical-json.ts';
export * from './canonical-probe.ts';
export * from './truth-source.ts';
export * from './fixtures.ts';
export * from './corpora.ts';
export * from './corpus-data.ts';
export * from './oracles.ts';
export * from './oracle-corpus.ts';
export * from './journeys.ts';
export * from './journey-data.ts';
export * from './g0-plan.ts';
export * from './denominator.ts';
export * from './gates.ts';
export * from './evidence-capture.ts';
