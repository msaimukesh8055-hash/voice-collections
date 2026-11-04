// supabase/functions/whatsapp-webhook/route-links.test.ts
// Reply links (cloud build) through the router: a lookup ("Ramesh", or a lookup row) ends with
// "📒 View in books: <customer page>"; "Calling X…" and "already being called" (Remind tap,
// "remind X", the Call button) end with "📞 Answer here: <phone page>". Each in EN/TE/HI, the
// English twin keeps the same link, and with no dashboard set up the line is left out. Fakes only.
import { assertEquals, assertStringIncludes } from '@std/assert';
import type { BrainLlm } from '../_shared/brain/llm.ts';
import {
  type BotSetup,
  botSetup,
  FAKE_PHONE_LINK,
  fakeShopkeeperLink,
  NO_LINKS_WEB,
} from '../_shared/cards/__fixtures__/bot-context.ts';
import { lookupRowId, remindButtonId } from '../_shared/cards/ids.ts';
import { LATHA, RAMESH } from '../_shared/db/fake-book-repository.ts';
import { reminderSetup } from '../_shared/reminders/__fixtures__/reminder-deps.ts';
import type { Hearing } from '../_shared/speech/hear.ts';
import type { InboundMessage } from '../_shared/whatsapp/inbound.ts';
import { type Reply, replyText } from '../_shared/whatsapp/replies.ts';
import { routeMessage } from './route.ts';

const NOW = new Date('2026-11-02T12:00:00+05:30');
const NO_LLM: BrainLlm = () => Promise.resolve({ suggestion: null, path: 'failed' });
const NO_HEARING = (): Promise<Hearing> => Promise.resolve({ kind: 'failed' });
const BOOKS_EN = `📒 View in books: ${fakeShopkeeperLink(RAMESH.id)}`;
const ANSWER_EN = `📞 Answer here: ${FAKE_PHONE_LINK}`;

function text(body: string): InboundMessage {
  return { id: `wamid.${body}`, from: '910000000001', kind: 'text', text: body };
}

function tap(buttonId: string): InboundMessage {
  return { id: `wamid.${buttonId}`, from: '910000000001', kind: 'tap', buttonId };
}

async function send(setup: BotSetup, message: InboundMessage): Promise<readonly Reply[]> {
  const deps = { llm: NO_LLM, demoNow: NOW, hear: NO_HEARING };
  return (await routeMessage(message, setup.ctx, deps)).replies;
}

function englishOf(reply: Reply | undefined): string | undefined {
  return reply?.kind === 'text' ? reply.english : undefined;
}

Deno.test('links › typing a name ("Ramesh") ends the lookup with View in books', async () => {
  const replies = await send(botSetup(), text('Ramesh'));
  assertEquals(replyText(replies.slice(0, 1)).split('\n').at(-1), BOOKS_EN);
});

Deno.test('links › a lookup row tap ("Which Praveen?") gets the same line', async () => {
  const replies = await send(botSetup(), tap(lookupRowId(RAMESH.id, 'en')));
  assertStringIncludes(replyText(replies), BOOKS_EN);
});

Deno.test('links › Telugu and Hindi lookups: own label, English twin with the same link', async () => {
  const [telugu] = await send(botSetup(), tap(lookupRowId(RAMESH.id, 'te')));
  assertStringIncludes(replyText([telugu!]), `📒 ఖాతాలో చూడండి: ${fakeShopkeeperLink(RAMESH.id)}`);
  assertEquals(englishOf(telugu)?.split('\n').at(-1), BOOKS_EN);
  const hindi = await send(botSetup(), tap(lookupRowId(RAMESH.id, 'hi')));
  assertStringIncludes(replyText(hindi), `📒 खाते में देखें: ${fakeShopkeeperLink(RAMESH.id)}`);
});

Deno.test('links › Remind tap: "Calling Ramesh…" then Answer here (phone page, no token)', async () => {
  const replies = await send(botSetup(), tap(remindButtonId(RAMESH.id, 'en')));
  const lines = replyText(replies).split('\n');
  assertStringIncludes(lines[0] ?? '', '📞 Calling Ramesh now');
  assertEquals(lines.slice(1), ['', ANSWER_EN]);
});

Deno.test('links › "remind Latha" and the "already being called" reply both carry the line', async () => {
  const setup = botSetup();
  assertStringIncludes(replyText(await send(setup, text('remind Latha'))), ANSWER_EN);
  const again = replyText(await send(setup, tap(remindButtonId(LATHA.id, 'en'))));
  assertEquals(again, `Latha is already being called.\n\n${ANSWER_EN}`);
});

Deno.test('links › the Call button after "call Ramesh now" carries the line', async () => {
  const setup = botSetup();
  await send(setup, text('call Ramesh now'));
  const replies = await send(setup, tap(remindButtonId(RAMESH.id, 'en')));
  assertStringIncludes(replyText(replies), ANSWER_EN);
});

Deno.test('links › Telugu and Hindi "Calling…": own label, English twin with the same link', async () => {
  const [telugu] = await send(botSetup(), tap(remindButtonId(RAMESH.id, 'te')));
  assertStringIncludes(replyText([telugu!]), `📞 ఇక్కడ ఎత్తండి: ${FAKE_PHONE_LINK}`);
  assertEquals(englishOf(telugu)?.split('\n').at(-1), ANSWER_EN);
  const hindi = await send(botSetup(), tap(remindButtonId(RAMESH.id, 'hi')));
  assertStringIncludes(replyText(hindi), `📞 यहाँ उठाएँ: ${FAKE_PHONE_LINK}`);
});

Deno.test('links › no dashboard set up: lookup and Calling replies go out without the line', async () => {
  const lookup = replyText(await send(botSetup({ web: NO_LINKS_WEB }), text('Ramesh')));
  const calling = replyText(
    await send(botSetup({ web: NO_LINKS_WEB }), tap(remindButtonId(RAMESH.id, 'en'))),
  );
  assertEquals([lookup.includes('📒'), calling.includes('Answer here')], [false, false]);
  assertStringIncludes(calling, 'Calling Ramesh now');
});

Deno.test('links › a blocked call (asked not to be called) gets no Answer here line', async () => {
  const reminder = reminderSetup({ now: NOW });
  reminder.repo.state.shopkeepers = reminder.repo.state.shopkeepers.map((each) =>
    each.id === LATHA.id ? { ...each, doNotCall: true } : each
  );
  const replies = replyText(
    await send(botSetup({ reminder }), tap(remindButtonId(LATHA.id, 'en'))),
  );
  assertEquals(replies, 'Latha asked not to be called. No call made.');
});
