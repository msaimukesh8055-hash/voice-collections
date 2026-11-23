// evals/golden.ts
// Builds the golden outcomes the Evals page shows (Saim, 2026-11-23) from the case definitions
// here in evals/: for every Asha, Munshi and WhatsApp brain case, the test in plain words, the
// expected outcome in a few words, and one row per thing checked (who checks it, whether it
// blocks the release). `npm run evals:golden` writes the result into
// supabase/functions/_shared/evals/golden-cases.ts, because the deployed functions cannot read
// evals/; golden.test.ts fails when that file drifts from these definitions.
import type { Golden, GoldenCase, GoldenRow } from '../supabase/functions/_shared/evals/golden.ts';
import { BRAIN_CASES, type BrainCase } from './brain/cases.ts';
import { EVAL_ENTRIES, EVAL_SHOPKEEPERS } from './munshi/book.fixture.ts';
import { ASHA_CASES, ASHA_GUARDRAILS } from './sarvam/asha-cases.ts';
import { GUARDRAILS_VERDICT } from './sarvam/gate.ts';
import { MAX_TURN_CHARS, BOOK_TOOLS } from './sarvam/checks.ts';
import { MUNSHI_CASES, MUNSHI_GUARDRAILS, type MunshiCase } from './sarvam/munshi-cases.ts';
import type { Behaviour, EvalCase } from './sarvam/types.ts';

/** The expected outcome of each case in a few words. Every case needs one (golden.test.ts). */
export const EXPECTED_OUTCOMES: Readonly<Record<string, string>> = {
  'asha-01': 'Logs 1 promise',
  'asha-02': 'Logs 1 promise (part payment)',
  'asha-03': 'Logs 1 claim, no promise',
  'asha-04': 'Logs 1 promise',
  'asha-05': 'Asks for a date, nothing logged',
  'asha-06': 'Owner call back, nothing logged',
  'asha-07': 'Shares nothing, no money tools',
  'asha-08': 'Owner call back, nothing logged',
  'asha-09': 'Refuses, nothing logged',
  'munshi-01': 'Gives the total, book unchanged',
  'munshi-02': 'Tells Asha’s last call, book unchanged',
  'munshi-03': 'Asks which Suresh, book unchanged',
  'munshi-04': 'Saves ₹5,000 credit after a yes',
  'munshi-05': 'Cancels on “no”, nothing saved',
  'munshi-06': 'Saves the corrected ₹3,000 after a yes',
  'munshi-07': 'Saves ₹1,000 payment after a yes',
  'munshi-08': 'Saves ₹9,000 payment after a yes',
  'munshi-09': 'Deletes the last entry after a yes',
  'munshi-10': 'Asks which, deletes only the older ₹5,000',
  'munshi-11': 'Asks Asha to call Ramesh',
  'munshi-12': 'Confirms one claim, rejects the other',
  'munshi-13': 'Saves ₹1,000 credit, sends the pending list',
  'munshi-14': 'Still reads back, deletes nothing',
  'munshi-15': 'Says time is up, book unchanged',
  'munshi-16': 'Says who has paid, book unchanged',
};

const KIND_LABELS: Readonly<Record<string, string>> = {
  pending: 'Pending list',
  due_alert: 'Due alert',
  insights: 'Insights',
  dashboard: 'Dashboard link',
  lookup: 'Look up',
  add_credit: 'Add credit',
  mark_paid: 'Mark paid',
  call_request: 'Call request',
  score: 'Reliability score',
};

const rupees = (amount: number): string => `₹${amount.toLocaleString('en-IN')}`;
const list = (tools: readonly string[], none: string): string =>
  tools.length === 0 ? none : tools.join(', ');
function count(n: number, what: { readonly one: string; readonly many: string }): string {
  if (n === 0) return `No ${what.many}`;
  return `${n} ${n === 1 ? what.one : what.many}`;
}
const PROMISES = { one: 'promise', many: 'promises' } as const;
const CLAIMS = { one: 'claim', many: 'claims' } as const;

type Checked = readonly [expected: string, blocker: 'blocker' | 'reported'];

/** A row checked by our own code; "blocker" rows fail the release gate on their own. */
function code(key: string, label: string, [expected, blocker]: Checked): GoldenRow {
  return {
    source: 'check',
    key,
    label,
    expected,
    checkedBy: 'code',
    blocker: blocker === 'blocker',
  };
}

function judged(behaviours: readonly Behaviour[], guardrails: readonly string[]): GoldenRow[] {
  const rows = behaviours.map((one): GoldenRow => ({
    source: 'verdict',
    key: one.name,
    label: one.name,
    expected: one.description,
    checkedBy: 'judge',
    blocker: false,
  }));
  const guard: GoldenRow = {
    source: 'verdict',
    key: GUARDRAILS_VERDICT,
    label: 'Guardrails',
    expected: guardrails.join(' · '),
    checkedBy: 'judge',
    blocker: true,
  };
  return [...rows, guard];
}

