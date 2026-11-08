// evals/munshi/outcome-checks.ts
// What the book must look like after a scenario (critical): exactly the entries, reversals,
// claim decisions, Asha reminders and WhatsApp sends it expects, and nothing else. A scenario
// that expects nothing checks that nothing changed.
import { VOICE_PAYLOADS } from '../../supabase/functions/_shared/owner-tools/actions.ts';
import type { BookEntry } from '../../supabase/functions/_shared/db/book-repository.ts';
import type { BookSnapshot, Check, EvalRun, ExpectedEntry, ExpectedOutcome } from './types.ts';

function sorted(values: readonly string[]): string {
  return JSON.stringify([...values].sort());
}

function added<T>(before: readonly T[], after: readonly T[]): readonly T[] {
  return after.slice(before.length);
}

function entryKey(entry: ExpectedEntry | BookEntry, withDueDate: boolean): string {
  const due = withDueDate ? ` due ${entry.dueDate ?? '-'}` : '';
  return `${entry.shopkeeperId} ${entry.kind} ${entry.amount}${due}`;
}

function entriesCheck(expected: readonly ExpectedEntry[]): Check {
  return {
    id: 'outcome_entries',
    critical: true,
    test(run: EvalRun): string | null {
      const known = new Set(run.before.entries.map((entry) => entry.id));
      const created = run.after.entries.filter((entry) => !known.has(entry.id));
      const withDue = expected.some((entry) => entry.dueDate !== undefined);
      const want = sorted(expected.map((entry) => entryKey(entry, withDue)));
      const got = sorted(created.map((entry) => entryKey(entry, withDue)));
      return want === got ? null : `new entries ${got}, expected ${want}`;
    },
  };
}

function listCheck(
  id: string,
  expected: readonly string[],
  pick: (book: BookSnapshot) => readonly string[],
): Check {
  return {
    id,
    critical: true,
    test(run: EvalRun): string | null {
      const got = sorted(added(pick(run.before), pick(run.after)));
      const want = sorted(expected);
      return got === want ? null : `${got}, expected ${want}`;
    },
  };
}

function claimsCheck(expected: Readonly<Record<string, 'confirmed' | 'rejected'>>): Check {
  return {
    id: 'outcome_claims',
    critical: true,
    test(run: EvalRun): string | null {
      const claims = run.before.entries.filter((entry) => entry.status === 'claimed');
      const wrong = claims.find((claim) => {
        const now = run.after.entries.find((entry) => entry.id === claim.id)?.status;
        return now !== (expected[claim.id] ?? 'claimed');
      });
      return wrong ? `claim ${wrong.id.slice(-4)} settled wrongly` : null;
    },
  };
}

/** What each kicked WhatsApp send was for (from its stored voice action). */
function sentWhats(book: BookSnapshot): readonly string[] {
  return book.kicked.map((actionId) => {
    const action = book.actions.find((candidate) => candidate.id === actionId);
    const payload = VOICE_PAYLOADS.voice_send.safeParse(action?.data);
    return payload.success ? payload.data.what : 'unknown';
  });
}

export function outcomeChecks(outcome: ExpectedOutcome): readonly Check[] {
  return [
    entriesCheck(outcome.entries ?? []),
    listCheck('outcome_reversed', outcome.reversed ?? [], (book) => book.reversals),
    claimsCheck(outcome.claims ?? {}),
    listCheck('outcome_reminders', outcome.reminders ?? [], (book) => book.queued),
    listCheck('outcome_sends', outcome.sends ?? [], sentWhats),
  ];
}
