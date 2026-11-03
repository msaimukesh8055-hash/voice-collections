// supabase/functions/_shared/cards/cards.test.ts
// Cards end to end over the fake book: start → tap → what was (and was not) saved.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { LATHA, PRAVEEN_1, PRAVEEN_2, RAMESH } from '../db/fake-book-repository.ts';
import type { Reply } from '../whatsapp/replies.ts';
import { replyText } from '../whatsapp/replies.ts';
import { handleCardTap } from './actions.ts';
import { randomFakePhone } from './context.ts';
import { type BotContext } from './context.ts';
import { cardButtonId, parseTap, pickRowId } from './ids.ts';
import { startEntry } from './start.ts';
import {
  type BotSetup,
  botSetup,
  FAKE_NEW_PHONE,
  FAKE_NOW,
  refreshed,
} from './__fixtures__/bot-context.ts';

const CREDIT = { type: 'credit', amount: 5000, dueDate: '2026-11-15', note: null } as const;
const PAYMENT = { type: 'payment', amount: 2000, dueDate: null, note: null } as const;

function buttonsOf(reply: Reply | undefined): string[] {
  if (reply?.kind === 'buttons') return reply.buttons.map((button) => button.id);
  if (reply?.kind === 'list') return reply.rows.map((row) => row.id);
  return [];
}

function actionIdOf(reply: Reply | undefined): string {
  const tap = parseTap(buttonsOf(reply)[0] ?? '');
  return tap?.kind === 'card' || tap?.kind === 'pick' ? tap.actionId : '';
}

async function tap(id: string, ctx: BotContext): Promise<readonly Reply[]> {
  const parsed = parseTap(id);
  if (parsed?.kind !== 'card' && parsed?.kind !== 'pick') throw new Error('not a card tap');
  return await handleCardTap(parsed, ctx);
}

async function creditCard(setup: BotSetup, name = 'Ramesh'): Promise<string> {
  const [card] = await startEntry({ name, draft: CREDIT, language: 'en' }, setup.ctx);
  return actionIdOf(card);
}

function rameshEntries(setup: BotSetup): number {
  return setup.state.entries.filter((entry) => entry.shopkeeperId === RAMESH.id).length;
}

Deno.test('card › add credit shows amount, due date and balance after, and saves nothing', async () => {
  const setup = botSetup();
  const before = rameshEntries(setup);
  const [card] = await startEntry({ name: 'ramesh', draft: CREDIT, language: 'en' }, setup.ctx);
  assertEquals(replyText([card!]).split('\n').slice(0, 4), [
    '*Add credit*',
    'Ramesh (Ramesh Kirana)',
    '₹5,000 · due Sun 15 Nov',
    'Balance after: ₹13,500',
  ]);
  assertEquals(buttonsOf(card).length, 3);
  assertEquals(rameshEntries(setup), before);
  assertEquals(
    setup.state.actions[0]?.expiresAt,
    new Date(FAKE_NOW.getTime() + 30 * 60_000).toISOString(),
  );
});

Deno.test('card › a missing due date shows the 15-day default', async () => {
  const setup = botSetup();
  const [card] = await startEntry({
    name: 'Latha',
    draft: { ...CREDIT, dueDate: null, note: 'rice' },
    language: 'en',
  }, setup.ctx);
  const text = replyText([card!]);
  assertStringIncludes(text, 'due Tue 17 Nov (15 days, default)');
  assertStringIncludes(text, 'Note: rice');
});

Deno.test('card › Save writes the entry once and replies with the new balance', async () => {
  const setup = botSetup();
  const actionId = await creditCard(setup);
  const saved = await tap(cardButtonId(actionId, 'save'), setup.ctx);
  assertEquals(replyText(saved), 'Saved. Ramesh now owes ₹13,500.');
  const again = await tap(cardButtonId(actionId, 'save'), setup.ctx);
  assertEquals(replyText(again), 'Already saved.');
  const added = setup.state.entries.filter((e) =>
    e.amount === 5000 && e.entryDate === '2026-11-02'
  );
  assertEquals(added.map((e) => [e.kind, e.dueDate, e.status]), [[
    'credit',
    '2026-11-15',
    'confirmed',
  ]]);
});

Deno.test('card › Cancel and Edit close the card and save nothing', async () => {
  const setup = botSetup();
  const before = rameshEntries(setup);
  const first = await creditCard(setup);
  const second = await creditCard(setup);
  assertEquals(
    replyText(await tap(cardButtonId(first, 'cancel'), setup.ctx)),
    'Cancelled. Nothing saved.',
  );
  assertStringIncludes(
    replyText(await tap(cardButtonId(second, 'edit'), setup.ctx)),
    'Ramesh 5000 due 20th',
  );
  assertEquals(replyText(await tap(cardButtonId(first, 'save'), setup.ctx)), 'Already done.');
  assertEquals(rameshEntries(setup), before);
});

