// supabase/functions/_shared/cards/full-payment.test.ts
// [Paid in full] and [Part payment] after a lookup (M7 Decision 9). Money: 100% tested. The
// amount is worked out at tap time from confirmed entries on the demo-clock date; nothing is
// saved before Save; a second tap makes a new card, never a write.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { bookEntry, LATHA, PRAVEEN_1, RAMESH, SURESH } from '../db/fake-book-repository.ts';
import { replyText } from '../whatsapp/replies.ts';
import { handleCardTap } from './actions.ts';
import { cardButtonId, parseTap } from './ids.ts';
import { partPaymentHint, startFullPayment } from './full-payment.ts';
import { botSetup } from './__fixtures__/bot-context.ts';
import { EntryPayloadSchema } from './schemas.ts';

const UNKNOWN_ID = 'aa000000-0000-4000-8000-0000000000ff';

function cardActionId(reply: unknown): string {
  const first = (reply as { buttons?: Array<{ id: string }> }).buttons?.[0]?.id ?? '';
  const tap = parseTap(first);
  return tap?.kind === 'card' ? tap.actionId : '';
}

Deno.test('paid in full › the card is for his whole balance; the claimed ₹2,000 does not count', async () => {
  const setup = botSetup();
  const before = setup.state.entries.length;
  const [card] = await startFullPayment(RAMESH.id, setup.ctx, 'en');
  assertEquals(card?.kind, 'buttons');
  const text = replyText([card!]);
  assertStringIncludes(text, '💰 *Payment received*');
  assertStringIncludes(text, 'Ramesh (Ramesh Kirana)\n₹8,500');
  assertStringIncludes(text, 'Balance after: ₹0');
  const payload = EntryPayloadSchema.parse(setup.state.actions[0]?.payload);
  assertEquals(payload.draft, {
    type: 'payment',
    amount: 8500,
    dueDate: null,
    note: null,
    dueDefaulted: false,
  });
  assertEquals(setup.state.entries.length, before, 'nothing saved before Save');
});

Deno.test('paid in full › part payments already made are taken off; paise kept exactly', async () => {
  const entries = [
    bookEntry({ kind: 'credit', amount: 1000.5, entryDate: '2026-10-01', dueDate: '2026-10-20' }),
    bookEntry({ kind: 'credit', amount: 2000, entryDate: '2026-10-25', dueDate: '2026-11-10' }),
    bookEntry({ kind: 'payment', amount: 700.25, entryDate: '2026-10-28' }),
    bookEntry({ kind: 'payment', amount: 500, entryDate: '2026-10-29', status: 'rejected' }),
  ];
  const setup = botSetup({ state: { entries } });
  await startFullPayment(RAMESH.id, setup.ctx, 'en');
  const payload = EntryPayloadSchema.parse(setup.state.actions[0]?.payload);
  assertEquals(payload.draft.amount, 2300.25);
});

Deno.test('paid in full › uses the demo-clock today (a future credit still counts as owed)', async () => {
  const entries = [
    bookEntry({ kind: 'credit', amount: 4000, entryDate: '2026-11-01', dueDate: '2026-12-01' }),
  ];
  const setup = botSetup({ state: { entries } });
  await startFullPayment(RAMESH.id, setup.ctx, 'en');
  assertEquals(EntryPayloadSchema.parse(setup.state.actions[0]?.payload).draft.amount, 4000);
});

Deno.test('paid in full › owes nothing → a line, no card; in each language', async () => {
  for (
    const [language, line] of [
      ['en', 'Praveen owes nothing right now.'],
      ['hi', 'Praveen पर अभी कुछ बाकी नहीं है।'],
      ['te', 'Praveen ప్రస్తుతం ఏమీ బాకీ లేరు.'],
    ] as const
  ) {
    const setup = botSetup();
    const replies = await startFullPayment(PRAVEEN_1.id, setup.ctx, language);
    assertEquals(replyText(replies), line);
    assertEquals(setup.state.actions.length, 0, language);
  }
  const noEntries = botSetup();
  assertStringIncludes(
    replyText(await startFullPayment(SURESH.id, noEntries.ctx, 'en')),
    'nothing',
  );
});

Deno.test('paid in full › an unknown shopkeeper → the expired line, no card', async () => {
  const setup = botSetup();
  const replies = await startFullPayment(UNKNOWN_ID, setup.ctx, 'en');
  assertEquals(replyText(replies), 'This card has expired. Please send it again.');
  assertEquals(setup.state.actions.length, 0);
});

