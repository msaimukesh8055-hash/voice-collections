// supabase/functions/whatsapp-webhook/process.test.ts
// One message end to end over fakes: fake book, fake WhatsApp client (records replies, no
// network), fake LLM. FAKE numbers only.
import { createFakeOwnerCallRepository } from '../_shared/db/fake-owner-call-repository.ts';
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { LlmResult } from '../_shared/brain/llm.ts';
import { cardButtonId, claimButtonId, lookupRowId, parseTap } from '../_shared/cards/ids.ts';
import {
  CLAIM_ID,
  createFakeBookRepository,
  type FakeBookState,
  RAMESH,
} from '../_shared/db/fake-book-repository.ts';
import type { BookRepository } from '../_shared/db/book-repository.ts';
import { RepositoryError } from '../_shared/db/postgrest.ts';
import type { LogFields, Logger } from '../_shared/log.ts';
import {
  FAKE_OWNER_NUMBER,
  FAKE_STRANGER_NUMBER,
  metaPayload,
  type PayloadOptions,
  PHONE_NUMBER_ID,
} from '../_shared/whatsapp/__fixtures__/meta-payloads.ts';
import { WebhookPayloadSchema } from '../_shared/whatsapp/inbound.ts';
import { NOT_REGISTERED } from '../_shared/whatsapp/phrases.ts';
import { type Reply, replyText } from '../_shared/whatsapp/replies.ts';
import { reminderSetup } from '../_shared/reminders/__fixtures__/reminder-deps.ts';
import { voiceNote } from '../_shared/audio/__fixtures__/ogg-files.ts';
import { FAKE_WEB, fakeShopkeeperLink } from '../_shared/cards/__fixtures__/bot-context.ts';
import { spokenText } from '../_shared/whatsapp/spoken.ts';
import type { SpokenInput, SpokenSummarizer } from '../_shared/whatsapp/spoken-summary.ts';
import { type ProcessDeps, processPayload } from './process.ts';

const NOW = new Date('2026-11-02T12:00:00+05:30');
/** The flat M6 words, as the summariser gives when the LLM fails (no network in tests). */
const FLAT_SUMMARY: SpokenSummarizer = (input) =>
  Promise.resolve(spokenText(input.replies, input.language));
const NO_VOICE: ProcessDeps['voice'] = {
  summarize: FLAT_SUMMARY,
  speak: () => Promise.resolve(null),
  upload: () => Promise.resolve(null),
};
const NO_LISTEN: ProcessDeps['listen'] = {
  download: () => Promise.resolve({ kind: 'failed' }),
  transcribe: () => Promise.resolve({ kind: 'failed' }),
};

interface Setup {
  readonly deps: ProcessDeps;
  readonly state: FakeBookState;
  readonly sent: Array<{ to: string; reply: Reply }>;
  readonly logs: Array<{ event: string; fields: LogFields }>;
  readonly llmCalls: string[];
  readonly wakes: number[];
}

function setup(
  options: {
    llm?: LlmResult;
    book?: Partial<BookRepository>;
    state?: Partial<FakeBookState>;
    listen?: ProcessDeps['listen'];
    voice?: ProcessDeps['voice'];
  } = {},
): Setup {
  const fake = createFakeBookRepository(options.state);
  const sent: Array<{ to: string; reply: Reply }> = [];
  const logs: Array<{ event: string; fields: LogFields }> = [];
  const llmCalls: string[] = [];
  const wakes: number[] = [];
  const log: Logger = (_level, event, fields = {}) => logs.push({ event, fields });
  const deps: ProcessDeps = {
    book: { ...fake.book, ...options.book },
    client: {
      send: (to, reply) => {
        sent.push({ to, reply });
        return Promise.resolve(`wamid.OUT${sent.length}`);
      },
    },
    llm: (message) => {
      llmCalls.push(message);
      return Promise.resolve(options.llm ?? { suggestion: null, path: 'failed' });
    },
    sender: { ownerNumber: FAKE_OWNER_NUMBER, hashKey: 'hash-key' },
    phoneNumberId: PHONE_NUMBER_ID,
    clock: () => NOW,
    getDemoSettings: () =>
      Promise.resolve({
        demoClock: null,
        callingHoursEnabled: false,
        callLimitsEnabled: false,
        liveShopkeeperId: null,
      }),
    newPhone: () => '+91 00000 91234',
    log,
    reminder: reminderSetup({ now: NOW }).deps,
    listen: options.listen ?? NO_LISTEN,
    web: FAKE_WEB,
    munshi: { ownerCalls: createFakeOwnerCallRepository().ownerCalls, link: null },
    voice: options.voice ?? NO_VOICE,
    wakeWorker: () => {
      wakes.push(1);
    },
  };
  return { deps, state: fake.state, sent, logs, llmCalls, wakes };
}

