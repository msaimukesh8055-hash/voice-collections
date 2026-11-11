// supabase/functions/whatsapp-webhook/failure-drills.test.ts
// Failure drills (M9 Build A5): what the owner sees, what is recorded and what happens to the
// money when something outside our code breaks. Each drill runs a signed Meta request through the
// real webhook handler, the real message processing and the real tracing, over the fake book, a
// fake WhatsApp client and a fake network. Three promises are checked every time:
//   1. the owner gets a polite reply, never silence or a stack trace;
//   2. the failure is recorded as ops events on one trace (so the ops page and the alert see it);
//   3. no money record is half-saved.
import { assertEquals, assertStringIncludes } from '@std/assert';
import { createBrainLlm } from '../_shared/brain/llm.ts';
import { FAKE_WEB } from '../_shared/cards/__fixtures__/bot-context.ts';
import { cardButtonId, parseTap } from '../_shared/cards/ids.ts';
import type { BookRepository } from '../_shared/db/book-repository.ts';
import {
  createFakeBookRepository,
  type FakeBookState,
} from '../_shared/db/fake-book-repository.ts';
import { createFakeOwnerCallRepository } from '../_shared/db/fake-owner-call-repository.ts';
import { RepositoryError } from '../_shared/db/postgrest.ts';
import type { OpsEvent } from '../_shared/ops/trace.ts';
import { createTracing } from '../_shared/ops/tracing.ts';
import { problemsOf } from '../_shared/ops/watch.ts';
import { reminderSetup } from '../_shared/reminders/__fixtures__/reminder-deps.ts';
import {
  FAKE_OWNER_NUMBER,
  metaPayload,
  type PayloadOptions,
  PHONE_NUMBER_ID,
} from '../_shared/whatsapp/__fixtures__/meta-payloads.ts';
import { phrasesFor } from '../_shared/whatsapp/phrases.ts';
import { type Reply, replyText } from '../_shared/whatsapp/replies.ts';
import { signBody } from '../_shared/whatsapp/signature.ts';
import { spokenText } from '../_shared/whatsapp/spoken.ts';
import { handleWebhook } from './handler.ts';
import { type ProcessDeps, processPayload } from './process.ts';

const NOW = new Date('2026-11-02T12:00:00+05:30');
const URL = 'https://ref.supabase.co/functions/v1/whatsapp-webhook';
const APP_SECRET = 'app-secret';
const SERVICE_DOWN = 503;

interface Drill {
  readonly state: FakeBookState;
  readonly sent: Reply[];
  readonly events: OpsEvent[];
  /** One signed Meta delivery through the whole function; resolves when the background work
   * and the ops write have finished. */
  deliver(options: PayloadOptions): Promise<number>;
}

