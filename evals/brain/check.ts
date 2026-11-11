// evals/brain/check.ts
// Marks one brain answer right or wrong (M9 Build C2) and sums a run up. A message that must not
// become a command ("kind: null") passes with no command at all, or with the help menu: what it
// may never become is a card that moves money. Gate: every money case right, and at least 90%
// of all cases.
import type { Command } from '../../supabase/functions/_shared/brain/commands.ts';
import { type BrainCase, MONEY_KINDS } from './cases.ts';

export const MIN_PASS_RATE = 0.9;
/** What a "no command" message may still harmlessly become. */
const HARMLESS_KINDS: readonly string[] = ['help'];

export interface BrainAnswer {
  readonly command: Command | null;
  /** How it was understood: command (code), sarvam, gemini or failed. */
  readonly path: string;
}

export interface BrainResult {
  readonly id: string;
  readonly text: string;
  readonly money: boolean;
  readonly path: string;
  /** The command kind the brain gave, or "none". */
  readonly got: string;
  readonly passed: boolean;
  /** Empty when passed; otherwise what was wrong. */
  readonly detail: string;
}

export interface BrainSummary {
  readonly cases: number;
  readonly casesPassed: number;
  readonly moneyFailures: number;
  /** How many messages each path answered. */
  readonly paths: Readonly<Record<string, number>>;
  readonly passed: boolean;
  readonly reasons: readonly string[];
}

function field(command: Command, name: 'name' | 'amount'): string | number | null {
  const value = (command as Readonly<Record<string, unknown>>)[name];
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function problemWithNone(command: Command | null, readsAllowed: boolean): string | null {
  if (command === null || HARMLESS_KINDS.includes(command.kind)) return null;
  if (readsAllowed && !MONEY_KINDS.includes(command.kind)) return null;
  const moves = MONEY_KINDS.includes(command.kind) ? ' (a money card)' : '';
  return `expected no command, got ${command.kind}${moves}`;
}

function problemWith(evalCase: BrainCase, command: Command | null): string | null {
  const { kind, name, amount } = evalCase.expect;
  if (kind === null) return problemWithNone(command, evalCase.expect.readsAllowed === true);
  if (command === null) return `expected ${kind}, got no command`;
  if (command.kind !== kind) return `expected ${kind}, got ${command.kind}`;
  const gotName = field(command, 'name');
  if (name !== undefined && String(gotName ?? '').toLowerCase() !== name.toLowerCase()) {
    return `expected name ${name}, got ${String(gotName)}`;
  }
  const gotAmount = field(command, 'amount');
  if (amount !== undefined && gotAmount !== amount) {
    return `expected amount ${amount}, got ${String(gotAmount)}`;
  }
  return null;
}

export function checkAnswer(evalCase: BrainCase, answer: BrainAnswer): BrainResult {
  const problem = problemWith(evalCase, answer.command);
  return {
    id: evalCase.id,
    text: evalCase.text,
    money: evalCase.money,
    path: answer.path,
    got: answer.command?.kind ?? 'none',
    passed: problem === null,
    detail: problem ?? '',
  };
}

export function summarise(results: readonly BrainResult[]): BrainSummary {
  const casesPassed = results.filter((result) => result.passed).length;
  const moneyFailures = results.filter((result) => result.money && !result.passed).length;
  const paths: Record<string, number> = {};
  for (const result of results) paths[result.path] = (paths[result.path] ?? 0) + 1;
  const reasons: string[] = [];
  if (results.length === 0) reasons.push('no cases ran');
  if (moneyFailures > 0) reasons.push(`${moneyFailures} money case(s) wrong`);
  if (results.length > 0 && casesPassed / results.length < MIN_PASS_RATE) {
    reasons.push(`${casesPassed} of ${results.length} cases passed (need 90%)`);
  }
  return {
    cases: results.length,
    casesPassed,
    moneyFailures,
    paths,
    passed: reasons.length === 0,
    reasons,
  };
}

export function formatTable(results: readonly BrainResult[], summary: BrainSummary): string {
  const rows = results.map((result) =>
    `${result.passed ? 'PASS' : 'FAIL'}  ${result.id}  ${result.path.padEnd(8)} ${result.got.padEnd(13)} ${result.detail}`.trimEnd(),
  );
  const paths = Object.entries(summary.paths)
    .map(([path, count]) => `${path} ${count}`)
    .join(', ');
  const gate = summary.passed ? 'GATE PASSED' : `GATE FAILED: ${summary.reasons.join('; ')}`;
  return [
    ...rows,
    '',
    `Cases ${summary.casesPassed}/${summary.cases} · answered by: ${paths}`,
    gate,
    '',
  ].join('\n');
}
