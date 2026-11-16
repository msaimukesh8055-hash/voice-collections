// evals/sarvam/munshi-checks.ts
// Our own checks on a Munshi case, read from the database after the Sarvam Tests conversation
// (M9 Build F). No judge: the eval owner's book must end up exactly as the case expects (new
// entries, reversals, claim decisions, reminders asked for, WhatsApp sends asked for) and nothing
// else may change. These are critical. Whether the expected tools ran is reported, not critical.
// Reminders and sends are counted from saved voice actions: on an eval owner the tool server
// records them but never queues a call or sends a message (munshi-tools, Build F).
import { EVAL_ENTRIES } from '../munshi/book.fixture.ts';
import type { ExpectedOutcome } from '../munshi/types.ts';
import type { MunshiCase } from './munshi-cases.ts';
import type { AuditedTool, CheckResult } from './types.ts';

export interface EvidenceEntry {
  readonly id: string;
  readonly shopkeeperId: string;
  readonly kind: 'credit' | 'payment';
  readonly amount: number;
  readonly status: string;
}

export interface SavedAction {
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** What one Munshi case left in the database. */
export interface MunshiEvidence {
  readonly tools: readonly AuditedTool[];
  readonly entries: readonly EvidenceEntry[];
  readonly savedActions: readonly SavedAction[];
}

function sorted(values: readonly string[]): string {
  return JSON.stringify([...values].sort());
}

function result(
  id: string,
  critical: boolean,
  compared: { readonly got: string; readonly want: string },
): CheckResult {
  const { got, want } = compared;
  const passed = got === want;
  return { id, critical, passed, detail: passed ? '' : `${got}, expected ${want}` };
}

function payloadField(action: SavedAction, field: string): string {
  const value = action.payload[field];
  return typeof value === 'string' ? value : '';
}

function savedOf(evidence: MunshiEvidence, kind: string, field: string): string[] {
  return evidence.savedActions
    .filter((action) => action.kind === kind)
    .map((action) => payloadField(action, field));
}

/** The case's own ids for the fixture's entries, and for the claims among them. */
function bookIds(ids: ReadonlyMap<string, string>): { entries: Set<string>; claims: string[] } {
  const entries = new Set<string>();
  const claims: string[] = [];
  for (const entry of EVAL_ENTRIES) {
    const id = ids.get(entry.id);
    if (!id) continue;
    entries.add(id);
    if (entry.status === 'claimed') claims.push(id);
  }
  return { entries, claims };
}

function claimsCheck(
  claimIds: readonly string[],
  expected: ExpectedOutcome['claims'],
  evidence: MunshiEvidence,
): CheckResult {
  const statusOf = (id: string): string =>
    evidence.entries.find((entry) => entry.id === id)?.status ?? 'missing';
  const want = claimIds.map((id) => `${id} ${expected?.[id] ?? 'claimed'}`);
  const got = claimIds.map((id) => `${id} ${statusOf(id)}`);
  return result('outcome_claims', true, { got: sorted(got), want: sorted(want) });
}

export function checkMunshiCall(
  evalCase: MunshiCase,
  expected: { readonly outcome: ExpectedOutcome; readonly ids: ReadonlyMap<string, string> },
  evidence: MunshiEvidence,
): readonly CheckResult[] {
  const { outcome, ids } = expected;
  const book = bookIds(ids);
  const created = evidence.entries.filter((entry) => !book.entries.has(entry.id));
  const reversed = evidence.entries.filter((entry) => entry.status === 'reversed');
  const ran = new Set(evidence.tools.filter((tool) => tool.ok).map((tool) => tool.tool));
  const missing = evalCase.mustCall.filter((tool) => !ran.has(tool));
  return [
    result('outcome_entries', true, {
      got: sorted(created.map((entry) => `${entry.shopkeeperId} ${entry.kind} ${entry.amount}`)),
      want: sorted(
        (outcome.entries ?? []).map(
          (entry) => `${entry.shopkeeperId} ${entry.kind} ${entry.amount}`,
        ),
      ),
    }),
    result('outcome_reversed', true, {
      got: sorted(reversed.map((entry) => entry.id)),
      want: sorted(outcome.reversed ?? []),
    }),
    claimsCheck(book.claims, outcome.claims, evidence),
    result('outcome_reminders', true, {
      got: sorted(savedOf(evidence, 'voice_remind', 'shopkeeperId')),
      want: sorted(outcome.reminders ?? []),
    }),
    result('outcome_sends', true, {
      got: sorted(savedOf(evidence, 'voice_send', 'what')),
      want: sorted(outcome.sends ?? []),
    }),
    {
      id: 'must_call',
      critical: false,
      passed: missing.length === 0,
      detail: missing.length === 0 ? '' : `not called: ${missing.join(', ')}`,
    },
  ];
}
