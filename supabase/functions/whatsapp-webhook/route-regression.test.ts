// supabase/functions/whatsapp-webhook/route-regression.test.ts
// M7 Build A regression through the router (tester): typed commands still work as before (fixed
// parser, no LLM call); a shopkeeper id we never sent (another owner's, or made up) in an lk:,
// pf:, pp: or rm: tap does nothing; every new Telugu reply carries its English rendering. Fakes.
import { assert, assertEquals } from '@std/assert';
import type { BrainLlm } from '../_shared/brain/llm.ts';
import { TELUGU_SCRIPT } from '../_shared/brain/language.ts';
import { type BotSetup, botSetup } from '../_shared/cards/__fixtures__/bot-context.ts';
import {
  cardButtonId,
  fullPaymentButtonId,
  lookupRowId,
  menuRowId,
  parseTap,
  partPaymentButtonId,
  remindButtonId,
} from '../_shared/cards/ids.ts';
import { LATHA, PRAVEEN_1, RAMESH } from '../_shared/db/fake-book-repository.ts';
import type { Hearing } from '../_shared/speech/hear.ts';
import type { InboundMessage } from '../_shared/whatsapp/inbound.ts';
import { type Reply, replyText } from '../_shared/whatsapp/replies.ts';
import { type Outcome, routeMessage } from './route.ts';

const NOW = new Date('2026-11-02T12:00:00+05:30');
const NO_HEARING = (): Promise<Hearing> => Promise.resolve({ kind: 'failed' });
/** Not one of the owner's shopkeepers (e.g. another owner's id, or a made-up one). */
const FOREIGN_ID = '5e000000-0000-4000-8000-0000000000ee';

function text(body: string): InboundMessage {
  return { id: `wamid.${body}`, from: '910000000001', kind: 'text', text: body };
}

function tap(buttonId: string): InboundMessage {
  return { id: `wamid.${buttonId}`, from: '910000000001', kind: 'tap', buttonId };
}

async function route(
  setup: BotSetup,
  message: InboundMessage,
): Promise<{ outcome: Outcome; llmCalls: number }> {
  let llmCalls = 0;
  const llm: BrainLlm = () => {
    llmCalls += 1;
    return Promise.resolve({ suggestion: null, path: 'failed' });
  };
  const outcome = await routeMessage(message, setup.ctx, { llm, demoNow: NOW, hear: NO_HEARING });
  return { outcome, llmCalls };
}

function kinds(replies: readonly Reply[]): string[] {
  return replies.map((reply) => reply.kind);
}

Deno.test('typed commands › same commands as before, parsed in code, no LLM call', async () => {
  const typed: ReadonlyArray<[string, string]> = [
    ['pending', 'pending'],
    ['due', 'due_alert'],
    ['closed', 'closed'],
    ['insights', 'insights'],
    ['dashboard', 'dashboard'],
    ['remind all', 'remind_all'],
    ['Ramesh 5000 due 15th', 'add_credit'],
    ['Ramesh paid 2000', 'mark_paid'],
  ];
  for (const [words, command] of typed) {
    const { outcome, llmCalls } = await route(botSetup(), text(words));
    assertEquals([outcome.command, llmCalls], [command, 0], words);
    assert(outcome.replies.length > 0, words);
  }
});

Deno.test('typed commands › add and paid lines give a card; nothing saved, nobody called', async () => {
  for (const [words, title] of [['Ramesh 5000 due 15th', '🧾'], ['Ramesh paid 2000', '💰']]) {
    const setup = botSetup();
    const before = setup.state.entries.length;
    const { outcome } = await route(setup, text(words!));
    const card = outcome.replies[0];
    assertEquals(
      card?.kind === 'buttons' ? card.buttons.map((button) => parseTap(button.id)?.kind) : [],
      ['card', 'card', 'card'],
      words,
    );
    assert(replyText([card!]).startsWith(`${title} *`), words);
    assertEquals([setup.state.entries.length, setup.reminder.repo.state.calls.length], [before, 0]);
  }
});

Deno.test('typed commands › "remind all" asks first; "pending" is text then the list', async () => {
  const setup = botSetup();
  const { outcome } = await route(setup, text('remind all'));
  assertEquals(setup.reminder.repo.state.calls.length, 0);
  assertEquals(outcome.replies.at(-1)?.kind, 'buttons');
  const pending = await route(botSetup(), text('pending'));
  assertEquals(kinds(pending.outcome.replies), ['text', 'list']);
});

Deno.test('taps › a shopkeeper id we never sent does nothing (lk, pf, pp, rm)', async () => {
  for (
    const id of [
      lookupRowId(FOREIGN_ID, 'en'),
      fullPaymentButtonId(FOREIGN_ID, 'en'),
      partPaymentButtonId(FOREIGN_ID, 'en'),
      remindButtonId(FOREIGN_ID, 'en'),
    ]
  ) {
    const setup = botSetup();
    const before = setup.state.entries.length;
    const { outcome } = await route(setup, tap(id));
    assertEquals(replyText(outcome.replies), 'This card has expired. Please send it again.', id);
    assertEquals(
      [setup.state.actions.length, setup.state.entries.length, setup.reminder.repo.state.calls],
      [0, before, []],
      id,
    );
  }
});

/** A [Confirm received] [Not received] card: unchanged since M4, its English comes from Translate. */
function isClaimCard(reply: Reply): boolean {
  return reply.kind === 'buttons' && parseTap(reply.buttons[0]?.id ?? '')?.kind === 'claim';
}

/** Every reply with a body in a Telugu flow carries an English rendering with no Telugu in it. */
function assertEnglishTwins(replies: readonly Reply[], label: string): void {
  for (const reply of replies) {
    if (reply.kind === 'audio' || reply.kind === 'template' || isClaimCard(reply)) continue;
    const english = reply.english ?? '';
    assert(english.trim() !== '', `${label}: no English for ${reply.text}`);
    assert(!TELUGU_SCRIPT.test(english), `${label}: Telugu left in ${english}`);
  }
}

Deno.test('english twin › every new Telugu reply has its English (Menu, taps, Save, Sorry)', async () => {
  const taps = [
    menuRowId('menu', 'te'),
    menuRowId('pending', 'te'),
    menuRowId('add', 'te'),
    menuRowId('paid', 'te'),
    menuRowId('insights', 'te'),
    menuRowId('dashboard', 'te'),
    lookupRowId(RAMESH.id, 'te'),
    fullPaymentButtonId(PRAVEEN_1.id, 'te'),
    partPaymentButtonId(RAMESH.id, 'te'),
  ];
  for (const id of taps) assertEnglishTwins((await route(botSetup(), tap(id))).outcome.replies, id);
  const sorry = await route(botSetup(), text('వాతావరణం ఎలా ఉంది'));
  assertEquals(sorry.outcome.command, 'unknown');
  assertEnglishTwins(sorry.outcome.replies, 'sorry');
  const setup = botSetup();
  const [card] = (await route(setup, tap(fullPaymentButtonId(LATHA.id, 'te')))).outcome.replies;
  assertEnglishTwins([card!], 'paid in full card');
  const actionId = setup.state.actions[0]?.id ?? '';
  const saved = await route(setup, tap(cardButtonId(actionId, 'save')));
  assertEnglishTwins(saved.outcome.replies, 'saved');
  assertEquals(saved.outcome.replies[0]?.kind, 'buttons');
});
