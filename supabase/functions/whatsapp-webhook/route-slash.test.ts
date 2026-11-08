// supabase/functions/whatsapp-webhook/route-slash.test.ts
// 2026-11-08 through the router. (1) Regression: "call Munshi" (or "Munshi", "munshi call",
// मुनशी, మున్షీ, a voice note) mid-conversation sends the Munshi link exactly like the Menu row,
// same limits, and is never read as a shopkeeper's name or sent to the LLM. (2) "/" commands run
// in code (the LLM is never asked about the command itself) and give the same replies as typing
// the command; /paid, /add, /asha and /statement ask a short question (and offer the pending
// pick list) when typed alone; an unknown "/xyz" lists the commands. Fakes only.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { BrainLlm, LlmResult } from '../_shared/brain/llm.ts';
import {
  type BotSetup,
  botSetup,
  type BotSetupOptions,
  FAKE_NOW,
  fakeMunshiLink,
} from '../_shared/cards/__fixtures__/bot-context.ts';
import { CLAIM_ID, LATHA, RAMESH } from '../_shared/db/fake-book-repository.ts';
import { fakeOwnerCall } from '../_shared/db/fake-owner-call-repository.ts';
import { claimButtonId, menuRowId, parseTap } from '../_shared/cards/ids.ts';
import { reminderSetup } from '../_shared/reminders/__fixtures__/reminder-deps.ts';
import type { Hearing } from '../_shared/speech/hear.ts';
import type { InboundMessage } from '../_shared/whatsapp/inbound.ts';
import { type Reply, replyText } from '../_shared/whatsapp/replies.ts';
import { SLASH_COMMANDS } from '../_shared/whatsapp/slash-commands.ts';
import { ownerCallPhrasesFor } from './owner-call.ts';
import { type Outcome, routeMessage } from './route.ts';

const FAILED: LlmResult = { suggestion: null, path: 'failed' };

function text(body: string): InboundMessage {
  return { id: `wamid.${body}`, from: '910000000001', kind: 'text', text: body };
}

function tap(buttonId: string): InboundMessage {
  return { id: `wamid.${buttonId}`, from: '910000000001', kind: 'tap', buttonId };
}

interface Routed {
  readonly outcome: Outcome;
  /** Texts the LLM was asked about. */
  readonly asked: readonly string[];
}

async function routeWith(
  setup: BotSetup,
  message: InboundMessage,
  options: { llm?: LlmResult; hear?: Hearing } = {},
): Promise<Routed> {
  const asked: string[] = [];
  const llm: BrainLlm = (said) => {
    asked.push(said);
    return Promise.resolve(options.llm ?? FAILED);
  };
  const hear = (): Promise<Hearing> => Promise.resolve(options.hear ?? { kind: 'failed' });
  const outcome = await routeMessage(message, setup.ctx, { llm, demoNow: FAKE_NOW, hear });
  return { outcome, asked };
}

async function say(body: string, options: BotSetupOptions = {}): Promise<Routed> {
  return await routeWith(botSetup(options), text(body));
}

async function replies(body: string): Promise<readonly Reply[]> {
  return (await say(body)).outcome.replies;
}

function readyText(setup: BotSetup, language: 'en' | 'hi' | 'te' = 'en'): string {
  const [call] = setup.ownerCalls.ownerCalls;
  return ownerCallPhrasesFor(language).ready(fakeMunshiLink(call?.id ?? ''));
}

const MUNSHI_PHRASES: ReadonlyArray<readonly [string, 'en' | 'hi' | 'te']> = [
  ['call Munshi', 'en'],
  ['Call munshi', 'en'],
  ['Munshi', 'en'],
  ['munshi call', 'en'],
  ['call munshi now', 'en'],
  ['/munshi', 'en'],
  ['/MUNSHI please', 'en'],
  ['मुनशी', 'hi'],
  ['मुंशी', 'hi'],
  ['మున్షీ', 'te'],
  ['మున్షీకి కాల్', 'te'],
];

