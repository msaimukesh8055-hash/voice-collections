// supabase/functions/_shared/owner-tools/lookup-shopkeeper.test.ts
// lookup_shopkeeper's figures (M8, 100% target): one shopkeeper in two read rounds, the same dues
// and score as WhatsApp, Asha's calls from records, and choices (no figures) for unclear names.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { bookEntry, fakeBookEntries, RAMESH, SURESH } from '../db/fake-book-repository.ts';
import type { FakePastCall } from '../db/fake-repository.ts';
import { type ContextOptions, ownerContext } from './__fixtures__/context.ts';
import { liveEntries, lookupShopkeeper } from './lookup-shopkeeper.ts';
import { MAX_SAY_CHARS } from './say.ts';

interface Answer {
  readonly ok: boolean;
  readonly say: string;
  readonly data: Record<string, unknown>;
  readonly calls: readonly string[];
}

async function lookup(name: string, options: ContextOptions = {}): Promise<Answer> {
  const { ctx, calls } = ownerContext(options);
  const { result } = await lookupShopkeeper(ctx, { name });
  const data = result.ok ? { ...result.data } : { code: result.code };
  return { ok: result.ok, say: result.say, data, calls };
}

function pastCall(overrides: Partial<FakePastCall> = {}): FakePastCall {
  return {
    id: crypto.randomUUID(),
    shopkeeperId: RAMESH.id,
    queuedAt: '2026-10-29T05:30:00.000Z',
    mode: 'live',
    status: 'completed',
    identityStatus: 'confirmed',
    promises: [],
    claims: [],
    followups: [],
    signals: [],
    ...overrides,
  };
}

Deno.test('lookup › Ramesh: dues, claim, last entries and score in two read rounds', async () => {
  const { say, data, calls } = await lookup('ramesh');
  assertEquals(data, {
    shopkeeper: 'Ramesh',
    outstanding: 8500,
    overdue_amount: 5000,
    days_overdue: 12,
    next_due_date: '2026-11-05',
    next_due_amount: 3500,
    open_claims: 1,
    score: 56,
    band: 'watch',
    past_calls: 0,
    their_words_shown: 0,
  });
  assertEquals(
    say,
    'Ramesh: outstanding 8,500 rupees. Overdue 5,000 rupees since Wed 21 Oct (12 days). ' +
      'Next due 3,500 rupees on Thu 5 Nov. Payment claims waiting for you: 2,000 rupees paid on ' +
      'Sun 1 Nov by upi. Last entries: credit 3,500 rupees on Wed 21 Oct; credit 5,000 rupees on ' +
      'Tue 6 Oct; payment 4,000 rupees on Thu 24 Sept. Score 56 out of 100 (watch).',
  );
  assertEquals(calls[0], 'listShopkeepers');
  assertEquals([...calls.slice(1)].sort(), [
    'listCallStatuses',
    'listPastCalls',
    'listPromises',
    'listShopkeeperEntries',
  ]);
});

Deno.test('lookup › two shopkeepers with the same name → choices and no figures', async () => {
  const { ok, say, data, calls } = await lookup('Praveen');
  assert(ok);
  assertEquals(data, {
    choices: 'Praveen (Praveen Bakery); Praveen (Praveen Super Market)',
    choice_count: 2,
  });
  assert(!say.includes('rupees'));
  assertStringIncludes(say, 'Share no figures until he picks one.');
  assertEquals(calls, ['listShopkeepers']);
});

Deno.test('lookup › more than 3 matches → 3 shown, a true count, ask for the shop', async () => {
  const shopkeepers = Array.from({ length: 5 }, (_, n) => ({
    ...RAMESH,
    id: `5e000000-0000-4000-8000-${String(100 + n).padStart(12, '0')}`,
    shopName: `Ramesh Shop ${n}`,
  }));
  const { say, data } = await lookup('Ramesh', { shopkeepers });
  assertEquals(data['choice_count'], 5);
  assertStringIncludes(say, ', and 2 more. Ask him for the shop name too.');
});

