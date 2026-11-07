// supabase/functions/whatsapp-webhook/route-menu.test.ts
// M7 A3 through the router: greetings, "menu", "help" and the LLM's help intent open the Menu;
// "Sorry" comes with the Menu; each Menu row does exactly what typing the command does (nobody is
// called before Yes); a lookup ends with [Remind] [Paid in full] [Part payment], and each of
// those taps works (Remind = the due alert's Remind; Paid in full = a payment card, nothing
// saved; Part payment = a hint). Fakes only.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { BrainLlm, LlmResult } from '../_shared/brain/llm.ts';
import { type BotSetup, botSetup } from '../_shared/cards/__fixtures__/bot-context.ts';
import {
  fullPaymentButtonId,
  MENU_TARGETS,
  menuRowId,
  parseTap,
  partPaymentButtonId,
  remindButtonId,
} from '../_shared/cards/ids.ts';
import { RAMESH } from '../_shared/db/fake-book-repository.ts';
import type { Hearing } from '../_shared/speech/hear.ts';
import type { InboundMessage } from '../_shared/whatsapp/inbound.ts';
import { type Reply, replyText } from '../_shared/whatsapp/replies.ts';
import { type Outcome, routeMessage } from './route.ts';

const NOW = new Date('2026-11-02T12:00:00+05:30');
const NO_HEARING = (): Promise<Hearing> => Promise.resolve({ kind: 'failed' });
const FAILED: LlmResult = { suggestion: null, path: 'failed' };
const HELP_WORDS = [
  'menu',
  'hi',
  'hello',
  'hey',
  'help',
  'help me',
  'start',
  'namaste',
  'namaskar',
  'namaskaram',
  'నమస్కారం',
  'హలో',
  'नमस्ते',
  'हेलो',
  'हेल्प',
];

function text(body: string): InboundMessage {
  return { id: `wamid.${body}`, from: '910000000001', kind: 'text', text: body };
}

function tap(buttonId: string): InboundMessage {
  return { id: `wamid.${buttonId}`, from: '910000000001', kind: 'tap', buttonId };
}

function route(setup: BotSetup, message: InboundMessage, llm?: LlmResult): Promise<Outcome> {
  const brain: BrainLlm = () => Promise.resolve(llm ?? FAILED);
  return routeMessage(message, setup.ctx, { llm: brain, demoNow: NOW, hear: NO_HEARING });
}

async function send(setup: BotSetup, message: InboundMessage): Promise<readonly Reply[]> {
  return (await route(setup, message)).replies;
}

function menuItems(reply: Reply | undefined): string[] {
  if (reply?.kind !== 'list') return [];
  return reply.rows.map((row) => {
    const parsed = parseTap(row.id);
    return parsed?.kind === 'menu' ? parsed.item : '';
  });
}

const EIGHT_ROWS = MENU_TARGETS.filter((item) => item !== 'menu');

Deno.test('menu route › every help word opens the Menu, in the language of the word', async () => {
  for (const word of HELP_WORDS) {
    const outcome = await route(botSetup(), text(word));
    assertEquals(outcome.command, 'help', word);
    assertEquals(outcome.replies.length, 1, word);
    assertEquals(menuItems(outcome.replies[0]), EIGHT_ROWS, word);
  }
  const telugu = await send(botSetup(), text('నమస్కారం'));
  assertStringIncludes(replyText(telugu), 'Srinivas గారు');
});

Deno.test("menu route › the LLM's help intent opens the Menu too", async () => {
  const outcome = await route(botSetup(), text('what can you do for me'), {
    suggestion: { intent: 'help' },
    path: 'sarvam',
  });
  assertEquals(menuItems(outcome.replies[0]), EIGHT_ROWS);
});

Deno.test('menu route › "Sorry, I didn\'t get that" comes with the Menu', async () => {
  const outcome = await route(botSetup(), text('what is the weather like'));
  assertEquals(outcome.command, 'unknown');
  assertEquals(outcome.replies.length, 1);
  assert(replyText(outcome.replies).startsWith("Sorry, I didn't get that.\n\n👋"));
  assertEquals(menuItems(outcome.replies[0]), EIGHT_ROWS);
});