Deno.test('munshi bug › every Munshi phrase sends the link, never "not a customer", no LLM', async () => {
  for (const [phrase, language] of MUNSHI_PHRASES) {
    const setup = botSetup();
    const { outcome, asked } = await routeWith(setup, text(phrase));
    assertEquals(asked, [], phrase);
    assertEquals(setup.ownerCalls.ownerCalls.length, 1, phrase);
    assertEquals(setup.ownerCalls.ownerCalls[0]?.status, 'issued', phrase);
    assertEquals(outcome.path, 'command', phrase);
    assertEquals(outcome.replies.length, 1, phrase);
    const [reply] = outcome.replies;
    assertEquals(reply?.kind === 'text' ? reply.text : '', readyText(setup, language), phrase);
    if (language !== 'en') {
      assertStringIncludes(reply?.kind === 'text' ? reply.english ?? '' : '', 'Munshi is ready');
    }
    assert(!replyText(outcome.replies).includes('not'), phrase);
  }
});

Deno.test('munshi bug › typed "call Munshi" gives exactly what the Menu row gives', async () => {
  const typed = botSetup();
  const fromText = await routeWith(typed, text('call Munshi'));
  const tapped = botSetup();
  const fromTap = await routeWith(tapped, tap(menuRowId('munshi', 'en')));
  assertEquals(replyText(fromText.outcome.replies), readyText(typed));
  assertEquals(replyText(fromTap.outcome.replies), readyText(tapped));
  assertEquals(fromText.outcome.command, 'owner_call');
  assertEquals(typed.logs.map((log) => log.event), tapped.logs.map((log) => log.event));
});

Deno.test('munshi bug › the same limits as the Menu row: 3 links per 10 minutes, not set up', async () => {
  const recent = [1, 4, 9].map((minutes) =>
    fakeOwnerCall({
      id: crypto.randomUUID(),
      status: 'expired',
      issuedAt: new Date(FAKE_NOW.getTime() - minutes * 60_000).toISOString(),
    })
  );
  const limited = botSetup({ ownerCalls: { ownerCalls: recent } });
  const { outcome } = await routeWith(limited, text('call Munshi'));
  assertEquals(replyText(outcome.replies), ownerCallPhrasesFor('en').tooMany);
  assertEquals(limited.ownerCalls.ownerCalls.length, 3);
  const notSetUp = await say('munshi', { munshiLink: null });
  assertEquals(replyText(notSetUp.outcome.replies), ownerCallPhrasesFor('en').notSetUp);
});

Deno.test('munshi bug › a voice note saying "call Munshi" sends the link too', async () => {
  const setup = botSetup();
  const voice: InboundMessage = {
    id: 'wamid.v',
    from: '910000000001',
    kind: 'voice',
    mediaId: 'M1',
  };
  const { outcome, asked } = await routeWith(setup, voice, {
    hear: { kind: 'heard', text: 'Call Munshi', language: 'en' },
  });
  assertEquals(asked, []);
  assertEquals(outcome.command, 'owner_call');
  assertStringIncludes(replyText(outcome.replies), readyText(setup));
});

Deno.test('munshi bug › a sentence that only mentions Munshi still takes the usual path', async () => {
  const { outcome } = await say('Ramesh paid 2000');
  assertEquals(outcome.command, 'mark_paid');
  const sentence = await say('who is munshi and why does he call me');
  assertEquals(sentence.asked.length, 1);
});

