// supabase/functions/_shared/ledger/views-actions.test.ts
// M7 Decisions 8 and 9 in the ledger views: the lookup balance in short lines (EN/HI/TE, with the
// English rendering), "What next for Ramesh?" with its buttons, and the pending "Open a
// shopkeeper" list. Limits checked in every language.
import { assert, assertEquals } from '@std/assert';
import { parseTap } from '../cards/ids.ts';
import type { BookShopkeeper } from '../db/book-repository.ts';
import {
  bookEntry,
  FAKE_TODAY,
  fakeBookEntries,
  LATHA,
  PRAVEEN_1,
  PRAVEEN_2,
  RAMESH,
} from '../db/fake-book-repository.ts';
import { SUPPORTED_LANGUAGES } from '../schemas/shopkeeper.ts';
import { MAX_LIST_ROWS, type Reply, replyText } from '../whatsapp/replies.ts';
import { lookupActionsReply, pendingOpenList, shopkeeperReplies } from './views.ts';

const MAX_BUTTON_TITLE = 20;
const MAX_ROW_DESCRIPTION = 72;
const RAMESH_ENTRIES = fakeBookEntries().filter((entry) => entry.shopkeeperId === RAMESH.id);
const LOOKUP = {
  lastNote: null,
  shopkeeper: RAMESH,
  entries: RAMESH_ENTRIES,
  lastPromise: null,
  score: null,
  today: FAKE_TODAY,
  language: 'en',
} as const;

function buttonsOf(reply: Reply | undefined): Array<{ id: string; title: string }> {
  return reply?.kind === 'buttons' ? [...reply.buttons] : [];
}

Deno.test('lookup balance › short lines in Hindi and Telugu; English rendering under Telugu', () => {
  const hindi = replyText(shopkeeperReplies({ ...LOOKUP, language: 'hi' }).slice(0, 1));
  assertEquals(hindi.split('\n').slice(1, 4), [
    'बाकी: ₹8,500',
    'बकाया: ₹5,000 · 12 दिन',
    'अगला देय: ₹3,500 · Thu 5 Nov',
  ]);
  const [telugu] = shopkeeperReplies({ ...LOOKUP, language: 'te' });
  assertEquals(replyText([telugu!]).split('\n').slice(0, 4), [
    '👤 *Ramesh* · Ramesh Kirana, Old Town',
    'బాకీ: ₹8,500',
    'ఆలస్యం: ₹5,000 · 12 రోజులు',
    'తర్వాతి గడువు: ₹3,500 · Thu 5 Nov',
  ]);
  const english = telugu?.kind === 'text' ? telugu.english ?? '' : '';
  assertEquals(english.split('\n').slice(1, 4), [
    'Balance: ₹8,500',
    'Overdue: ₹5,000 · 12 days',
    'Next due: ₹3,500 · Thu 5 Nov',
  ]);
});

Deno.test('lookup balance › nothing overdue and nothing next → only the balance line', () => {
  const paidUp = [
    bookEntry({ kind: 'credit', amount: 500, entryDate: '2026-10-01', dueDate: '2026-11-20' }),
  ];
  const lines = replyText(shopkeeperReplies({ ...LOOKUP, entries: paidUp }).slice(0, 1))
    .split('\n');
  assertEquals(lines.slice(1, 3), ['Balance: ₹500', 'Next due: ₹500 · Fri 20 Nov']);
});

Deno.test('lookup actions › owes something → [Remind] [Paid in full] [Part payment], last', () => {
  const replies = shopkeeperReplies(LOOKUP);
  const next = replies.at(-1);
  assertEquals(replies.map((reply) => reply.kind), ['text', 'buttons', 'buttons']);
  assertEquals(next?.kind === 'buttons' ? next.text : '', 'What next for Ramesh?');
  assertEquals(buttonsOf(next).map((button) => parseTap(button.id)), [
    { kind: 'remind', shopkeeperId: RAMESH.id, language: 'en' },
    { kind: 'full_payment', shopkeeperId: RAMESH.id, language: 'en' },
    { kind: 'part_payment', shopkeeperId: RAMESH.id, language: 'en' },
  ]);
  assertEquals(buttonsOf(next).map((button) => button.title), [
    '📞 Remind',
    '✅ Paid in full',
    '💰 Part payment',
  ]);
});

Deno.test('lookup actions › owes nothing → just [Menu]', () => {
  const next = lookupActionsReply({ shopkeeper: LATHA, outstanding: 0, language: 'hi' });
  assertEquals(buttonsOf(next), [{ id: 'mn:menu:hi', title: '📋 मेनू' }]);
  assertEquals(next.kind === 'buttons' ? next.text : '', 'Latha के लिए आगे क्या?');
});