Deno.test('lookup › nobody by that name → NOT_FOUND, one read', async () => {
  const { ok, data, calls } = await lookup('Venkatesh');
  assertEquals([ok, data['code']], [false, 'NOT_FOUND']);
  assertEquals(calls, ['listShopkeepers']);
});

Deno.test('lookup › nothing outstanding', async () => {
  const { say, data } = await lookup('Suresh');
  assertEquals([data['outstanding'], data['band']], [0, 'new']);
  assertEquals(say, 'Suresh: nothing outstanding. Score: new customer, not enough history yet.');
});

Deno.test('lookup › owing but nothing overdue yet', async () => {
  const credit = bookEntry({
    shopkeeperId: SURESH.id,
    kind: 'credit',
    amount: 700,
    entryDate: '2026-10-30',
    dueDate: '2026-11-14',
  });
  const { say } = await lookup('Suresh', { entries: [credit] });
  assertStringIncludes(
    say,
    'Suresh: outstanding 700 rupees. Nothing overdue yet. Next due 700 rupees on Sat 14 Nov.',
  );
});

Deno.test('lookup › an open promise is said; a past one is judged in memory', async () => {
  const open = {
    id: 'p1',
    shopkeeperId: RAMESH.id,
    amount: 3500,
    promiseDate: '2026-11-05',
    status: 'open' as const,
    createdAt: '2026-10-29T05:00:00.000Z',
  };
  const fresh = await lookup('Ramesh', { promises: [open] });
  assertStringIncludes(fresh.say, 'Open promise: 3,500 rupees by Thu 5 Nov.');
  const stale = await lookup('Ramesh', {
    promises: [{ ...open, promiseDate: '2026-10-30' }],
  });
  assert(!stale.say.includes('Open promise'));
});

Deno.test("lookup › Asha's calls come from the records, their words labelled", async () => {
  const pastCalls = [
    pastCall({
      followups: [{
        kind: 'owner_callback',
        reason: 'hardship',
        summary: 'Said harvest money comes next week',
      }],
    }),
    pastCall({ queuedAt: '2026-10-20T05:30:00.000Z', status: 'missed', mode: 'simulated' }),
  ];
  const { say, data } = await lookup('Ramesh', { pastCalls });
  assertEquals([data['past_calls'], data['their_words_shown']], [2, 1]);
  assertStringIncludes(say, "Asha's calls (from the shop's records, newest first): Thu 29 Oct:");
  assertStringIncludes(say, 'Their words (a claim, not checked)');
  assert(say.length <= MAX_SAY_CHARS);
});

Deno.test('lookup › reversed entries are not counted and not listed', async () => {
  const reversed = bookEntry({
    kind: 'credit',
    amount: 9999,
    entryDate: '2026-11-01',
    dueDate: '2026-11-16',
    status: 'reversed',
  });
  const { say, data } = await lookup('Ramesh', { entries: [...fakeBookEntries(), reversed] });
  assertEquals(data['outstanding'], 8500);
  assert(!say.includes('9,999'));
});

Deno.test('liveEntries › the last 3 confirmed, newest first (same day: latest saved first)', () => {
  const entries = [
    bookEntry({
      kind: 'credit',
      amount: 1,
      entryDate: '2026-10-01',
      createdAt: '2026-10-01T01:00Z',
    }),
    bookEntry({
      kind: 'credit',
      amount: 2,
      entryDate: '2026-10-01',
      createdAt: '2026-10-01T02:00Z',
    }),
    bookEntry({ kind: 'payment', amount: 3, entryDate: '2026-10-05' }),
    bookEntry({ kind: 'payment', amount: 4, entryDate: '2026-10-09', status: 'claimed' }),
    bookEntry({ kind: 'payment', amount: 5, entryDate: '2026-10-09', status: 'rejected' }),
    bookEntry({ kind: 'credit', amount: 6, entryDate: '2026-10-09', status: 'reversed' }),
  ];
  assertEquals(liveEntries(entries).map((entry) => entry.amount), [3, 2, 1]);
});