Deno.test('slash › bare commands give the same replies as typing them, and never ask the LLM', async () => {
  const same: ReadonlyArray<readonly [string, string, string]> = [
    ['/menu', 'menu', 'slash_menu'],
    ['/Pending', 'pending', 'slash_pending'],
    ['/due', 'due', 'slash_due'],
    ['/overdue', 'overdue', 'slash_overdue'],
    ['/insights', 'insights', 'slash_insights'],
    ['  /PENDING  extra words ', 'pending', 'slash_pending'],
  ];
  for (const [slash, typed, command] of same) {
    const fromSlash = await say(slash);
    assertEquals(fromSlash.asked, [], slash);
    assertEquals(fromSlash.outcome.command, command, slash);
    assertEquals(fromSlash.outcome.path, 'command', slash);
    assertEquals(replyText(fromSlash.outcome.replies), replyText(await replies(typed)), slash);
  }
});

function listRows(reply: Reply | undefined): readonly string[] {
  return reply?.kind === 'list' ? reply.rows.map((row) => parseTap(row.id)?.kind ?? '') : [];
}

Deno.test('slash › /paid, /asha and /statement alone ask who, then offer the pending pick list', async () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['/paid', '💰 *Who paid, and how much?*\n\nType it, e.g. */paid Ramesh 2000*'],
    ['/asha', '📞 *Who should Asha call?*\n\nType the name, e.g. */asha Ramesh*'],
    ['/reminder', '📞 *Who should Asha call?*\n\nType the name, e.g. */asha Ramesh*'],
    ['/statement', '👤 *Whose statement?*\n\nType the name, e.g. */statement Ramesh*'],
  ];
  for (const [slash, prompt] of cases) {
    const { outcome, asked } = await say(slash);
    assertEquals(asked, [], slash);
    assertEquals(outcome.replies.length, 2, slash);
    assertEquals(outcome.replies[0]?.kind === 'text' ? outcome.replies[0].text : '', prompt);
    assert(listRows(outcome.replies[1]).length > 0, slash);
    assert(listRows(outcome.replies[1]).every((kind) => kind === 'lookup'), slash);
  }
});

Deno.test('slash › /add alone asks who, how much and the due date; nobody owing → no list', async () => {
  const add = await say('/add');
  assertEquals(
    replyText(add.outcome.replies),
    '🧾 *Who, how much, and due date?*\n\nType it in one line, e.g. */add Ramesh 5000 due 15th*',
  );
  const empty = await say('/paid', { state: { entries: [] } });
  assertEquals(empty.outcome.replies.length, 1);
});

Deno.test('slash › /paid and /add with words read them like the normal message', async () => {
  const pairs: ReadonlyArray<readonly [string, string, string]> = [
    ['/paid Ramesh 2000', 'Ramesh paid 2000', 'mark_paid'],
    ['/PAID ramesh paid 2000', 'Ramesh paid 2000', 'mark_paid'],
    ['/add Ramesh 5000 due 15th', 'Ramesh 5000 due 15th', 'add_credit'],
    ['/add Ramesh paid 500', 'Ramesh 500', 'add_credit'],
    ['/paid Ramesh', 'Ramesh', 'lookup'],
  ];
  for (const [slash, typed, kind] of pairs) {
    const fromSlash = await say(slash);
    assertEquals(fromSlash.outcome.command, kind, slash);
    assertEquals(replyText(fromSlash.outcome.replies), replyText(await replies(typed)), slash);
  }
});

Deno.test('slash › /paid words the code cannot read go to the LLM; nothing understood → the prompt', async () => {
  const { outcome, asked } = await say('/paid he gave something yesterday');
  assertEquals(asked, ['he gave something yesterday']);
  assertEquals(outcome.path, 'failed');
  assertStringIncludes(replyText(outcome.replies), 'Who paid, and how much?');
  const llm: LlmResult = {
    suggestion: { intent: 'add_credit', name: 'Ramesh', amount: 700 },
    path: 'sarvam',
  };
  const setup = botSetup();
  const read = await routeWith(setup, text('/paid ramesh ne saat sau'), { llm });
  assertEquals(read.outcome.command, 'mark_paid');
  assertEquals(read.outcome.path, 'sarvam');
  const add = await routeWith(botSetup(), text('/add nothing clear'));
  assertStringIncludes(replyText(add.outcome.replies), 'Who, how much, and due date?');
});