async function receive(s: Setup, options: PayloadOptions): Promise<void> {
  await processPayload(WebhookPayloadSchema.parse(metaPayload(options)), s.deps);
}

function lastText(s: Setup): string {
  return replyText(s.sent.map((item) => item.reply));
}

Deno.test('process › the owner\'s "hi" gets the help menu; the path is logged as command', async () => {
  const s = setup();
  await receive(s, { text: 'hi' });
  assertStringIncludes(lastText(s), 'I keep your credit book');
  assertEquals(s.sent[0]?.to, FAKE_OWNER_NUMBER);
  assertEquals(s.state.inbound.map((row) => [row.path, row.command]), [['command', 'help']]);
  assertEquals(s.state.outbound.length, 1);
});

Deno.test('process › a stranger gets one "not registered" reply a day and nothing else', async () => {
  const s = setup();
  await receive(s, { from: FAKE_STRANGER_NUMBER, text: 'pending', id: 'wamid.S1' });
  await receive(s, { from: FAKE_STRANGER_NUMBER, text: 'pending', id: 'wamid.S2' });
  assertEquals(s.sent.map((item) => [item.to, replyText([item.reply])]), [[
    FAKE_STRANGER_NUMBER,
    NOT_REGISTERED,
  ]]);
  assertEquals([s.state.inbound.length, s.state.actions.length, s.llmCalls.length], [0, 0, 0]);
});

Deno.test('process › the same message id twice is handled once', async () => {
  const s = setup();
  await receive(s, { text: 'pending', id: 'wamid.DUP' });
  await receive(s, { text: 'pending', id: 'wamid.DUP' });
  // "pending" is the list text plus the M7 "Open a shopkeeper" list; the repeat sends nothing.
  assertEquals([s.sent.length, s.state.inbound.length], [2, 1]);
  assertEquals(s.logs.some((log) => log.event === 'whatsapp_duplicate'), true);
});

Deno.test('process › pending and a name lookup answer from the ledger', async () => {
  const s = setup();
  await receive(s, { text: 'pending', id: 'wamid.1' });
  await receive(s, { text: 'Ramesh', id: 'wamid.2' });
  const text = lastText(s);
  assertStringIncludes(text, '1. Ramesh (Ramesh Kirana) · ₹8,500 · 12 days overdue');
  assertStringIncludes(text, 'Ramesh says he paid ₹2,000 on Sun 1 Nov');
  assertEquals(s.llmCalls, []);
});

Deno.test('process › "Ramesh 5000 due 15th" → card → Save → new balance; second Save says already saved', async () => {
  const s = setup();
  await receive(s, { text: 'Ramesh 5000 due 15th', id: 'wamid.1' });
  const card = s.sent[0]?.reply;
  const tap = parseTap(card?.kind === 'buttons' ? card.buttons[0]?.id ?? '' : '');
  const actionId = tap?.kind === 'card' ? tap.actionId : '';
  await receive(s, { buttonId: cardButtonId(actionId, 'save'), id: 'wamid.2' });
  await receive(s, { buttonId: cardButtonId(actionId, 'save'), id: 'wamid.3' });
  const replies = s.sent.map((item) => replyText([item.reply]));
  const saved = `✅ Saved. Ramesh now owes ₹13,500.\n\n📒 View in books: ${
    fakeShopkeeperLink(RAMESH.id)
  }\n📒 Pending\n📋 Menu`;
  assertEquals(replies.slice(1), [saved, 'Already saved.']);
  assertEquals(s.state.inbound.map((row) => row.path), ['command', 'button', 'button']);
});