Deno.test('menu route › each row gives the same replies as typing the command', async () => {
  const typed: ReadonlyArray<[string, string]> = [
    ['pending', 'pending'],
    ['due', 'due'],
    ['closed', 'closed'],
    ['insights', 'insights'],
    ['dashboard', 'dashboard'],
    ['remind_all', 'remind all'],
  ];
  for (const [item, words] of typed) {
    const fromTap = await send(botSetup(), tap(`mn:${item}:en`));
    const fromText = await send(botSetup(), text(words));
    assertEquals(replyText(fromTap), replyText(fromText), item);
  }
});

Deno.test('menu route › Remind all due asks first: nobody is called by the tap', async () => {
  const setup = botSetup();
  const outcome = await route(setup, tap(menuRowId('remind_all', 'en')));
  assertEquals(outcome.command, 'menu_remind_all');
  assertEquals(outcome.path, 'button');
  assertStringIncludes(replyText(outcome.replies), 'Yes');
  assertEquals(setup.reminder.store.state.calls.length, 0);
  assertEquals(setup.reminder.repo.state.calls.length, 0);
  assertEquals(setup.reminder.started, []);
});

Deno.test('menu route › Add credit and Mark paid rows give hints; [Menu] gives the Menu', async () => {
  const add = await send(botSetup(), tap(menuRowId('add', 'en')));
  assertStringIncludes(replyText(add), '*Ramesh 5000 due 15th*');
  const paid = await send(botSetup(), tap(menuRowId('paid', 'hi')));
  assertStringIncludes(replyText(paid), 'भुगतान दर्ज करें');
  const menu = await send(botSetup(), tap(menuRowId('menu', 'te')));
  assertEquals(menuItems(menu[0]), EIGHT_ROWS);
  assertStringIncludes(replyText(menu), 'మెనూ');
});

Deno.test('menu route › a row runs in the tap language, not the owner default', async () => {
  const replies = await send(botSetup({ language: 'en' }), tap(menuRowId('pending', 'hi')));
  assertStringIncludes(replyText(replies), '📒 *बाकी:*');
});

Deno.test('lookup route › typing a name ends with "What next" and three buttons', async () => {
  const replies = await send(botSetup(), text('Ramesh'));
  const next = replies.at(-1);
  assertEquals(next?.kind === 'buttons' ? next.buttons.map((button) => button.id) : [], [
    remindButtonId(RAMESH.id, 'en'),
    fullPaymentButtonId(RAMESH.id, 'en'),
    partPaymentButtonId(RAMESH.id, 'en'),
  ]);
});

Deno.test('lookup route › [Remind] calls at once, like the due alert Remind', async () => {
  const setup = botSetup();
  const outcome = await route(setup, tap(remindButtonId(RAMESH.id, 'en')));
  assertEquals(outcome.command, 'remind');
  assertEquals(setup.reminder.repo.state.calls.length, 1);
});

Deno.test('lookup route › [Paid in full] → payment card for the balance, nothing saved', async () => {
  const setup = botSetup();
  const before = setup.state.entries.length;
  const outcome = await route(setup, tap(fullPaymentButtonId(RAMESH.id, 'en')));
  assertEquals(outcome.command, 'paid_in_full');
  assertStringIncludes(replyText(outcome.replies), '₹8,500');
  assertEquals(outcome.replies[0]?.kind, 'buttons');
  assertEquals(setup.state.entries.length, before);
});

Deno.test('lookup route › [Part payment] → hint, nothing stored', async () => {
  const setup = botSetup();
  const outcome = await route(setup, tap(partPaymentButtonId(RAMESH.id, 'te')));
  assertEquals(outcome.command, 'part_payment');
  assertStringIncludes(replyText(outcome.replies), '*Ramesh paid 2000*');
  assertEquals(setup.state.actions.length, 0);
});

Deno.test('pending route › the "Open a shopkeeper" row opens that lookup', async () => {
  const setup = botSetup();
  const [, list] = await send(setup, text('pending'));
  const first = list?.kind === 'list' ? list.rows[0]?.id ?? '' : '';
  const replies = await send(setup, tap(first));
  assertStringIncludes(replyText(replies), '👤 *Ramesh*');
});

Deno.test('pending route › nobody owes → just the line, no list', async () => {
  const replies = await send(botSetup({ state: { entries: [] } }), text('pending'));
  assertEquals(replyText(replies), 'Nobody owes you anything right now.');
});

Deno.test('tap route › an id we never sent → expired line', async () => {
  const outcome = await route(botSetup(), tap('mn:nope:en'));
  assertEquals([outcome.command, replyText(outcome.replies)], [
    'unknown_button',
    'This card has expired. Please send it again.',
  ]);
});
