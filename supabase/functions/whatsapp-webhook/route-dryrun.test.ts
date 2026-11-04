// supabase/functions/whatsapp-webhook/route-dryrun.test.ts
// Dry-run fixes through the router (2026-11-04): natural "call Ramesh" gets a [Call] [Cancel]
// card and calls nobody until Call; Cancel calls nobody; an unknown name gets the remind
// not-found reply; the Hindi voice payment becomes a payment card for exactly ₹1,000 in Hindi.
// Fakes only.
import { assertEquals, assertStringIncludes } from '@std/assert';
import type { BrainLlm, LlmResult } from '../_shared/brain/llm.ts';
import { type BotSetup, botSetup } from '../_shared/cards/__fixtures__/bot-context.ts';
import { noCallButtonId, remindButtonId } from '../_shared/cards/ids.ts';
import { RAMESH } from '../_shared/db/fake-book-repository.ts';
import type { Language } from '../_shared/schemas/shopkeeper.ts';
import type { Hearing } from '../_shared/speech/hear.ts';
import type { InboundMessage } from '../_shared/whatsapp/inbound.ts';
import { type Reply, replyText } from '../_shared/whatsapp/replies.ts';
import { replyLanguage, routeMessage } from './route.ts';

const NOW = new Date('2026-11-02T12:00:00+05:30');
const NO_LLM: BrainLlm = () => Promise.resolve({ suggestion: null, path: 'failed' });

function llmSaying(result: LlmResult): BrainLlm {
  return () => Promise.resolve(result);
}

function text(body: string): InboundMessage {
  return { id: `wamid.${body}`, from: '910000000001', kind: 'text', text: body };
}

function tap(buttonId: string): InboundMessage {
  return { id: `wamid.${buttonId}`, from: '910000000001', kind: 'tap', buttonId };
}

const VOICE: InboundMessage = { id: 'wamid.v', from: '910000000001', kind: 'voice', mediaId: 'm1' };

async function send(
  setup: BotSetup,
  message: InboundMessage,
  options: { llm?: BrainLlm; heard?: Hearing } = {},
): Promise<readonly Reply[]> {
  const hear = (): Promise<Hearing> => Promise.resolve(options.heard ?? { kind: 'failed' });
  const deps = { llm: options.llm ?? NO_LLM, demoNow: NOW, hear };
  return (await routeMessage(message, setup.ctx, deps)).replies;
}

function callsMade(setup: BotSetup): number {
  return setup.reminder.repo.state.calls.length + setup.reminder.store.state.calls.length;
}

Deno.test('dry run › "Please call Ramesh and remind him" → a Call/Cancel card, nobody called', async () => {
  const setup = botSetup();
  const replies = await send(setup, text('Please call Ramesh and remind him'));
  assertEquals(replies, [{
    kind: 'buttons',
    text: '📞 Call Ramesh now?',
    buttons: [
      { id: remindButtonId(RAMESH.id, 'en'), title: 'Call' },
      { id: noCallButtonId('en'), title: 'Cancel' },
    ],
  }]);
  assertEquals(callsMade(setup), 0);
});

Deno.test('dry run › only the Call tap queues the call (the existing Remind path)', async () => {
  const setup = botSetup();
  await send(setup, text('call Ramesh now'));
  const replies = await send(setup, tap(remindButtonId(RAMESH.id, 'en')));
  assertStringIncludes(replyText(replies), '📞 Calling Ramesh now');
  assertEquals(setup.reminder.repo.state.calls.length, 1);
});

Deno.test('dry run › Cancel calls nobody, in the card language', async () => {
  const setup = botSetup();
  const replies = await send(setup, tap(noCallButtonId('te')));
  assertEquals(replyText(replies), 'సరే, కాల్ చేయలేదు.');
  assertEquals(callsMade(setup), 0);
});

Deno.test('dry run › the LLM maps Hindi and Telugu requests to the same confirm card', async () => {
  const cases: ReadonlyArray<readonly [string, Language, string]> = [
    ['Ramesh ko yaad dilao', 'hi', '📞 Ramesh को अभी कॉल करें?'],
    ['Ramesh ki call cheyyi', 'te', '📞 Rameshకి ఇప్పుడు కాల్ చేయాలా?'],
  ];
  for (const [said, language, card] of cases) {
    const setup = botSetup();
    const llm = llmSaying({ suggestion: { intent: 'call', name: 'Ramesh' }, path: 'sarvam' });
    const heard: Hearing = { kind: 'heard', text: said, language };
    const replies = await send(setup, VOICE, { llm, heard });
    assertStringIncludes(replyText(replies), card);
    assertEquals(callsMade(setup), 0, said);
  }
});

Deno.test('dry run › an unknown name gets the same not-found reply as remind', async () => {
  const setup = botSetup();
  const llm = llmSaying({ suggestion: { intent: 'call', name: 'Mohan' }, path: 'sarvam' });
  const replies = await send(setup, text('call Mohan now'), { llm });
  assertEquals(
    replyText(replies),
    'No shopkeeper called Mohan. Send *pending* to see who owes you.',
  );
});

Deno.test('dry run › Hindi voice "Ramesh ne 1,000 rupaye diye" → payment card for ₹1,000, in Hindi', async () => {
  for (const said of ['Ramesh ne 1,000 rupaye diye.', 'रमेश ने 1,000 रुपये दिए']) {
    const setup = botSetup();
    // Saaras' translit mode may report English for Latin-letter Hindi.
    const heard: Hearing = { kind: 'heard', text: said, language: 'en' };
    const replies = await send(setup, VOICE, { heard });
    const card = replies[0];
    assertEquals(card?.kind, 'buttons', said);
    assertStringIncludes(replyText(replies), '*भुगतान मिला*');
    assertStringIncludes(replyText(replies), '₹1,000');
    assertEquals(replyText(replies).includes('₹10,000'), false);
  }
});

Deno.test('dry run › reply language: Saaras wins unless it says English for Hindi/Telugu words', () => {
  assertEquals(replyLanguage(undefined, 'hi'), 'hi');
  assertEquals(replyLanguage('en', 'hi'), 'hi');
  assertEquals(replyLanguage('te', 'en'), 'te');
  assertEquals(replyLanguage('en', 'en'), 'en');
});
