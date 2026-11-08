// supabase/functions/_shared/ledger/waiting-views.test.ts
// /claims and /promises (2026-11-08): claims waiting, newest first, each with today's
// [Confirm received] [Not received] card (at most 5 cards, "and N more"); promises this week and
// broken lately, with the English rendering under Hindi or Telugu. Pure, FAKE data.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { parseTap } from '../cards/ids.ts';
import {
  bookEntry,
  FAKE_TODAY,
  LATHA,
  PRAVEEN_1,
  RAMESH,
  SURESH,
} from '../db/fake-book-repository.ts';
import type { BookEntry } from '../db/book-repository.ts';
import type { AlertPromise } from './due-alert.ts';
import { replyText } from '../whatsapp/replies.ts';
import { claimsReplies, MAX_CLAIM_CARDS, promisesReply } from './waiting-views.ts';

const SHOPKEEPERS = [RAMESH, LATHA, PRAVEEN_1, SURESH];

function claim(shopkeeperId: string, amount: number, entryDate: string): BookEntry {
  return bookEntry({ shopkeeperId, kind: 'payment', amount, entryDate, status: 'claimed' });
}

function promise(
  shopkeeperId: string,
  fields: Pick<AlertPromise, 'amount' | 'promiseDate' | 'status'>,
): AlertPromise {
  return {
    id: crypto.randomUUID(),
    shopkeeperId,
    createdAt: '2026-10-30T10:00:00Z',
    ...fields,
  };
}

Deno.test('claims view › nobody waiting → one short line', () => {
  const replies = claimsReplies({
    shopkeepers: SHOPKEEPERS,
    entries: [bookEntry({ kind: 'payment', amount: 500 })],
    language: 'en',
  });
  assertEquals(replyText(replies), '✅ No payment claims are waiting.');
});

Deno.test('claims view › title with count and total, then one card per claim, newest first', () => {
  const replies = claimsReplies({
    shopkeepers: SHOPKEEPERS,
    entries: [
      claim(RAMESH.id, 2000, '2026-10-30'),
      claim(LATHA.id, 1500.5, '2026-11-01'),
      claim('5e000000-0000-4000-8000-0000000000ff', 900, '2026-11-01'),
    ],
    language: 'en',
  });
  assertEquals(replies.length, 3);
  assertEquals(
    replies[0]?.kind === 'text' ? replies[0].text : '',
    '💰 *Payment claims waiting: 2* · ₹3,500.50\n\nThey count only after you tap Confirm received.',
  );
  const [, latha, ramesh] = replies;
  assert(latha?.kind === 'buttons' && ramesh?.kind === 'buttons');
  assertStringIncludes(latha.text, 'Latha (Latha General Stores)');
  assertStringIncludes(ramesh.text, 'Ramesh (Ramesh Kirana)');
  const tap = parseTap(latha.buttons[0]?.id ?? '');
  assertEquals(tap?.kind === 'claim' && tap.confirm, true);
  assertEquals(parseTap(latha.buttons[1]?.id ?? '')?.kind, 'claim');
});

Deno.test('claims view › a name that is its shop is shown once; same day → newest saved first', () => {
  const shop = { ...SURESH, shopName: SURESH.name };
  const older = { ...claim(SURESH.id, 100, '2026-11-01'), createdAt: '2026-11-01T09:00:00Z' };
  const newer = { ...claim(SURESH.id, 200, '2026-11-01'), createdAt: '2026-11-01T11:00:00Z' };
  const replies = claimsReplies({ shopkeepers: [shop], entries: [older, newer], language: 'en' });
  const [, first, second] = replies;
  assert(first?.kind === 'buttons' && second?.kind === 'buttons');
  assert(first.text.startsWith('Suresh '), first.text);
  assertStringIncludes(first.text, '₹200');
  assertStringIncludes(second.text, '₹100');
});

Deno.test('claims view › more than 5 → 5 cards and "and N more"; Telugu has its English', () => {
  const entries = Array.from(
    { length: MAX_CLAIM_CARDS + 2 },
    (_, index) => claim(RAMESH.id, 100, `2026-10-2${index}`),
  );
  const replies = claimsReplies({ shopkeepers: SHOPKEEPERS, entries, language: 'te' });
  assertEquals(replies.length, MAX_CLAIM_CARDS + 1);
  const title = replies[0];
  assert(title?.kind === 'text');
  assertStringIncludes(title.text, 'వేచి ఉన్న చెల్లింపు క్లెయిమ్‌లు: 7');
  assertStringIncludes(title.english ?? '', 'Payment claims waiting: 7');
  assertStringIncludes(title.english ?? '', '…and 2 more');
});

Deno.test('promises view › none at all → one short line, in Hindi with its English', () => {
  const reply = promisesReply({
    lists: { open: [], broken: [] },
    shopkeepers: SHOPKEEPERS,
    language: 'hi',
  });
  assert(reply.kind === 'text');
  assertStringIncludes(reply.text, 'इस हफ़्ते कोई वादा नहीं');
  assertStringIncludes(reply.english ?? '', 'No promises fall due this week');
});

Deno.test('promises view › this week and broken, each section with its count; empty says None', () => {
  const open = [promise(RAMESH.id, { amount: 2000, promiseDate: '2026-11-04', status: 'open' })];
  const broken = [promise(LATHA.id, { amount: 1000, promiseDate: '2026-10-28', status: 'broken' })];
  const both = promisesReply({ lists: { open, broken }, shopkeepers: SHOPKEEPERS, language: 'en' });
  assertEquals(
    both.kind === 'text' ? both.text : '',
    [
      '🤝 *Promises*',
      '',
      '*This week (1)*',
      '• Ramesh (Ramesh Kirana) · ₹2,000 by Wed 4 Nov',
      '',
      '*Broken, last 14 days (1)*',
      '• Latha (Latha General Stores) · ₹1,000 was due Wed 28 Oct',
    ].join('\n'),
  );
  const onlyBroken = promisesReply({
    lists: { open: [], broken },
    shopkeepers: SHOPKEEPERS,
    language: 'en',
  });
  assertStringIncludes(replyText([onlyBroken]), '*This week (0)*\nNone');
  assertEquals(FAKE_TODAY, '2026-11-02');
});

Deno.test('promises view › over 10 in a section → 10 lines and "and N more"; unknown → Someone', () => {
  const open = Array.from(
    { length: 12 },
    () => promise(SURESH.id, { amount: 100, promiseDate: '2026-11-05', status: 'open' }),
  );
  const orphan = promise('5e000000-0000-4000-8000-0000000000ff', {
    amount: 300,
    promiseDate: '2026-10-25',
    status: 'broken',
  });
  const text = replyText([
    promisesReply({ lists: { open, broken: [orphan] }, shopkeepers: [SURESH], language: 'en' }),
  ]);
  assertEquals(text.split('\n').filter((line) => line.startsWith('• Suresh')).length, 10);
  assertStringIncludes(text, '2 more');
  assertStringIncludes(text, '• Someone · ₹300 was due');
});