Deno.test('lookup actions › titles fit 20 characters in every language; Telugu has its English', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    for (const outstanding of [0, 100]) {
      const next = lookupActionsReply({ shopkeeper: RAMESH, outstanding, language });
      for (const button of buttonsOf(next)) {
        assert(button.title.length <= MAX_BUTTON_TITLE, `${language} ${button.title}`);
      }
    }
  }
  const telugu = lookupActionsReply({ shopkeeper: RAMESH, outstanding: 100, language: 'te' });
  assertEquals(telugu.kind === 'buttons' ? telugu.english : '', 'What next for Ramesh?');
});

Deno.test('pending list › the same top rows as the text, lk: ids, name · amount · days', () => {
  const view = {
    shopkeepers: [RAMESH, LATHA, PRAVEEN_1, PRAVEEN_2],
    entries: fakeBookEntries(),
    today: FAKE_TODAY,
    language: 'en',
  } as const;
  const list = pendingOpenList(view);
  assertEquals(list?.kind, 'list');
  if (list?.kind !== 'list') return;
  assertEquals(list.text, 'Tap a name to open their account.');
  assertEquals(list.buttonLabel, 'Open…');
  assertEquals(list.rows, [
    { id: `lk:${RAMESH.id}:en`, title: 'Ramesh', description: '₹8,500 · 12 days overdue' },
    { id: `lk:${LATHA.id}:en`, title: 'Latha', description: '₹2,000 · 8 days overdue' },
  ]);
});

Deno.test('pending list › at most 10 rows; not due yet; Telugu with its English body', () => {
  const many: BookShopkeeper[] = Array.from(
    { length: 12 },
    (_, i) => ({ ...RAMESH, id: `s${i}`, name: `Shopkeeper Number ${i}`, shopName: `S${i}` }),
  );
  const entries = many.map((each, i) =>
    bookEntry({
      shopkeeperId: each.id,
      kind: 'credit',
      amount: 100 * (i + 1),
      entryDate: '2026-11-01',
      dueDate: '2026-11-10',
    })
  );
  const list = pendingOpenList({ shopkeepers: many, entries, today: FAKE_TODAY, language: 'te' });
  if (list?.kind !== 'list') throw new Error('no list');
  assertEquals(list.rows.length, MAX_LIST_ROWS);
  assertEquals(list.rows[0]?.title, 'Shopkeeper Number 11');
  assertEquals(list.rows[0]?.description, '₹1,200 · ఇంకా గడువు రాలేదు');
  assert(list.rows.every((row) => (row.description ?? '').length <= MAX_ROW_DESCRIPTION));
  assertEquals(list.english, 'Tap a name to open their account.');
  assertEquals(list.buttonLabel, 'చూడండి…');
});

Deno.test('pending list › nobody owes → no list', () => {
  const view = { shopkeepers: [RAMESH], entries: [], today: FAKE_TODAY, language: 'en' } as const;
  assertEquals(pendingOpenList(view), null);
});

// ---- Tests — Build A (tester): worst-case limits in every language ----

Deno.test('pending list › worst case (₹10,00,000, 999 days late) still fits, in every language', () => {
  const entries = [
    bookEntry({
      kind: 'credit',
      amount: 1_000_000,
      entryDate: '2024-01-01',
      dueDate: '2024-02-07',
    }),
  ];
  for (const language of SUPPORTED_LANGUAGES) {
    const list = pendingOpenList({ shopkeepers: [RAMESH], entries, today: FAKE_TODAY, language });
    if (list?.kind !== 'list') throw new Error(`no list in ${language}`);
    const description = list.rows[0]?.description ?? '';
    assert(description.includes('₹10,00,000') && description.includes('999'), description);
    assert(description.length <= MAX_ROW_DESCRIPTION, `${language} ${description}`);
    assert(list.buttonLabel.length <= MAX_BUTTON_TITLE, language);
  }
});

Deno.test('lookup actions › a long shopkeeper name keeps the buttons and fits the body', () => {
  const longName = { ...RAMESH, name: 'Venkata Satyanarayana Murthy Garu' };
  for (const language of SUPPORTED_LANGUAGES) {
    const next = lookupActionsReply({ shopkeeper: longName, outstanding: 999_999, language });
    assertEquals(next.kind === 'buttons' ? next.buttons.length : 0, 3, language);
    assert(replyText([next]).length <= 1024, language);
    for (const button of next.kind === 'buttons' ? next.buttons : []) {
      assert(!button.id.includes('999'), button.id);
    }
  }
});