Deno.test('paid in full › a second tap makes a new card; only Save writes, once', async () => {
  const setup = botSetup();
  const before = setup.state.entries.length;
  const [first] = await startFullPayment(LATHA.id, setup.ctx, 'en');
  const [second] = await startFullPayment(LATHA.id, setup.ctx, 'en');
  assertEquals(setup.state.actions.length, 2);
  assertEquals(setup.state.entries.length, before);
  const save = parseTap(cardButtonId(cardActionId(second), 'save'));
  if (save?.kind !== 'card') throw new Error('not a card');
  await handleCardTap(save, setup.ctx);
  assertEquals(setup.state.entries.length, before + 1);
  assertEquals(setup.state.entries.at(-1)?.amount, 2000);
  assertEquals(cardActionId(first) !== cardActionId(second), true);
});

Deno.test('paid in full › Telugu card with its English rendering', async () => {
  const setup = botSetup();
  const [card] = await startFullPayment(RAMESH.id, setup.ctx, 'te');
  assertStringIncludes(replyText([card!]), '💰 *చెల్లింపు అందింది*');
  assertStringIncludes(card?.kind === 'buttons' ? card.english ?? '' : '', '💰 *Payment received*');
});

Deno.test('part payment › a hint with his name; no card, nothing stored', () => {
  const setup = botSetup();
  assertEquals(
    replyText(partPaymentHint(RAMESH.id, setup.ctx, 'en')),
    'How much did Ramesh pay? Send e.g. *Ramesh paid 2000*',
  );
  const [telugu] = partPaymentHint(RAMESH.id, setup.ctx, 'te');
  assertEquals(
    telugu?.kind === 'text' ? telugu.english : '',
    'How much did Ramesh pay? Send e.g. *Ramesh paid 2000*',
  );
  assertEquals(
    replyText(partPaymentHint(UNKNOWN_ID, setup.ctx, 'hi')),
    'यह कार्ड पुराना हो गया। कृपया फिर से भेजें।',
  );
  assertEquals(setup.state.actions.length, 0);
});

// ---- Tests — Build A (tester): money edge cases ----

Deno.test('paid in full › overpaid (payments above credits) → owes nothing, no card', async () => {
  const entries = [
    bookEntry({ kind: 'credit', amount: 1000, entryDate: '2026-10-01', dueDate: '2026-10-20' }),
    bookEntry({ kind: 'payment', amount: 1500, entryDate: '2026-10-25' }),
  ];
  const setup = botSetup({ state: { entries } });
  const replies = await startFullPayment(RAMESH.id, setup.ctx, 'en');
  assertEquals(replyText(replies), 'Ramesh owes nothing right now.');
  assertEquals(setup.state.actions.length, 0);
});

Deno.test('paid in full › overdue and not-yet-due credit add up; only claimed payments wait', async () => {
  const entries = [
    bookEntry({ kind: 'credit', amount: 3000, entryDate: '2026-10-01', dueDate: '2026-10-15' }),
    bookEntry({ kind: 'credit', amount: 5500, entryDate: '2026-10-30', dueDate: '2026-11-20' }),
    bookEntry({ kind: 'payment', amount: 1000, entryDate: '2026-10-31', status: 'claimed' }),
    bookEntry({ kind: 'payment', amount: 500, entryDate: '2026-10-31' }),
  ];
  const setup = botSetup({ state: { entries } });
  await startFullPayment(RAMESH.id, setup.ctx, 'hi');
  const payload = EntryPayloadSchema.parse(setup.state.actions[0]?.payload);
  assertEquals([payload.draft.type, payload.draft.amount, payload.language], [
    'payment',
    8000,
    'hi',
  ]);
});

Deno.test('paid in full › the card buttons carry the card id only, never the amount', async () => {
  const setup = botSetup();
  const [card] = await startFullPayment(RAMESH.id, setup.ctx, 'en');
  const ids = card?.kind === 'buttons' ? card.buttons.map((button) => button.id) : [];
  assertEquals(ids.length, 3);
  for (const id of ids) {
    assert(!id.includes('8500') && !id.includes('8,500'), id);
    assertEquals(parseTap(id)?.kind, 'card', id);
  }
});
