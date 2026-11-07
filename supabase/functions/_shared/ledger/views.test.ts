// supabase/functions/_shared/ledger/views.test.ts
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import {
  bookEntry,
  CLAIM_ID,
  FAKE_TODAY,
  fakeBookEntries,
  LATHA,
  PRAVEEN_1,
  PRAVEEN_2,
  RAMESH,
} from '../db/fake-book-repository.ts';
import type { BookShopkeeper } from '../db/book-repository.ts';
import { claimButtonId } from '../cards/ids.ts';
import { replyText } from '../whatsapp/replies.ts';
import {
  closedReply,
  lookupPickReply,
  pendingReply,
  type ScoreTag,
  shopkeeperReplies,
} from './views.ts';

const SHOPKEEPERS = [RAMESH, LATHA, PRAVEEN_1, PRAVEEN_2];
const VIEW = {
  shopkeepers: SHOPKEEPERS,
  entries: fakeBookEntries(),
  today: FAKE_TODAY,
  language: 'en' as const,
  scores: new Map<string, ScoreTag>(),
};

Deno.test('pending › biggest first, with days overdue or "not due yet"', () => {
  const text = replyText([pendingReply(VIEW)]);
  assertEquals(
    text,
    '📒 *Pending:* 2 people owe you ₹10,500\n\n' +
      '1. Ramesh (Ramesh Kirana) · ₹8,500 · 12 days overdue\n' +
      '2. Latha (Latha General Stores) · ₹2,000 · 8 days overdue',
  );
});

Deno.test('pending › a claimed payment does not lower the balance', () => {
  assertStringIncludes(replyText([pendingReply(VIEW)]), '₹8,500');
});

Deno.test('pending › at most 10 rows, then "and N more"', () => {
  const many: BookShopkeeper[] = Array.from(
    { length: 12 },
    (_, i) => ({ ...RAMESH, id: `s${i}`, name: `S${i}`, shopName: `S${i}` }),
  );
  const entries = many.map((s, i) =>
    bookEntry({
      shopkeeperId: s.id,
      kind: 'credit',
      amount: 100 * (i + 1),
      entryDate: '2026-11-01',
      dueDate: '2026-11-10',
    })
  );
  const lines = replyText([pendingReply({ ...VIEW, shopkeepers: many, entries })]).split('\n');
  assertEquals(lines.length, 13);
  assertEquals(lines[2], '1. S11 · ₹1,200 · not due yet');
  assertEquals(lines[12], '…and 2 more');
});

Deno.test('pending › each row shows the score band (SPEC §6.1); "New" without a number', () => {
  const scores = new Map<string, ScoreTag>([
    [RAMESH.id, { score: 42, band: 'risky' }],
    [LATHA.id, { score: 100, band: 'new' }],
  ]);
  const lines = replyText([pendingReply({ ...VIEW, scores })]).split('\n');
  assertEquals(lines[2], '1. Ramesh (Ramesh Kirana) · ₹8,500 · 12 days overdue · Risky 42');
  assert(lines[3]?.endsWith(' · New'), lines[3]);
  const hindi = replyText([pendingReply({ ...VIEW, scores, language: 'hi' })]);
  assertStringIncludes(hindi, 'जोखिम 42');
});

Deno.test('pending › a row without a score shows no band', () => {
  const lines = replyText([pendingReply(VIEW)]).split('\n');
  assert(!lines[2]?.includes('Risky'));
});

Deno.test("pending › nobody owing gives a friendly line, in the owner's language", () => {
  assertEquals(
    replyText([pendingReply({ ...VIEW, entries: [] })]),
    'Nobody owes you anything right now.',
  );
  assertEquals(
    replyText([pendingReply({ ...VIEW, entries: [], language: 'te' })]),
    'ప్రస్తుతం ఎవరూ బాకీ లేరు.',
  );
});

Deno.test('closed › credits paid off this month only', () => {
  const text = replyText([closedReply(VIEW)]);
  assertEquals(
    text,
    '✅ *Paid off this month*\n\n• Praveen (Praveen Bakery) · ₹1,500 · cleared Sun 1 Nov',
  );
});

Deno.test('closed › nothing paid off this month', () => {
  assertEquals(
    replyText([closedReply({ ...VIEW, today: '2026-12-15' })]),
    'No credit has been paid off this month yet.',
  );
});

Deno.test('lookup › balance, last 5 entries, last promise and open claims', () => {
  const replies = shopkeeperReplies({
    lastNote: null,
    shopkeeper: RAMESH,
    entries: fakeBookEntries().filter((e) => e.shopkeeperId === RAMESH.id),
    lastPromise: { amount: 3000, promiseDate: '2026-10-30', status: 'broken' },
    score: null,
    today: FAKE_TODAY,
    language: 'en',
  });
  const summary = replyText(replies.slice(0, 1)).split('\n');
  assertEquals(summary.slice(0, 5), [
    '👤 *Ramesh* · Ramesh Kirana, Old Town',
    'Balance: ₹8,500',
    'Overdue: ₹5,000 · 12 days',
    'Next due: ₹3,500 · Thu 5 Nov',
    '',
  ]);
  assertEquals(summary[6], '• Sun 1 Nov · Payment ₹2,000 (claimed, not confirmed)');
  assertEquals(summary.at(-3), '');
  assertEquals(summary.filter((line) => line.startsWith('• ')).length, 5);
  assertEquals(summary.at(-2), 'Last promise: ₹3,000 · Fri 30 Oct (broken)');
  assertEquals(summary.at(-1), 'Open claims: 1');
});

