// supabase/functions/_shared/owner-tools/reversal-maths.test.ts
// Delete = reversal (M8 B3, Decision 2b; money, 100%): a reversed entry must read exactly as if it
// were gone, in every money reader — dues, insights, score, the due alert, WhatsApp's closed list
// and lookup — because each counts only confirmed entries. Checked for a reversed credit and a
// reversed payment, on a seed-style book (FAKE DATA ONLY).
import { assertEquals } from '@std/assert';
import type { BookEntry } from '../db/book-repository.ts';
import {
  bookEntry,
  fakeBookEntries,
  LATHA,
  PRAVEEN_1,
  PRAVEEN_2,
  RAMESH,
  SURESH,
} from '../db/fake-book-repository.ts';
import { FAKE_TODAY } from '../db/fake-repository.ts';
import { buildDueAlert } from '../ledger/due-alert.ts';
import { computeDues } from '../ledger/dues.ts';
import { computeInsights } from '../ledger/insights.ts';
import { computeScore } from '../ledger/score.ts';
import { closedReply, shopkeeperReplies } from '../ledger/views.ts';

const SHOPKEEPERS = [RAMESH, LATHA, PRAVEEN_1, PRAVEEN_2, SURESH];

function book(): readonly BookEntry[] {
  return [
    ...fakeBookEntries(),
    bookEntry({ kind: 'credit', amount: 1200, entryDate: '2026-11-01', dueDate: '2026-11-02' }),
    bookEntry({ kind: 'payment', amount: 800, entryDate: '2026-11-02' }),
  ];
}

interface Pair {
  readonly name: string;
  readonly reversed: readonly BookEntry[];
  readonly gone: readonly BookEntry[];
}

function pairs(): readonly Pair[] {
  const entries = book();
  return entries.slice(-2).map((target) => ({
    name: target.kind,
    reversed: entries.map((entry) =>
      entry.id === target.id ? { ...entry, status: 'reversed' as const } : entry
    ),
    gone: entries.filter((entry) => entry.id !== target.id),
  }));
}

function ramesh(entries: readonly BookEntry[]): readonly BookEntry[] {
  return entries.filter((entry) => entry.shopkeeperId === RAMESH.id);
}

for (const pair of pairs()) {
  Deno.test(`reversal maths › a reversed ${pair.name}: dues as if it were gone`, () => {
    assertEquals(
      computeDues(ramesh(pair.reversed), FAKE_TODAY),
      computeDues(ramesh(pair.gone), FAKE_TODAY),
    );
  });

  Deno.test(`reversal maths › a reversed ${pair.name}: insights as if it were gone`, () => {
    assertEquals(
      computeInsights(SHOPKEEPERS, pair.reversed, FAKE_TODAY),
      computeInsights(SHOPKEEPERS, pair.gone, FAKE_TODAY),
    );
  });

  Deno.test(`reversal maths › a reversed ${pair.name}: score parts as if it were gone`, () => {
    const score = (entries: readonly BookEntry[]) =>
      computeScore({ entries: ramesh(entries), promises: [], callStatuses: [], today: FAKE_TODAY });
    assertEquals(score(pair.reversed), score(pair.gone));
  });

  Deno.test(`reversal maths › a reversed ${pair.name}: due alert as if it were gone`, () => {
    const alert = (entries: readonly BookEntry[]) =>
      buildDueAlert({ shopkeepers: SHOPKEEPERS, entries, promises: [], today: FAKE_TODAY });
    assertEquals(alert(pair.reversed), alert(pair.gone));
  });

  Deno.test(`reversal maths › a reversed ${pair.name}: WhatsApp closed list and lookup unchanged`, () => {
    const view = { shopkeepers: SHOPKEEPERS, today: FAKE_TODAY, language: 'en' as const };
    assertEquals(
      closedReply({ ...view, entries: pair.reversed }),
      closedReply({ ...view, entries: pair.gone }),
    );
    const lookup = (entries: readonly BookEntry[]) =>
      shopkeeperReplies({
        shopkeeper: RAMESH,
        entries: ramesh(entries),
        lastPromise: null,
        lastNote: null,
        score: null,
        today: FAKE_TODAY,
        language: 'en',
      });
    assertEquals(lookup(pair.reversed), lookup(pair.gone));
  });
}