Deno.test('card › an expired card saves nothing and is marked expired', async () => {
  const setup = botSetup();
  const actionId = await creditCard(setup);
  const later = { ...setup.ctx, now: new Date(FAKE_NOW.getTime() + 31 * 60_000) };
  assertEquals(
    replyText(await tap(cardButtonId(actionId, 'save'), later)),
    'This card has expired. Please send it again.',
  );
  assertEquals(setup.state.actions[0]?.status, 'expired');
  assertEquals(
    replyText(await tap(cardButtonId(actionId, 'save'), setup.ctx)),
    'This card has expired. Please send it again.',
  );
});

Deno.test('card › an unknown card or a button from another kind of card does nothing', async () => {
  const setup = botSetup();
  const unknown = await tap(
    cardButtonId('ac000000-0000-4000-8000-0000000000ff', 'save'),
    setup.ctx,
  );
  assertEquals(replyText(unknown), 'This card has expired. Please send it again.');
  const actionId = await creditCard(setup);
  assertEquals(
    replyText(await tap(cardButtonId(actionId, 'yes'), setup.ctx)),
    'This card has expired. Please send it again.',
  );
  assertEquals(setup.state.actions[0]?.status, 'open');
});

Deno.test('card › a payment shows the balance after; more than owed is warned, not blocked', async () => {
  const setup = botSetup();
  const [part] = await startEntry({ name: 'Ramesh', draft: PAYMENT, language: 'en' }, setup.ctx);
  assertStringIncludes(replyText([part!]), 'Balance after: ₹6,500');
  const [over] = await startEntry({
    name: 'Ramesh',
    draft: { ...PAYMENT, amount: 9000 },
    language: 'en',
  }, setup.ctx);
  assertStringIncludes(replyText([over!]), 'Balance after: ₹0\n⚠️ More than he owes (₹8,500)');
  assertEquals(
    replyText(await tap(cardButtonId(actionIdOf(part), 'save'), setup.ctx)),
    'Saved. Ramesh now owes ₹6,500.',
  );
});

Deno.test('card › a failed ledger write reopens the card so Save can be tapped again', async () => {
  const setup = botSetup({ book: { insertEntry: () => Promise.reject(new Error('db down')) } });
  const actionId = await creditCard(setup);
  assertEquals(
    replyText(await tap(cardButtonId(actionId, 'save'), setup.ctx)),
    "Couldn't save. Please tap Save again.",
  );
  assertEquals(setup.state.actions[0]?.status, 'open');
  assertEquals(setup.logs[0]?.event, 'card_save_failed');
});

Deno.test('card › two shopkeepers with the name → pick list → Save card for the chosen one', async () => {
  const setup = botSetup();
  const [list] = await startEntry({ name: 'Praveen', draft: CREDIT, language: 'en' }, setup.ctx);
  const actionId = actionIdOf(list);
  assertEquals(buttonsOf(list), [pickRowId(actionId, 0), pickRowId(actionId, 1)]);
  const [card] = await tap(pickRowId(actionId, 1), setup.ctx);
  assertStringIncludes(replyText([card!]), `${PRAVEEN_2.name} (${PRAVEEN_2.shopName})`);
  assertEquals(replyText(await tap(pickRowId(actionId, 0), setup.ctx)), 'Already done.');
  assert(!replyText([card!]).includes(PRAVEEN_1.shopName));
});

Deno.test('card › a pick row outside the list does nothing', async () => {
  const setup = botSetup();
  const [list] = await startEntry({ name: 'Praveen', draft: CREDIT, language: 'en' }, setup.ctx);
  assertEquals(
    replyText(await tap(pickRowId(actionIdOf(list), 9), setup.ctx)),
    'This card has expired. Please send it again.',
  );
});

Deno.test('card › a new name → "Add as new shopkeeper?" → Yes → shopkeeper + Save card', async () => {
  const setup = botSetup();
  const [question] = await startEntry({
    name: 'Suresh Babu',
    draft: { ...PAYMENT, type: 'credit', amount: 3000 },
    language: 'en',
  }, setup.ctx);
  assertEquals(replyText([question!]).split('\n')[0], 'Add *Suresh Babu* as a new shopkeeper?');
  const replies = await tap(cardButtonId(actionIdOf(question), 'yes'), setup.ctx);
  assertStringIncludes(replyText(replies), 'Added Suresh Babu.');
  assertEquals(setup.state.newShopkeepers, [{
    ownerId: setup.ctx.owner.id,
    name: 'Suresh Babu',
    shopName: 'Suresh Babu',
    area: 'Anantapur',
    phone: FAKE_NEW_PHONE,
    language: 'te',
  }]);
  const saved = await tap(cardButtonId(actionIdOf(replies[1]), 'save'), refreshed(setup));
  assertEquals(replyText(saved), 'Saved. Suresh Babu now owes ₹3,000.');
});

