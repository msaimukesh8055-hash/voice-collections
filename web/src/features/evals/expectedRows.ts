// web/src/features/evals/expectedRows.ts
// Expected vs this run (Saim, 2026-11-23): lines a case's golden outcome (what it expects, from
// the case definitions) up with what one stored run found, row by row. Pure code, no React.
// Nothing is re-judged: a row's pass or fail is the stored check or judge verdict; a row the
// run did not check says so instead of guessing.
import type { EvalCase, GoldenCase, GoldenRow } from '../../lib/evalsSchemas.ts';

export type RowStatus = 'pass' | 'fail' | 'not_checked';

export interface ResultRow {
  readonly label: string;
  readonly expected: string;
  readonly checkedBy: GoldenRow['checkedBy'];
  readonly blocker: boolean;
  readonly status: RowStatus;
  /** A failed check's detail, or the judge's reasoning (pass or fail); empty when none. */
  readonly note: string;
}

function statusOf(passed: boolean | undefined): RowStatus {
  if (passed === undefined) return 'not_checked';
  return passed ? 'pass' : 'fail';
}

function fromGolden(row: GoldenRow, evalCase: EvalCase): ResultRow {
  const { checks, verdicts } = evalCase.scores;
  const shown = { label: row.label, expected: row.expected, checkedBy: row.checkedBy };
  if (row.source === 'check') {
    const check = checks.find((one) => one.id === row.key);
    const note = check && !check.passed ? check.detail : '';
    return { ...shown, blocker: row.blocker, status: statusOf(check?.passed), note };
  }
  const verdict = verdicts.find((one) => one.name === row.key);
  return {
    ...shown,
    blocker: row.blocker,
    status: statusOf(verdict?.passed),
    note: verdict?.reasoning ?? '',
  };
}

/** Checks and verdicts this run stored that today's case no longer lists (an older run). */
function leftovers(golden: GoldenCase, evalCase: EvalCase): readonly ResultRow[] {
  const keys = new Set(golden.rows.map((row) => `${row.source}:${row.key}`));
  const checks = evalCase.scores.checks
    .filter((check) => !keys.has(`check:${check.id}`))
    .map((check): ResultRow => ({
      label: check.id,
      expected: 'Not in today’s case (older run)',
      checkedBy: 'code',
      blocker: check.critical,
      status: statusOf(check.passed),
      note: check.passed ? '' : check.detail,
    }));
  const verdicts = evalCase.scores.verdicts
    .filter((verdict) => !keys.has(`verdict:${verdict.name}`))
    .map((verdict): ResultRow => ({
      label: verdict.name,
      expected: 'Not in today’s case (older run)',
      checkedBy: 'judge',
      blocker: false,
      status: statusOf(verdict.passed),
      note: verdict.reasoning,
    }));
  return [...checks, ...verdicts];
}

/** Asha and Munshi: one row per golden row, in the golden order, then anything extra. */
export function resultRows(golden: GoldenCase, evalCase: EvalCase): readonly ResultRow[] {
  return [...golden.rows.map((row) => fromGolden(row, evalCase)), ...leftovers(golden, evalCase)];
}

export interface BrainRow {
  readonly label: 'Command' | 'Name' | 'Amount';
  readonly expected: string;
  readonly got: string;
  readonly status: RowStatus;
}

const NOT_SAVED = 'not saved in this run';
const KIND_CHECK_PREFIX = 'understood_as_';

/** The kind the brain gave: stored as "got" from 2026-11-23, before that only in the check id. */
function gotKind(evalCase: EvalCase): string {
  const stored = evalCase.scores.got;
  if (stored) return stored.kind ?? 'none';
  const check = evalCase.scores.checks.find((one) => one.id.startsWith(KIND_CHECK_PREFIX));
  return check ? check.id.slice(KIND_CHECK_PREFIX.length) : NOT_SAVED;
}

function expectedKind(golden: GoldenCase): string {
  const command = golden.command;
  if (!command || command.kind !== null) return command?.kind ?? '';
  return command.readsAllowed ? 'no money card' : 'no command';
}

