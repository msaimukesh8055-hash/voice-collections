// supabase/functions/_shared/owner-tools/reads-crosscheck.test.ts
// M8 Build A test pass: Munshi's read tools give the same figures as WhatsApp for the same book
// (computeDues and the "pending" reply), and spoken names are never guessed: two Farooqs or two
// Praveens get choices with no figures; Hindi spellings fold the same way; names in Telugu or
// Devanagari script (no Latin letters) match nobody. Fake data only.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { BookEntry, BookShopkeeper } from '../db/book-repository.ts';
import {
  bookEntry,
  LATHA,
  PRAVEEN_1,
  PRAVEEN_2,
  RAMESH,
  SURESH,
} from '../db/fake-book-repository.ts';
import { FAKE_TODAY } from '../db/fake-repository.ts';
import { formatInr } from '../format.ts';
import { groupBy } from '../ledger/due-alert.ts';
import { computeDues, toPaise, toRupees } from '../ledger/dues.ts';
import { pendingReply } from '../ledger/views.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { type ContextOptions, ownerContext } from './__fixtures__/context.ts';
import { bookSummary } from './book-summary.ts';
import { lookupShopkeeper } from './lookup-shopkeeper.ts';

function seedShopkeeper(n: number, name: string, shopName: string): BookShopkeeper {
  return {
    id: `5e000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    name,
    shopName,
    area: 'Old Town',
    language: 'hi',
  };
}

/** The seed's two Farooqs (seed.sql rows 10 and 16). */
const FAROOQ_KIRANA = seedShopkeeper(10, 'Farooq', 'Farooq Kirana & General');
const FAROOQ_SUPER = seedShopkeeper(16, 'Farooq', 'Farooq Super Market');
const SHOPKEEPERS = [RAMESH, LATHA, PRAVEEN_1, PRAVEEN_2, SURESH, FAROOQ_KIRANA, FAROOQ_SUPER];

/** A mixed book: part payments, paise, reversed credit and payment, a claim and a rejection. */
function mixedBook(): readonly BookEntry[] {
  return [
    bookEntry({ kind: 'credit', amount: 5000, entryDate: '2026-10-06', dueDate: '2026-10-21' }),
    bookEntry({ kind: 'payment', amount: 1250.5, entryDate: '2026-10-20' }),
    bookEntry({ kind: 'credit', amount: 3500, entryDate: '2026-10-21', dueDate: '2026-11-05' }),
    bookEntry({ kind: 'payment', amount: 2000, entryDate: '2026-10-30', status: 'claimed' }),
    bookEntry({
      shopkeeperId: LATHA.id,
      kind: 'credit',
      amount: 0.1,
      entryDate: '2026-10-10',
      dueDate: '2026-10-25',
    }),
    bookEntry({
      shopkeeperId: LATHA.id,
      kind: 'credit',
      amount: 0.2,
      entryDate: '2026-10-11',
      dueDate: '2026-10-26',
    }),
    bookEntry({
      shopkeeperId: SURESH.id,
      kind: 'credit',
      amount: 9000,
      entryDate: '2026-10-01',
      dueDate: '2026-10-16',
      status: 'reversed',
    }),
    bookEntry({
      shopkeeperId: SURESH.id,
      kind: 'credit',
      amount: 1200,
      entryDate: '2026-10-18',
      dueDate: FAKE_TODAY,
    }),
    bookEntry({
      shopkeeperId: FAROOQ_KIRANA.id,
      kind: 'credit',
      amount: 4000,
      entryDate: '2026-10-02',
      dueDate: '2026-10-17',
    }),
    bookEntry({
      shopkeeperId: FAROOQ_KIRANA.id,
      kind: 'payment',
      amount: 4000,
      entryDate: '2026-10-25',
      status: 'reversed',
    }),
    bookEntry({
      shopkeeperId: FAROOQ_SUPER.id,
      kind: 'credit',
      amount: 700,
      entryDate: '2026-10-03',
      dueDate: '2026-10-18',
    }),
    bookEntry({
      shopkeeperId: FAROOQ_SUPER.id,
      kind: 'payment',
      amount: 700,
      entryDate: '2026-10-28',
      status: 'rejected',
    }),
    bookEntry({
      shopkeeperId: PRAVEEN_1.id,
      kind: 'credit',
      amount: 900,
      entryDate: '2026-10-04',
      dueDate: '2026-10-19',
    }),
    bookEntry({
      shopkeeperId: PRAVEEN_1.id,
      kind: 'payment',
      amount: 900,
      entryDate: '2026-10-29',
    }),
  ];
}

const OPTIONS: ContextOptions = { shopkeepers: SHOPKEEPERS, entries: mixedBook() };

/** What WhatsApp's money code says for each shopkeeper on the same book and day. */
function expectedDues(): ReadonlyMap<string, ReturnType<typeof computeDues>> {
  const groups = groupBy(mixedBook());
  return new Map(
    SHOPKEEPERS.map((shopkeeper) => [
      shopkeeper.id,
      computeDues(groups.get(shopkeeper.id) ?? [], FAKE_TODAY),
    ]),
  );
}

function expectedTotal(): { readonly total: number; readonly people: number } {
  const owing = [...expectedDues().values()].filter((dues) => dues.outstanding > 0);
  const paise = owing.reduce((sum, dues) => sum + toPaise(dues.outstanding), 0);
  return { total: toRupees(paise), people: owing.length };
}

async function summaryData(): Promise<Record<string, unknown>> {
  const { ctx } = ownerContext(OPTIONS);
  const { result } = await bookSummary(ctx, { focus: 'overview' });
  assert(result.ok);
  return { ...result.data };
}

async function lookup(
  name: string,
): Promise<{ ok: boolean; say: string; data: Record<string, unknown>; calls: string[] }> {
  const { ctx, calls } = ownerContext(OPTIONS);
  const { result } = await lookupShopkeeper(ctx, { name });
  const data = result.ok ? { ...result.data } : { code: result.code };
  return { ok: result.ok, say: result.say, data, calls };
}

Deno.test('crosscheck › book_summary pending = computeDues over everyone (paise exact)', async () => {
  const { total, people } = expectedTotal();
  const data = await summaryData();
  assertEquals([data['outstanding'], data['people_owing']], [total, people]);
  assertEquals(total, 13149.8);
});

Deno.test("crosscheck › book_summary pending = WhatsApp's pending title on the same book", async () => {
  const data = await summaryData();
  const reply = pendingReply({
    shopkeepers: SHOPKEEPERS,
    entries: mixedBook(),
    today: FAKE_TODAY,
    language: 'en',
    scores: new Map(),
  });
  const title = phrasesFor('en').pendingTitle(
    Number(data['people_owing']),
    formatInr(Number(data['outstanding'])),
  );
  assertStringIncludes(JSON.stringify(reply), title);
});

Deno.test('crosscheck › lookup figures = computeDues for that shopkeeper', async () => {
  const dues = expectedDues();
  for (
    const [name, shopkeeper] of [['Ramesh', RAMESH], ['Latha', LATHA], ['Suresh', SURESH]] as const
  ) {
    const { ok, data } = await lookup(name);
    const expected = dues.get(shopkeeper.id);
    assert(ok && expected, name);
    assertEquals(
      [data['outstanding'], data['overdue_amount'], data['days_overdue'], data['next_due_amount']],
      [expected.outstanding, expected.overdueAmount, expected.daysOverdue, expected.nextDueAmount],
      name,
    );
  }
});

Deno.test('crosscheck › a reversed payment is not counted: Farooq Kirana still owes 4,000', async () => {
  const { ok, data } = await lookup('Farooq Kirana & General');
  assert(ok);
  assertEquals(data['outstanding'], 4000);
});

Deno.test('names › two Farooqs → asks which, both shops named, no figures, one read', async () => {
  for (const spoken of ['Farooq', 'farooq', 'Faarooq', ' FAROOQ ', 'Farook']) {
    const { ok, say, data, calls } = await lookup(spoken);
    assert(ok, spoken);
    assertEquals(data['choice_count'], 2, spoken);
    assertStringIncludes(say, 'Farooq (Farooq Kirana & General)');
    assertEquals([data['outstanding'], /\d{3}/.test(say), calls], [undefined, false, [
      'listShopkeepers',
    ]], spoken);
  }
});

Deno.test('names › two Praveens → asks which; the shop name picks one', async () => {
  const both = await lookup('praveen');
  const one = await lookup('Praveen Bakery');
  assertEquals([both.data['choice_count'], both.data['outstanding']], [2, undefined]);
  assertEquals([one.ok, one.data['shopkeeper'], one.data['outstanding']], [true, 'Praveen', 0]);
});

Deno.test('names › Telugu or Devanagari script, or a blank name, matches nobody (never a guess)', async () => {
  for (const spoken of ['రమేష్', 'रमेश', 'फ़ारूक़', '   ', '!!']) {
    const { ok, data, calls } = await lookup(spoken);
    assertEquals([ok, data['code'], calls], [false, 'NOT_FOUND', ['listShopkeepers']], spoken);
  }
});

Deno.test('names › a misheard name one letter from two people → choices, not a guess', async () => {
  const rajesh = seedShopkeeper(20, 'Rajesh', 'Rajesh Stores');
  const { ctx } = ownerContext({ shopkeepers: [RAMESH, rajesh], entries: [] });
  const { result } = await lookupShopkeeper(ctx, { name: 'Raesh' });
  assert(result.ok);
  assertEquals([result.data['choice_count'], result.data['outstanding']], [2, undefined]);
});