Deno.test('card › No to a new shopkeeper saves nothing', async () => {
  const setup = botSetup();
  const [question] = await startEntry({ name: 'Venkat', draft: CREDIT, language: 'en' }, setup.ctx);
  assertEquals(
    replyText(await tap(cardButtonId(actionIdOf(question), 'no'), setup.ctx)),
    'Cancelled. Nothing saved.',
  );
  assertEquals(setup.state.newShopkeepers.length, 0);
});

Deno.test('card › a payment from an unknown name is refused', async () => {
  const setup = botSetup();
  const replies = await startEntry({ name: 'Venkat', draft: PAYMENT, language: 'en' }, setup.ctx);
  assertStringIncludes(replyText(replies), 'No shopkeeper called Venkat');
  assertEquals(setup.state.actions.length, 0);
});

Deno.test('card › replies use the language saved on the card', async () => {
  const setup = botSetup();
  const [card] = await startEntry({ name: 'Latha', draft: CREDIT, language: 'te' }, setup.ctx);
  assertStringIncludes(replyText([card!]), 'అప్పు జోడించండి');
  const saved = await tap(cardButtonId(actionIdOf(card), 'save'), setup.ctx);
  assertEquals(replyText(saved), `సేవ్ అయింది. ${LATHA.name} ఇప్పుడు ₹7,000 ఇవ్వాలి.`);
});

Deno.test('card › a second tap racing the first is told what happened', async () => {
  const setup = botSetup();
  const actionId = await creditCard(setup);
  const racing = botSetup({
    state: { actions: setup.state.actions },
    book: {
      transitionPendingAction: () => Promise.resolve(false),
      getPendingAction: setup.ctx.book.getPendingAction,
    },
  });
  setup.state.actions = setup.state.actions.map((a) => ({ ...a }));
  const replies = await tap(cardButtonId(actionId, 'save'), racing.ctx);
  assertEquals(replyText(replies), 'Already done.');
});

Deno.test('card › new shopkeeper phones are in the never-real range', () => {
  assertEquals(randomFakePhone(() => 0.1234), '+91 00000 91234');
  assertEquals(randomFakePhone(() => 0), '+91 00000 90000');
});

Deno.test('card › losing the race on Cancel, Yes or a pick row says "already done"', async () => {
  const setup = botSetup();
  const credit = await creditCard(setup);
  const [question] = await startEntry({ name: 'Venkat', draft: CREDIT, language: 'en' }, setup.ctx);
  const [list] = await startEntry({ name: 'Praveen', draft: CREDIT, language: 'en' }, setup.ctx);
  const losing = {
    ...setup.ctx,
    book: { ...setup.ctx.book, transitionPendingAction: () => Promise.resolve(false) },
  };
  for (
    const id of [
      cardButtonId(credit, 'cancel'),
      cardButtonId(actionIdOf(question), 'yes'),
      pickRowId(actionIdOf(list), 0),
    ]
  ) {
    assertEquals(replyText(await tap(id, losing)), 'Already done.', id);
  }
  assertEquals(setup.state.newShopkeepers.length, 0);
});

Deno.test('card › a card that vanished mid-tap is treated as expired', async () => {
  const setup = botSetup();
  const actionId = await creditCard(setup);
  let reads = 0;
  const book = {
    ...setup.ctx.book,
    transitionPendingAction: () => Promise.resolve(false),
    getPendingAction: (id: string) => {
      reads += 1;
      return reads === 1 ? setup.ctx.book.getPendingAction(id) : Promise.resolve(null);
    },
  };
  const replies = await tap(cardButtonId(actionId, 'save'), { ...setup.ctx, book });
  assertEquals(replyText(replies), 'This card has expired. Please send it again.');
});

Deno.test('card › a non-Error database failure on Save is still logged and reported', async () => {
  const setup = botSetup({ book: { insertEntry: () => Promise.reject('db down') } });
  const actionId = await creditCard(setup);
  assertEquals(
    replyText(await tap(cardButtonId(actionId, 'save'), setup.ctx)),
    "Couldn't save. Please tap Save again.",
  );
  assertEquals(setup.logs[0]?.fields['error'], 'unknown');
});

Deno.test('card › an unreadable card language falls back to the message language', async () => {
  const setup = botSetup({ language: 'hi' });
  const actionId = await creditCard(setup);
  setup.state.actions = setup.state.actions.map((action) => ({
    ...action,
    payload: { language: 'xx' },
  }));
  assertEquals(
    replyText(await tap(cardButtonId(actionId, 'cancel'), setup.ctx)),
    'रद्द। कुछ सेव नहीं हुआ।',
  );
});

Deno.test('card › Save still answers when the shopkeeper list is stale', async () => {
  const setup = botSetup();
  const actionId = await creditCard(setup);
  const saved = await tap(cardButtonId(actionId, 'save'), { ...setup.ctx, shopkeepers: [] });
  assertStringIncludes(replyText(saved), 'now owes ₹13,500');
});
