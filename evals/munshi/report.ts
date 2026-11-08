// evals/munshi/report.ts
// The pass rule, summary table and results file of Munshi's text evals (M8 test list "Pass"):
// every critical check passes in every scenario, the other checks pass in all but at most one
// scenario, every scenario was judged, and the judge's casual average is at least 4.0.
import type { ScenarioResult } from './runner.ts';

export const MIN_CASUAL_AVERAGE = 4.0;
/** "non-critical ≥ 14/15": scenarios allowed a non-critical miss. */
export const NON_CRITICAL_MISSES_ALLOWED = 1;

export interface EvalSummary {
  readonly scenarios: number;
  readonly criticalFailed: readonly string[];
  readonly nonCriticalFailed: readonly string[];
  readonly judged: number;
  readonly casualAverage: number | null;
  readonly languageAverage: number | null;
  readonly clarityAverage: number | null;
  readonly munshiCalls: number;
  readonly munshiPromptChars: number;
  readonly passed: boolean;
  readonly reasons: readonly string[];
}

function failed(result: ScenarioResult, critical: boolean): boolean {
  return result.checks.some((check) => check.critical === critical && !check.passed);
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(mean * 100) / 100;
}

function reasonsOf(summary: Omit<EvalSummary, 'passed' | 'reasons'>): readonly string[] {
  const reasons: string[] = [];
  if (summary.criticalFailed.length > 0)
    reasons.push(`critical check failed in ${summary.criticalFailed.join(', ')}`);
  if (summary.nonCriticalFailed.length > NON_CRITICAL_MISSES_ALLOWED) {
    reasons.push(
      `other checks failed in ${summary.nonCriticalFailed.length} scenarios (max ${NON_CRITICAL_MISSES_ALLOWED})`,
    );
  }
  if (summary.judged < summary.scenarios)
    reasons.push(`judged ${summary.judged} of ${summary.scenarios}`);
  if (summary.casualAverage === null || summary.casualAverage < MIN_CASUAL_AVERAGE) {
    reasons.push(`casual average ${summary.casualAverage ?? '-'} < ${MIN_CASUAL_AVERAGE}`);
  }
  return reasons;
}

export function summarise(results: readonly ScenarioResult[]): EvalSummary {
  const judged = results.flatMap((result) => (result.judge ? [result.judge] : []));
  const base = {
    scenarios: results.length,
    criticalFailed: results.filter((result) => failed(result, true)).map((result) => result.id),
    nonCriticalFailed: results.filter((result) => failed(result, false)).map((result) => result.id),
    judged: judged.length,
    casualAverage: average(judged.map((scores) => scores.casual)),
    languageAverage: average(judged.map((scores) => scores.language_match)),
    clarityAverage: average(judged.map((scores) => scores.clarity)),
    munshiCalls: results.reduce((sum, result) => sum + result.munshiCalls, 0),
    munshiPromptChars: results.reduce((sum, result) => sum + result.munshiPromptChars, 0),
  };
  const reasons = reasonsOf(base);
  return { ...base, passed: reasons.length === 0, reasons };
}

function cell(text: string, width: number): string {
  return text.length >= width ? `${text.slice(0, width - 1)} ` : text.padEnd(width);
}

function row(result: ScenarioResult): string {
  const critical = result.checks.filter((check) => check.critical);
  const other = result.checks.filter((check) => !check.critical);
  const passedOf = (checks: typeof critical): string =>
    `${checks.filter((check) => check.passed).length}/${checks.length}`;
  const scores = result.judge
    ? `${result.judge.casual} ${result.judge.language_match} ${result.judge.clarity}`
    : '- - -';
  const failures = result.checks
    .filter((check) => !check.passed)
    .map((check) => `${check.critical ? '!' : ''}${check.id}`);
  return [
    cell(result.id, 4),
    cell(result.title, 44),
    cell(result.language, 5),
    cell(result.end, 14),
    cell(String(result.tools.length), 6),
    cell(passedOf(critical), 9),
    cell(passedOf(other), 7),
    cell(scores, 8),
    failures.join(', ') || '-',
  ].join('');
}

/** A plain-text table: one row per scenario, then the verdict. "!" marks a critical failure. */
export function formatTable(results: readonly ScenarioResult[], summary: EvalSummary): string {
  const header = [
    cell('#', 4),
    cell('scenario', 44),
    cell('lang', 5),
    cell('end', 14),
    cell('tools', 6),
    cell('critical', 9),
    cell('other', 7),
    cell('c l cl', 8),
    'failed checks',
  ].join('');
  const verdict = summary.passed ? 'PASS' : `FAIL: ${summary.reasons.join('; ')}`;
  const averages = `judge averages (casual / language / clarity): ${summary.casualAverage ?? '-'} / ${summary.languageAverage ?? '-'} / ${summary.clarityAverage ?? '-'} (${summary.judged} judged)`;
  const size = `Munshi model calls: ${summary.munshiCalls}, prompt characters: ${summary.munshiPromptChars} (≈ ${Math.round(summary.munshiPromptChars / 4)} tokens at 4 characters per token)`;
  return [header, ...results.map(row), '', averages, size, verdict, ''].join('\n');
}

/** "2026-11-08.json", or "2026-11-08-2.json" … when that name is taken. */
export function resultFileName(date: string, taken: (name: string) => boolean): string {
  let name = `${date}.json`;
  for (let n = 2; taken(name); n += 1) name = `${date}-${n}.json`;
  return name;
}