Deno.test('lookup › shows the score and band after the last promise (SPEC §6.1)', () => {
  const lines = replyText(
    shopkeeperReplies({
      lastNote: null,
      shopkeeper: RAMESH,
      entries: [],
      lastPromise: { amount: 3000, promiseDate: '2026-10-30', status: 'broken' },
      score: { score: 42, band: 'risky' },
      today: FAKE_TODAY,
      language: 'en',
    }).slice(0, 1),
  ).split('\n');
  assertEquals(lines.slice(-2), [
    'Last promise: ₹3,000 · Fri 30 Oct (broken)',
    'Score: 42 (Risky)',
  ]);
  const telugu = shopkeeperReplies({
    lastNote: null,
    shopkeeper: RAMESH,
    entries: [],
    lastPromise: null,
    score: { score: 80, band: 'reliable' },
    today: FAKE_TODAY,
    language: 'te',
  });
  assertStringIncludes(replyText(telugu), 'స్కోరు: 80 (నమ్మకమైన)');
});

Deno.test('lookup › each open claim gets Confirm received / Not received buttons', () => {
  const replies = shopkeeperReplies({
    lastNote: null,
    shopkeeper: RAMESH,
    entries: fakeBookEntries().filter((e) => e.shopkeeperId === RAMESH.id),
    lastPromise: null,
    score: null,
    today: FAKE_TODAY,
    language: 'en',
  });
  const card = replies[1];
  assertEquals(card?.kind === 'buttons' ? card.buttons.map((b) => b.id) : [], [
    claimButtonId(CLAIM_ID, true, 'en'),
    claimButtonId(CLAIM_ID, false, 'en'),
  ]);
  assertStringIncludes(replyText(replies), 'Last promise: none');
});

Deno.test('lookup › a new shopkeeper with no entries and no claims', () => {
  const replies = shopkeeperReplies({
    lastNote: null,
    shopkeeper: LATHA,
    entries: [],
    lastPromise: null,
    score: null,
    today: FAKE_TODAY,
    language: 'hi',
  });
  assertEquals(replies.map((reply) => reply.kind), ['text', 'buttons']);
  assert(replyText(replies).includes('₹0'));
});

Deno.test('lookup › a rejected claim is marked and a confirmed one is plain', () => {
  const entries = [
    bookEntry({ kind: 'payment', amount: 700, entryDate: '2026-11-01', status: 'rejected' }),
  ];
  const text = replyText(
    shopkeeperReplies({
      lastNote: null,
      shopkeeper: RAMESH,
      entries,
      lastPromise: null,
      score: null,
      today: FAKE_TODAY,
      language: 'en',
    }),
  );
  assertStringIncludes(text, 'Payment ₹700 (not received)');
});

Deno.test('lookup pick › one row per shopkeeper with shop and area', () => {
  const reply = lookupPickReply('Praveen', [PRAVEEN_1, PRAVEEN_2], 'en');
  assertEquals(reply.kind === 'list' ? reply.rows.map((r) => r.description) : [], [
    'Praveen Bakery, Sai Nagar',
    'Praveen Super Market, Ganesh Nagar',
  ]);
  assertEquals(replyText([reply]).split('\n')[0], 'Which Praveen?');
});

Deno.test('lookup › entries on the same day are newest-created first', () => {
  const entries = [
    bookEntry({
      kind: 'credit',
      amount: 100,
      entryDate: '2026-11-01',
      createdAt: '2026-11-01T08:00:00Z',
    }),
    bookEntry({
      kind: 'credit',
      amount: 200,
      entryDate: '2026-11-01',
      createdAt: '2026-11-01T09:00:00Z',
    }),
  ];
  const text = replyText(
    shopkeeperReplies({
      lastNote: null,
      shopkeeper: RAMESH,
      entries,
      lastPromise: null,
      score: null,
      today: FAKE_TODAY,
      language: 'en',
    }),
  );
  assert(text.indexOf('₹200') < text.indexOf('₹100'));
});

Deno.test('lookup › shows the last call note for the owner, as its own block (M6)', () => {
  const replies = shopkeeperReplies({
    lastNote: 'Promised Monday; shop was busy.',
    shopkeeper: RAMESH,
    entries: [],
    lastPromise: null,
    score: null,
    today: FAKE_TODAY,
    language: 'en',
  });
  const lookup = replyText(replies.slice(0, 1));
  assert(lookup.endsWith('\n\n📝 Last call note: Promised Monday; shop was busy.'), lookup);
});

Deno.test('lookup › no note → no note line', () => {
  const replies = shopkeeperReplies({
    lastNote: null,
    shopkeeper: RAMESH,
    entries: [],
    lastPromise: null,
    score: null,
    today: FAKE_TODAY,
    language: 'te',
  });
  assert(!replyText(replies).includes('📝'));
});

Deno.test('lookup › reply links: View in books is the last line; absent or null → no line', () => {
  const view = {
    lastNote: null,
    shopkeeper: RAMESH,
    entries: [],
    lastPromise: null,
    score: null,
    today: FAKE_TODAY,
    language: 'en',
  } as const;
  const link = 'https://x.example/shopkeepers?id=1#t=T';
  const lines = replyText(shopkeeperReplies({ ...view, booksLink: link }).slice(0, 1)).split('\n');
  assertEquals(lines.slice(-2), ['', `📒 View in books: ${link}`]);
  assert(!replyText(shopkeeperReplies({ ...view, booksLink: null })).includes('📒'));
  assert(!replyText(shopkeeperReplies(view)).includes('📒'));
});