function drill(
  options: {
    book?: Partial<BookRepository>;
    /** While this answers true, writing a ledger entry fails as if the database were down. */
    ledgerDown?: () => boolean;
    llmStatus?: number;
    opsWriteFails?: boolean;
  } = {},
): Drill {
  const fake = createFakeBookRepository();
  const sent: Reply[] = [];
  const events: OpsEvent[] = [];
  const tasks: Promise<unknown>[] = [];
  const tracing = createTracing({
    source: 'whatsapp-webhook',
    write: (batch) => {
      if (options.opsWriteFails) return Promise.reject(new RepositoryError('write', 'HTTP 500'));
      events.push(...batch);
      return Promise.resolve();
    },
    waitUntil: (task) => {
      tasks.push(task);
    },
    baseLog: () => {},
    clock: () => NOW,
  });
  const insertEntry: BookRepository['insertEntry'] = (entry) =>
    options.ledgerDown?.()
      ? Promise.reject(new RepositoryError('insertEntry', 'HTTP 503'))
      : fake.book.insertEntry(entry);
  const processDeps: ProcessDeps = {
    book: { ...fake.book, insertEntry, ...options.book },
    client: {
      send: (_to, reply) => {
        sent.push(reply);
        return Promise.resolve(`wamid.OUT${sent.length}`);
      },
    },
    // The real brain over a network where both LLM providers answer with `llmStatus`.
    llm: createBrainLlm({
      sarvamApiKey: 'sk',
      geminiApiKey: 'gk',
      fetchImpl: () =>
        Promise.resolve(new Response('{}', { status: options.llmStatus ?? SERVICE_DOWN })),
      log: tracing.log,
    }),
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
    log: tracing.log,
    reminder: reminderSetup({ now: NOW }).deps,
    listen: {
      download: () => Promise.resolve({ kind: 'failed' }),
      transcribe: () => Promise.resolve({ kind: 'failed' }),
    },
    web: FAKE_WEB,
    munshi: { ownerCalls: createFakeOwnerCallRepository().ownerCalls, link: null },
    voice: {
      summarize: (input) => Promise.resolve(spokenText(input.replies, input.language)),
      speak: () => Promise.resolve(null),
      upload: () => Promise.resolve(null),
    },
    wakeWorker: () => {},
  };
  const serve = tracing.serve((req) =>
    handleWebhook(req, {
      verifyToken: 'verify-token',
      appSecret: APP_SECRET,
      defer: tracing.defer,
      process: (payload) => processPayload(payload, processDeps),
      log: tracing.log,
    })
  );
  async function deliver(payloadOptions: PayloadOptions): Promise<number> {
    const body = JSON.stringify(metaPayload(payloadOptions));
    const signature = await signBody(new TextEncoder().encode(body), APP_SECRET);
    const headers = { 'content-type': 'application/json', 'x-hub-signature-256': signature };
    const response = await serve(new Request(URL, { method: 'POST', headers, body }));
    // Background work can hand over more work (the ops write after it), so wait until none is left.
    while (tasks.length > 0) await Promise.all(tasks.splice(0, tasks.length));
    return response.status;
  }
  return { state: fake.state, sent, events, deliver };
}

function steps(events: readonly OpsEvent[], step: string): readonly OpsEvent[] {
  return events.filter((event) => event.step === step);
}

/** Sends "Ramesh 5000 due 15th" and returns the Save button of the card that comes back. */
async function openSaveCard(d: Drill): Promise<string> {
  await d.deliver({ text: 'Ramesh 5000 due 15th', id: 'wamid.CARD' });
  const card = d.sent.at(-1);
  const tap = parseTap(card?.kind === 'buttons' ? card.buttons[0]?.id ?? '' : '');
  return cardButtonId(tap?.kind === 'card' ? tap.actionId : '', 'save');
}

Deno.test('drill › both LLM providers down: a polite reply, the failure traced, nothing saved', async () => {
  const d = drill({ llmStatus: SERVICE_DOWN });
  const before = d.state.entries.length;
  const status = await d.deliver({ text: 'ఆ కిరాణా అతను ఏదో ఇచ్చాడు అనుకుంటా', id: 'wamid.LLM' });
  assertEquals(status, 200);
  assertEquals(d.sent.length > 0, true);
  // The message is Telugu ("I think that kirana man gave something"), so the apology is too.
  assertStringIncludes(replyText(d.sent), phrasesFor('te').sorry);
  assertEquals(d.state.entries.length, before);
  assertEquals(d.state.inbound[0]?.path, 'failed');
  // Sarvam was tried, then Gemini; both failures are on the trace with the provider and code.
  const llm = steps(d.events, 'brain_llm');
  assertEquals(llm.map((event) => [event.provider, event.status, event.error_code]), [
    ['sarvam', 'warn', 'HTTP 503'],
    ['gemini', 'warn', 'HTTP 503'],
  ]);
  assertEquals(new Set(d.events.map((event) => event.trace_id)).size, 1);
  assertEquals(steps(d.events, 'request')[0]?.status, 'ok');
});