Deno.test('process › Telugu free text goes to the LLM and gives a payment card, nothing saved', async () => {
  const s = setup({
    llm: { suggestion: { intent: 'mark_paid', name: 'Ramesh', amount: 2000 }, path: 'sarvam' },
  });
  const before = s.state.entries.length;
  await receive(s, { text: 'రమేష్ 2000 కట్టాడు' });
  assertStringIncludes(lastText(s), 'చెల్లింపు అందింది');
  assertEquals([s.state.entries.length, s.state.actions.length], [before, 1]);
  assertEquals(s.state.inbound[0]?.path, 'sarvam');
});

Deno.test('process › both LLMs failing → "Sorry" + help, path failed', async () => {
  const s = setup();
  await receive(s, { text: 'what is the weather like today' });
  assertStringIncludes(lastText(s), "Sorry, I didn't get that.");
  assertEquals(s.state.inbound[0]?.path, 'failed');
});

Deno.test('process › claim buttons, lookup rows and unknown buttons', async () => {
  const s = setup();
  await receive(s, { buttonId: claimButtonId(CLAIM_ID, true, 'en'), id: 'wamid.1' });
  await receive(s, { listRowId: lookupRowId(RAMESH.id, 'en'), id: 'wamid.2' });
  await receive(s, {
    listRowId: lookupRowId('5e000000-0000-4000-8000-0000000000ff', 'en'),
    id: 'wamid.3',
  });
  await receive(s, { buttonId: 'something-else', id: 'wamid.4' });
  const replies = s.sent.map((item) => replyText([item.reply]));
  assertEquals(replies[0], 'Confirmed. Ramesh now owes ₹6,500.');
  assertStringIncludes(replies[1] ?? '', 'Balance: ₹6,500');
  assertEquals(s.state.inbound.map((row) => row.command), [
    'claim_confirm',
    'lookup',
    'lookup',
    'unknown_button',
  ]);
});

Deno.test('process › an image (or audio without a media id) gets "text or voice notes"', async () => {
  const s = setup();
  await receive(s, { type: 'image' });
  assertEquals(s.state.inbound[0]?.command, 'unsupported');
  assertStringIncludes(lastText(s), 'వాయిస్ నోట్‌లు'); // owner's language (Telugu)
});

/** Meta and Saaras faked: the note is `seconds` long and Saaras "hears" `heard`. */
function listening(
  heard: string,
  options: { seconds?: number; language?: 'te' | 'hi' | 'en' } = {},
): ProcessDeps['listen'] & { saaras: number[] } {
  const saaras: number[] = [];
  return {
    saaras,
    download: () =>
      Promise.resolve({
        kind: 'ok',
        bytes: voiceNote(options.seconds ?? 8),
        mimeType: 'audio/ogg; codecs=opus',
      }),
    transcribe: () => {
      saaras.push(1);
      return Promise.resolve({ kind: 'heard', text: heard, language: options.language ?? 'en' });
    },
  };
}

Deno.test('process › a voice note becomes the same Save card as the typed text (M6)', async () => {
  const listen = listening('Ramesh 5000 due 15th');
  const s = setup({ listen });
  const before = s.state.entries.length;
  await receive(s, { audioId: 'MEDIA1' });
  const text = lastText(s);
  assert(text.startsWith('🎤 Heard: “Ramesh 5000 due 15th”\n\n🧾 *Add credit*'), text);
  assertStringIncludes(text, '₹5,000 · due Sun 15 Nov');
  assertEquals(s.sent[0]?.reply.kind, 'buttons');
  assertEquals(s.state.entries.length, before);
  assertEquals(s.state.inbound[0], {
    waMessageId: 'wamid.TEST1',
    senderHash: s.state.inbound[0]?.senderHash ?? '',
    path: 'command',
    command: 'add_credit',
    msgType: 'voice',
    istDay: '2026-11-02',
  });
});

Deno.test('process › the reply follows the language Saaras heard', async () => {
  const s = setup({ listen: listening('Ramesh 5000 due 15th', { language: 'te' }) });
  await receive(s, { audioId: 'M' });
  assertStringIncludes(lastText(s), '🎤 విన్నది: “Ramesh 5000 due 15th”');
});