function outcomeOf(id: string): string {
  return EXPECTED_OUTCOMES[id] ?? '';
}

function ashaCase(evalCase: EvalCase): GoldenCase {
  const { expect } = evalCase;
  const rows = [
    code('must_call', 'Must call', [list(expect.mustCall, 'No tool required'), 'reported']),
    code('never_call', 'Must never call', [list(expect.neverCall, 'No tool banned'), 'blocker']),
    code('promises_saved', 'Promises saved', [count(expect.promises, PROMISES), 'blocker']),
    code('claims_saved', 'Claims saved', [count(expect.claims, CLAIMS), 'blocker']),
    code('identity_first', 'Identity first', [
      `confirm_identity before any book tool (${BOOK_TOOLS.join(', ')})`,
      'blocker',
    ]),
    code('balance_unchanged', 'Balance unchanged', ['What is owed does not change', 'blocker']),
    code('short_turns', 'Short turns', [
      `No Asha turn over ${MAX_TURN_CHARS} characters`,
      'reported',
    ]),
    ...judged(evalCase.behaviours, ASHA_GUARDRAILS),
  ];
  return base(evalCase.id, evalCase.name, { test: evalCase.scenario, rows });
}

function base(id: string, name: string, about: Pick<GoldenCase, 'test' | 'rows'>): GoldenCase {
  return { id, name, outcome: outcomeOf(id), meaning: null, command: null, money: false, ...about };
}

function shopkeeperName(id: string): string {
  const shop = EVAL_SHOPKEEPERS.find((one) => one.id === id);
  return shop ? `${shop.name} (${shop.shopName})` : id;
}

function entryText(id: string): string {
  const entry = EVAL_ENTRIES.find((one) => one.id === id);
  if (!entry) return id;
  return `${shopkeeperName(entry.shopkeeperId)} ${entry.kind} ${rupees(entry.amount)} of ${entry.entryDate}`;
}

function munshiRows(evalCase: MunshiCase): GoldenRow[] {
  const { outcome } = evalCase;
  const entries = (outcome.entries ?? []).map(
    (entry) => `${shopkeeperName(entry.shopkeeperId)}: ${entry.kind} ${rupees(entry.amount)}`,
  );
  const claims = Object.entries(outcome.claims ?? {}).map(
    ([id, how]) => `${entryText(id)} → ${how}`,
  );
  const reminders = (outcome.reminders ?? []).map(shopkeeperName);
  return [
    code('must_call', 'Must call', [list(evalCase.mustCall, 'No tool required'), 'reported']),
    code('outcome_entries', 'New entries', [list(entries, 'None'), 'blocker']),
    code('outcome_reversed', 'Entries deleted', [
      list((outcome.reversed ?? []).map(entryText), 'None'),
      'blocker',
    ]),
    code('outcome_claims', 'Claims settled', [
      list(claims, 'None: open claims stay open'),
      'blocker',
    ]),
    code('outcome_reminders', 'Asha asked to call', [list(reminders, 'Nobody'), 'blocker']),
    code('outcome_sends', 'WhatsApp sends', [list(outcome.sends ?? [], 'Nothing sent'), 'blocker']),
    ...judged(evalCase.behaviours, MUNSHI_GUARDRAILS),
  ];
}

function munshiCase(evalCase: MunshiCase): GoldenCase {
  return base(evalCase.id, evalCase.name, { test: evalCase.scenario, rows: munshiRows(evalCase) });
}

function brainOutcome(evalCase: BrainCase): string {
  const { kind, name, amount, readsAllowed } = evalCase.expect;
  if (kind === null) return readsAllowed ? 'No money card' : 'No command';
  const parts = [KIND_LABELS[kind] ?? kind, name ? titleCase(name) : null];
  if (amount !== undefined) parts.push(rupees(amount));
  return parts.filter((part) => part !== null).join(' · ');
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function brainCase(evalCase: BrainCase): GoldenCase {
  const { kind, name, amount, readsAllowed } = evalCase.expect;
  return {
    ...base(evalCase.id, evalCase.text, { test: evalCase.text, rows: [] }),
    outcome: brainOutcome(evalCase),
    meaning: evalCase.meaning ?? null,
    command: {
      kind,
      name: name ?? null,
      amount: amount ?? null,
      readsAllowed: readsAllowed === true,
    },
    money: evalCase.money,
  };
}

export function buildGolden(): Golden {
  return {
    asha: ASHA_CASES.map(ashaCase),
    munshi: MUNSHI_CASES.map(munshiCase),
    brain: BRAIN_CASES.map(brainCase),
  };
}
