// evals/sarvam/report.ts
// A finished run as people and the database read it: the summary table printed after a run, and
// the row stored for the dashboard's Evals page. Fake eval data only.
import type { StoredRun } from './eval-db.ts';
import type { GateSummary } from './gate.ts';
import type { CaseResult } from './types.ts';

export interface RunInfo {
  /** "asha" or "brain": what was tested. */
  readonly target: string;
  readonly promptHash: string;
  /** Where the verdicts came from, e.g. "sarvam-tests" or "code-checks". */
  readonly kind: string;
  /** Agent, version and Sarvam ids, or model names: whatever identifies what ran. */
  readonly detail: Readonly<Record<string, string | number>>;
}

function failuresOf(result: CaseResult): string {
  const judged = result.verdicts
    .filter((verdict) => !verdict.passed)
    .map((verdict) => verdict.name);
  const checked = result.checks
    .filter((check) => !check.passed)
    .map((check) => `${check.id}: ${check.detail}`);
  const none = result.verdicts.length === 0 ? ['no verdicts returned'] : [];
  return [...none, ...judged, ...checked].join('; ');
}

export function formatTable(results: readonly CaseResult[], summary: GateSummary): string {
  const rows = results.map((result) =>
    `${result.passed ? 'PASS' : 'FAIL'}  ${result.id.padEnd(9)} ${result.name.padEnd(36)} ${failuresOf(
      result,
    )}`.trimEnd(),
  );
  const gate = summary.passed ? 'GATE PASSED' : `GATE FAILED: ${summary.reasons.join('; ')}`;
  return [
    ...rows,
    '',
    `Cases ${summary.casesPassed}/${summary.cases} · behaviours ${summary.behavioursPassed}/` +
      `${summary.behaviours} · guardrail failures ${summary.guardrailFailures} · critical check ` +
      `failures ${summary.criticalFailures} · other check failures ${summary.otherCheckFailures}`,
    gate,
    '',
  ].join('\n');
}

function transcriptText(result: CaseResult): string {
  return result.transcript.map((turn) => `${turn.role}: ${turn.content}`).join('\n');
}

export function toStoredRun(
  info: RunInfo,
  results: readonly CaseResult[],
  summary: GateSummary,
): StoredRun {
  return {
    target: info.target,
    promptHash: info.promptHash,
    metrics: { kind: info.kind, ...info.detail, ...summary },
    results: results.map((result) => ({
      scenarioId: result.id,
      scores: {
        name: result.name,
        category: result.category,
        verdicts: result.verdicts,
        checks: result.checks,
      },
      transcript: transcriptText(result),
      pass: result.passed,
    })),
  };
}