Deno.test('process › a voice note the rules cannot read goes to the LLM like text', async () => {
  const s = setup({
    listen: listening('రమేష్ రెండు వేలు ఇచ్చాడు', { language: 'te' }),
    llm: { suggestion: { intent: 'mark_paid', name: 'Ramesh', amount: 2000 }, path: 'sarvam' },
  });
  await receive(s, { audioId: 'M' });
  assertEquals(s.llmCalls, ['రమేష్ రెండు వేలు ఇచ్చాడు']);
  assertEquals(s.state.inbound[0]?.path, 'sarvam');
  assertStringIncludes(lastText(s), '₹2,000');
});

Deno.test('process › a 40-second voice note is refused before Saaras is paid', async () => {
  const listen = listening('x', { seconds: 40 });
  const s = setup({ listen });
  await receive(s, { audioId: 'M' });
  assertEquals(listen.saaras.length, 0);
  assertStringIncludes(lastText(s), '30 సెకన్ల');
  assertEquals(s.state.inbound[0]?.command, 'voice_too_long');
});

Deno.test('process › past 50 voice notes today, the 51st is not downloaded', async () => {
  const listen = listening('pending');
  const earlier = Array.from({ length: 50 }, (_, i) => ({
    waMessageId: `wamid.V${i}`,
    senderHash: 'h',
    path: 'command',
    command: 'pending',
    msgType: 'voice',
    istDay: '2026-11-02',
  }));
  const s = setup({ listen, state: { inbound: earlier } });
  await receive(s, { audioId: 'M' });
  assertEquals(listen.saaras.length, 0);
  assertStringIncludes(lastText(s), 'ఆపబడ్డాయి');
});

Deno.test('process › a failure while answering sends "something went wrong" and logs it', async () => {
  const s = setup({ book: { listEntries: () => Promise.reject(new Error('db down')) } });
  await receive(s, { text: 'pending' });
  assertEquals(s.state.inbound[0]?.path, 'failed');
  assertEquals(s.logs.some((log) => log.event === 'whatsapp_route_failed'), true);
  assertEquals(s.sent.length, 1);
});

Deno.test('process › no owner row or a failed message log is logged, not thrown', async () => {
  const s = setup({ state: { owner: null } });
  await receive(s, { text: 'hi' });
  assertEquals(s.logs.some((log) => log.event === 'whatsapp_process_failed'), true);
  const t = setup({ book: { recordOutbound: () => Promise.reject(new Error('x')) } });
  await receive(t, { text: 'hi' });
  assertEquals(t.logs.some((log) => log.event === 'outbound_log_failed'), true);
});

Deno.test('process › the owner number never appears in logs or stored rows', async () => {
  const s = setup();
  await receive(s, { text: 'Suresh Babu 3000', id: 'wamid.1' });
  await receive(s, { from: FAKE_STRANGER_NUMBER, text: 'hi', id: 'wamid.2' });
  const stored = JSON.stringify([
    s.state.inbound,
    s.state.outbound,
    s.state.actions,
    s.state.strangerReplies,
  ]);
  const logged = JSON.stringify(s.logs);
  for (const number of [FAKE_OWNER_NUMBER, FAKE_STRANGER_NUMBER, '0000099999']) {
    assert(!stored.includes(number) && !logged.includes(number), number);
  }
  assert(!logged.includes('Suresh') && !logged.includes('3000'));
});

Deno.test('process › closed, an ambiguous name and an unknown name', async () => {
  const s = setup({
    llm: {
      suggestion: { intent: 'ledger_query', query: 'shopkeeper', name: 'Venkat' },
      path: 'sarvam',
    },
  });
  await receive(s, { text: 'closed', id: 'wamid.1' });
  await receive(s, { text: 'Praveen', id: 'wamid.2' });
  await receive(s, { text: 'how much does venkat owe', id: 'wamid.3' });
  const replies = s.sent.map((item) => replyText([item.reply]));
  assertStringIncludes(replies[0] ?? '', 'Praveen (Praveen Bakery) · ₹1,500');
  assertStringIncludes(replies[1] ?? '', 'Which Praveen?');
  assertStringIncludes(replies[2] ?? '', 'No shopkeeper called Venkat');
});