/** Which part of the answer a failed check's detail is about ("expected name …"). */
function failedPart(detail: string): BrainRow['label'] {
  if (detail.startsWith('expected name')) return 'Name';
  if (detail.startsWith('expected amount')) return 'Amount';
  return 'Command';
}

/** "expected amount 1000, got 10000" → "10000"; empty when the detail is not about it. */
function gotFromDetail(detail: string, part: BrainRow['label']): string {
  const match = detail.match(new RegExp(`^expected ${part.toLowerCase()} .*, got (.+)$`));
  return match?.[1] ?? '';
}

interface BrainPart {
  readonly label: BrainRow['label'];
  readonly expected: string | null;
  readonly stored: string | null;
}

/** The brain checks command, then name, then amount, and stops at the first that is wrong. */
const PART_ORDER: readonly BrainRow['label'][] = ['Command', 'Name', 'Amount'];

function brainPart(part: BrainPart, evalCase: EvalCase): BrainRow | null {
  if (part.expected === null) return null;
  const check = evalCase.scores.checks[0];
  const passed = check?.passed ?? evalCase.pass;
  const detail = check?.detail ?? '';
  if (passed)
    return { label: part.label, expected: part.expected, got: part.expected, status: 'pass' };
  const wrong = failedPart(detail);
  const order = PART_ORDER.indexOf(part.label) - PART_ORDER.indexOf(wrong);
  if (order < 0)
    return { label: part.label, expected: part.expected, got: part.expected, status: 'pass' };
  const got = order === 0 ? gotFromDetail(detail, part.label) || part.stored : part.stored;
  return {
    label: part.label,
    expected: part.expected,
    got: got ?? NOT_SAVED,
    status: order === 0 ? 'fail' : 'not_checked',
  };
}

function commandStatus(evalCase: EvalCase): RowStatus {
  if (evalCase.pass) return 'pass';
  const detail = evalCase.scores.checks[0]?.detail ?? '';
  return failedPart(detail) === 'Command' ? 'fail' : 'pass';
}

function text(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** WhatsApp brain: expected vs got for the command, then the name and amount it must carry. */
export function brainRows(golden: GoldenCase, evalCase: EvalCase): readonly BrainRow[] {
  const stored = evalCase.scores.got;
  const kind = gotKind(evalCase);
  const command: BrainRow = {
    label: 'Command',
    expected: expectedKind(golden),
    got: kind,
    status: commandStatus(evalCase),
  };
  const parts: readonly BrainPart[] = [
    { label: 'Name', expected: golden.command?.name ?? null, stored: stored?.name ?? null },
    { label: 'Amount', expected: text(golden.command?.amount), stored: text(stored?.amount) },
  ];
  const rest = parts.map((part) => brainPart(part, evalCase)).filter((row) => row !== null);
  return [command, ...rest];
}

export interface Turn {
  readonly speaker: string;
  readonly fromAgent: boolean;
  readonly text: string;
}

const ROLE_LINE = /^(assistant|user|owner|brain \((\w+)\)): ?(.*)$/;

function speakerOf(role: string, agent: string, answeredBy: string | undefined): string {
  if (role === 'assistant') return agent;
  if (role === 'user') return 'Simulated caller';
  if (role === 'owner') return 'Owner’s message';
  return `Brain (answered by ${answeredBy ?? 'code'})`;
}

/** A stored transcript ("assistant: …\nuser: …") as turns, with people's names instead of roles.
 * A line without a role continues the turn before it. */
export function turnsOf(transcript: string, agent: string): readonly Turn[] {
  const turns: Turn[] = [];
  for (const line of transcript.split('\n')) {
    const match = line.match(ROLE_LINE);
    const last = turns.at(-1);
    if (!match) {
      if (last) turns[turns.length - 1] = { ...last, text: `${last.text}\n${line}` };
      continue;
    }
    const role = match[1] ?? '';
    turns.push({
      speaker: speakerOf(role, agent, match[2]),
      fromAgent: role === 'assistant' || role.startsWith('brain'),
      text: match[3] ?? '',
    });
  }
  return turns;
}