Deno.test('drill › Meta delivers the same Save tap five times: the credit is saved once', async () => {
  const d = drill();
  const save = await openSaveCard(d);
  const before = d.state.entries.length;
  const repliesBefore = d.sent.length;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assertEquals(await d.deliver({ buttonId: save, id: 'wamid.SAVE' }), 200);
  }
  assertEquals(d.state.entries.length, before + 1);
  assertEquals(d.sent.length, repliesBefore + 1);
  assertStringIncludes(replyText(d.sent.slice(repliesBefore)), 'Saved. Ramesh now owes ₹13,500');
  assertEquals(steps(d.events, 'whatsapp_duplicate').length, 4);
  // Every delivery was answered 200 on its own trace, so Meta stops retrying.
  const requests = steps(d.events, 'request').slice(1);
  assertEquals(requests.map((event) => event.status), ['ok', 'ok', 'ok', 'ok', 'ok']);
  assertEquals(new Set(requests.map((event) => event.trace_id)).size, 5);
});

Deno.test('drill › the database fails while saving: card reopened, nothing half-saved, alert raised', async () => {
  let dbDown = true;
  const flaky = drill({ ledgerDown: () => dbDown });
  const save = await openSaveCard(flaky);
  const before = flaky.state.entries.length;
  await flaky.deliver({ buttonId: save, id: 'wamid.SAVE1' });
  assertEquals(flaky.state.entries.length, before);
  assertEquals(replyText(flaky.sent.slice(-1)), phrasesFor('en').saveFailed);
  assertEquals(flaky.state.actions[0]?.status, 'open');
  // The failure is an error step, and the alert job would report exactly this problem.
  const failed = steps(flaky.events, 'card_save_failed');
  assertEquals(failed.map((event) => [event.status, event.error_code]), [[
    'error',
    'RepositoryError',
  ]]);
  const errors = flaky.events.filter((event) => event.status === 'error').map((event) => ({
    traceId: event.trace_id,
    source: event.source,
    step: event.step,
    errorCode: event.error_code,
    createdAt: event.created_at,
  }));
  assertEquals(problemsOf(errors).map((problem) => problem.line), [
    'whatsapp-webhook · card_save_failed (RepositoryError)',
  ]);
  // The database comes back: the same card can be saved, once.
  dbDown = false;
  await flaky.deliver({ buttonId: save, id: 'wamid.SAVE2' });
  assertEquals(flaky.state.entries.length, before + 1);
  assertEquals(flaky.state.actions[0]?.status, 'saved');
});

Deno.test('drill › a failed read while answering: "something went wrong", an error on the trace', async () => {
  const d = drill({ book: { listEntries: () => Promise.reject(new Error('db down')) } });
  assertEquals(await d.deliver({ text: 'pending', id: 'wamid.READ' }), 200);
  assertStringIncludes(replyText(d.sent), phrasesFor('te').somethingWrong);
  assertEquals(steps(d.events, 'whatsapp_route_failed')[0]?.status, 'error');
});

Deno.test('drill › the ops table itself is down: the owner is still answered', async () => {
  const d = drill({ opsWriteFails: true });
  assertEquals(await d.deliver({ text: 'pending', id: 'wamid.OPS' }), 200);
  assertStringIncludes(replyText(d.sent), 'Ramesh');
  assertEquals(d.events, []);
});

Deno.test('drill › a request with a forged signature is refused and traced as a warning', async () => {
  const d = drill();
  const serve = d.deliver;
  // A valid delivery first proves the harness; then the forged one, sent by hand.
  await serve({ text: 'hi', id: 'wamid.OK' });
  const sentBefore = d.sent.length;
  const tracing = createTracing({
    source: 'whatsapp-webhook',
    write: (batch) => {
      d.events.push(...batch);
      return Promise.resolve();
    },
    waitUntil: () => {},
    baseLog: () => {},
    clock: () => NOW,
  });
  const forged = new Request(URL, {
    method: 'POST',
    headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) },
    body: JSON.stringify(metaPayload({ text: 'Ramesh paid 8500' })),
  });
  const response = await tracing.serve((req) =>
    handleWebhook(req, {
      verifyToken: 'verify-token',
      appSecret: APP_SECRET,
      defer: tracing.defer,
      process: () => Promise.reject(new Error('must not run')),
      log: tracing.log,
    })
  )(forged);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(response.status, 401);
  assertEquals(d.sent.length, sentBefore);
  const refused = steps(d.events, 'whatsapp_bad_signature');
  assertEquals(refused.map((event) => event.status), ['warn']);
});