Deno.test('process › Not received on a claim and a pick-list row', async () => {
  const s = setup();
  await receive(s, { buttonId: claimButtonId(CLAIM_ID, false, 'en'), id: 'wamid.1' });
  await receive(s, { text: 'Praveen 500', id: 'wamid.2' });
  const list = s.sent[1]?.reply;
  await receive(s, {
    listRowId: list?.kind === 'list' ? list.rows[0]?.id ?? '' : '',
    id: 'wamid.3',
  });
  assertEquals(s.state.inbound.map((row) => row.command), ['claim_reject', 'add_credit', 'pick']);
  assertStringIncludes(replyText([s.sent[2]!.reply]), 'Praveen (Praveen Bakery)');
});

Deno.test('process › logs only the error name or the database operation + code (CP2 L1)', async () => {
  const s = setup({
    book: { listEntries: () => Promise.reject(new Error('Ramesh owes 3000 at +91 00000 99999')) },
  });
  await receive(s, { text: 'pending', id: 'wamid.L1' });
  assertEquals(
    s.logs.find((log) => log.event === 'whatsapp_route_failed')?.fields['error'],
    'Error',
  );
  const t = setup({
    book: { recordInbound: () => Promise.reject(new RepositoryError('recordInbound', '23505')) },
  });
  await receive(t, { text: 'hi', id: 'wamid.L2' });
  assertEquals(
    t.logs.find((log) => log.event === 'whatsapp_process_failed')?.fields['error'],
    'recordInbound failed (23505)',
  );
  const u = setup({ book: { recordOutbound: () => Promise.reject(new TypeError('secret text')) } });
  await receive(u, { text: 'hi', id: 'wamid.L3' });
  assertEquals(
    u.logs.find((log) => log.event === 'outbound_log_failed')?.fields['error'],
    'TypeError',
  );
  assert(!JSON.stringify([s.logs, u.logs]).includes('3000'));
  assert(!JSON.stringify(u.logs).includes('secret'));
});

Deno.test('process › a non-Error failure is still logged', async () => {
  const s = setup({ book: { recordInbound: () => Promise.reject('db down') } });
  await receive(s, { text: 'hi' });
  assertEquals(
    s.logs.find((log) => log.event === 'whatsapp_process_failed')?.fields['error'],
    'unknown error',
  );
});

Deno.test('process › each new owner message wakes the worker once (pg_cron fallback)', async () => {
  const s = setup();
  await receive(s, { text: 'hi', id: 'wamid.W1' });
  await receive(s, { text: 'hi', id: 'wamid.W1' });
  await receive(s, { from: FAKE_STRANGER_NUMBER, text: 'hi', id: 'wamid.W2' });
  assertEquals(s.wakes.length, 1);
});

/** Bulbul and the Meta upload faked; records what was spoken. */
function speaking(
  options: { mp3?: boolean; uploadId?: string | null; summarize?: SpokenSummarizer } = {},
): {
  voice: ProcessDeps['voice'];
  spoken: Array<{ text: string; language: string }>;
  asked: SpokenInput[];
} {
  const spoken: Array<{ text: string; language: string }> = [];
  const asked: SpokenInput[] = [];
  const voice: ProcessDeps['voice'] = {
    summarize: (input) => {
      asked.push(input);
      return (options.summarize ?? FLAT_SUMMARY)(input);
    },
    speak: (text, language) => {
      spoken.push({ text, language });
      return Promise.resolve(options.mp3 === false ? null : new Uint8Array([0x49, 0x44, 0x33]));
    },
    upload: () => Promise.resolve(options.uploadId === undefined ? 'MP3ID' : options.uploadId),
  };
  return { voice, spoken, asked };
}