Deno.test('slash › /asha Ramesh and /reminder Ramesh = "call Ramesh": a confirm card, nobody called', async () => {
  const typed = await say('call Ramesh');
  for (const slash of ['/asha Ramesh', '/reminder ramesh', '/Asha  Ramesh ']) {
    const reminder = reminderSetup();
    const { outcome } = await say(slash, { reminder });
    assertEquals(outcome.command, 'slash_asha', slash);
    assertEquals(replyText(outcome.replies), replyText(typed.outcome.replies), slash);
    assertEquals(reminder.repo.state.calls.length, 0, slash);
  }
  const unknown = await say('/asha Nobody');
  assertStringIncludes(replyText(unknown.outcome.replies), 'Nobody');
});

Deno.test('slash › /statement Ramesh = typing "Ramesh"', async () => {
  const { outcome } = await say('/statement Ramesh');
  assertEquals(outcome.command, 'slash_statement');
  assertEquals(replyText(outcome.replies), replyText(await replies('Ramesh')));
});

Deno.test('slash › /claims: the claims waiting, each with Confirm received / Not received', async () => {
  const { outcome, asked } = await say('/claims');
  assertEquals(asked, []);
  assertEquals(outcome.command, 'slash_claims');
  const [title, card] = outcome.replies;
  assertStringIncludes(title?.kind === 'text' ? title.text : '', 'Payment claims waiting: 1');
  assert(card?.kind === 'buttons');
  assertEquals(card.buttons.map((button) => button.id), [
    claimButtonId(CLAIM_ID, true, 'en'),
    claimButtonId(CLAIM_ID, false, 'en'),
  ]);
  const none = await say('/claims', { state: { entries: [] } });
  assertEquals(replyText(none.outcome.replies), '✅ No payment claims are waiting.');
});

Deno.test('slash › /promises: this week and broken in the last 14 days', async () => {
  const reminder = reminderSetup({
    store: {
      promises: [
        {
          id: crypto.randomUUID(),
          shopkeeperId: RAMESH.id,
          amount: 2000,
          promiseDate: '2026-11-04',
          status: 'open',
          createdAt: '2026-11-01T10:00:00Z',
        },
        {
          id: crypto.randomUUID(),
          shopkeeperId: LATHA.id,
          amount: 1000,
          promiseDate: '2026-10-28',
          status: 'broken',
          createdAt: '2026-10-25T10:00:00Z',
        },
      ],
    },
  });
  const { outcome, asked } = await say('/promises', { reminder });
  assertEquals(asked, []);
  assertEquals(outcome.command, 'slash_promises');
  const shown = replyText(outcome.replies);
  assertStringIncludes(shown, '*This week (1)*\n• Ramesh (Ramesh Kirana) · ₹2,000 by Wed 4 Nov');
  assertStringIncludes(shown, '*Broken, last 14 days (1)*\n• Latha (Latha General Stores)');
  const none = await say('/promises');
  assertStringIncludes(replyText(none.outcome.replies), 'No promises fall due this week');
});

Deno.test('slash › an unknown "/xyz" lists every command, in code', async () => {
  for (const slash of ['/xyz', '/', '/help me']) {
    const { outcome, asked } = await say(slash);
    assertEquals(asked, [], slash);
    assertEquals(outcome.command, 'slash_unknown', slash);
    const shown = replyText(outcome.replies);
    assert(shown.startsWith('⌨️ *Commands you can type*'), slash);
    for (const command of SLASH_COMMANDS) assertStringIncludes(shown, `/${command.name} · `);
  }
});

Deno.test('slash › Telugu and Hindi words after a command reply in that language, with English', async () => {
  const { outcome } = await say('/statement రమేష్');
  const [reply] = outcome.replies;
  assert(reply?.kind === 'text');
  assert(/[ఀ-౿]/.test(reply.text));
  assert((reply.english ?? '').length > 0);
});
