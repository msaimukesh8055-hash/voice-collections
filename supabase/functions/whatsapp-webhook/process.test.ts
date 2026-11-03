// supabase/functions/whatsapp-webhook/process.test.ts
// One message end to end over fakes: fake book, fake WhatsApp client (records replies, no
// network), fake LLM. FAKE numbers only.
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
import { type ProcessDeps, processPayload } from './process.ts';

const NOW = new Date('2026-11-02T12:00:00+05:30');

interface Setup {
  readonly deps: ProcessDeps;
  readonly state: FakeBookState;
  readonly sent: Array<{ to: string; reply: Reply }>;
  readonly logs: Array<{ event: string; fields: LogFields }>;
  readonly llmCalls: string[];
}

function setup(
  options: { llm?: LlmResult; book?: Partial<BookRepository>; state?: Partial<FakeBookState> } = {},
): Setup {
  const fake = createFakeBookRepository(options.state);
  const sent: Array<{ to: string; reply: Reply }> = [];
  const logs: Array<{ event: string; fields: LogFields }> = [];
  const llmCalls: string[] = [];
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
  };
  return { deps, state: fake.state, sent, logs, llmCalls };
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
  assertEquals([s.sent.length, s.state.inbound.length], [1, 1]);
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
  assertEquals(replies.slice(1), ['Saved. Ramesh now owes ₹13,500.', 'Already saved.']);
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

Deno.test('process › a voice note gets "text only for now"', async () => {
  const s = setup();
  await receive(s, { type: 'audio' });
  assertEquals(s.state.inbound[0]?.command, 'unsupported');
  assertEquals(s.sent.length, 1);
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

Deno.test('process › a non-Error failure is still logged', async () => {
  const s = setup({ book: { recordInbound: () => Promise.reject('db down') } });
  await receive(s, { text: 'hi' });
  assertEquals(
    s.logs.find((log) => log.event === 'whatsapp_process_failed')?.fields['error'],
    'unknown',
  );
});