Deno.test('process › a heard voice note gets the text first, then a voice reply (M6)', async () => {
  const { voice, spoken } = speaking();
  const s = setup({ listen: listening('pending', { language: 'en' }), voice });
  await receive(s, { audioId: 'M' });
  assertEquals(s.sent.map((item) => item.reply.kind), ['text', 'list', 'audio']);
  assertEquals(s.sent[2]?.reply, { kind: 'audio', mediaId: 'MP3ID' });
  assertEquals(spoken[0]?.language, 'en');
  assert(!spoken[0]?.text.includes('Heard'), spoken[0]?.text);
  assertStringIncludes(spoken[0]?.text ?? '', 'rupees');
  assertEquals(s.state.outbound.map((row) => row.msgType), ['text', 'list', 'audio']);
});

Deno.test('process › M7: the voice says the summary, asked with the language and every name', async () => {
  const summarize: SpokenSummarizer = () => Promise.resolve('Srinivas, two people owe you.');
  const { voice, spoken, asked } = speaking({ summarize });
  const s = setup({ listen: listening('pending', { language: 'en' }), voice });
  await receive(s, { audioId: 'M' });
  assertEquals(spoken, [{ text: 'Srinivas, two people owe you.', language: 'en' }]);
  assertEquals(asked[0]?.language, 'en');
  assert(asked[0]?.names.includes(RAMESH.name) && asked[0]?.names.includes(RAMESH.shopName));
  assert(asked[0]?.names.includes('Srinivas Reddy'), 'owner name');
});

Deno.test('process › M7: a summariser that throws still sends the flat spokenText voice', async () => {
  const summarize: SpokenSummarizer = () => Promise.reject(new Error('boom'));
  const { voice, spoken } = speaking({ summarize });
  const s = setup({ listen: listening('pending', { language: 'en' }), voice });
  await receive(s, { audioId: 'M' });
  assertStringIncludes(spoken[0]?.text ?? '', 'rupees');
  assert(s.logs.some((log) => log.event === 'spoken_summary_failed'));
  assertEquals(s.sent.at(-1)?.reply.kind, 'audio');
});

Deno.test('process › typed text never gets a voice reply', async () => {
  const { voice, spoken, asked } = speaking();
  const s = setup({ voice });
  await receive(s, { text: 'pending' });
  assertEquals(spoken.length, 0);
  assertEquals(asked.length, 0);
  assertEquals(s.sent.map((item) => item.reply.kind), ['text', 'list']);
});

Deno.test('process › Bulbul or the upload failing leaves just the text', async () => {
  for (const options of [{ mp3: false }, { uploadId: null }]) {
    const { voice } = speaking(options);
    const s = setup({ listen: listening('pending'), voice });
    await receive(s, { audioId: 'M' });
    assertEquals(s.sent.map((item) => item.reply.kind), ['text', 'list']);
  }
});

Deno.test('process › a voice-reply error is logged, never thrown', async () => {
  const voice: ProcessDeps['voice'] = {
    summarize: FLAT_SUMMARY,
    speak: () => Promise.reject(new Error('boom')),
    upload: () => Promise.resolve('x'),
  };
  const s = setup({ listen: listening('pending'), voice });
  await receive(s, { audioId: 'M' });
  assertEquals(s.logs.some((log) => log.event === 'voice_reply_failed'), true);
  assertEquals(s.state.inbound[0]?.command, 'pending');
});

Deno.test('process › after 50 voice replies today, text only', async () => {
  const { voice, spoken, asked } = speaking();
  const earlier = Array.from({ length: 50 }, (_, i) => ({
    waMessageId: `wamid.A${i}`,
    senderHash: 'h',
    msgType: 'audio',
    istDay: '2026-11-02',
  }));
  const s = setup({ listen: listening('pending'), voice, state: { outbound: earlier } });
  await receive(s, { audioId: 'M' });
  assertEquals(spoken.length, 0);
  assertEquals(asked.length, 0, 'no summary LLM call past the cap');
  assertEquals(s.logs.some((log) => log.event === 'voice_reply_cap'), true);
});

Deno.test('process › a very long transcript is shortened on the Heard line', async () => {
  const s = setup({ listen: listening(`pending ${'and more '.repeat(60)}`) });
  await receive(s, { audioId: 'M' });
  const heard = lastText(s).split('\n\n')[0] ?? '';
  assertEquals(heard.endsWith('…”'), true);
  assertEquals(heard.length < 330, true);
});
