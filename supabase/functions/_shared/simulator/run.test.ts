// supabase/functions/_shared/simulator/run.test.ts
// A simulated call end to end over fakes (M5 test list, 100%): tools run through the same
// registry and guards (no amounts before identity), audit rows written, transcript stored,
// follow-up queued, next call started; idle, stale, missing and failing runs. Fake LLMs only.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import {
  createFakeReminderRepository,
  type FakeQueuedCall,
} from '../db/fake-reminder-repository.ts';
import { createFakeRepository, FAKE_NOW, FAKE_RAMESH, fakeCall } from '../db/fake-repository.ts';
import type { ChatRequest } from '../llm/json-llm.ts';
import type { LogFields } from '../log.ts';
import { hasDigits } from '../tools/__fixtures__/tool-context.ts';
import { countBannedWords, runNextSimulation, type SimulatorDeps } from './run.ts';

const CALL_ID = 'ca000000-0000-4000-8000-0000000005a1';

interface Setup {
  readonly deps: SimulatorDeps;
  readonly repo: ReturnType<typeof createFakeRepository>;
  readonly store: ReturnType<typeof createFakeReminderRepository>;
  readonly kicked: string[];
  readonly next: number[];
  readonly logs: { event: string; fields: LogFields }[];
  readonly ashaRequests: ChatRequest[];
}

function queued(overrides: Partial<FakeQueuedCall> = {}): FakeQueuedCall {
  return {
    callId: CALL_ID,
    shopkeeperId: FAKE_RAMESH.id,
    mode: 'simulated',
    status: 'queued',
    queuedAt: '2026-11-02T06:29:00.000Z',
    acceptedAt: null,
    transcript: null,
    followupPending: false,
    ...overrides,
  };
}

function answers(
  list: readonly string[],
  seen: ChatRequest[] = [],
): (r: ChatRequest) => Promise<string> {
  let next = 0;
  return (request) => {
    seen.push(request);
    const answer = list[next];
    next += 1;
    return answer === undefined ? Promise.reject(new Error('no more')) : Promise.resolve(answer);
  };
}

function setup(
  options: { asha?: readonly string[]; shop?: readonly string[]; calls?: FakeQueuedCall[] } = {},
): Setup {
  const repo = createFakeRepository({
    calls: [fakeCall({ callId: CALL_ID, mode: 'simulated', status: 'in_progress' })],
  });
  const store = createFakeReminderRepository({
    calls: options.calls ?? [queued()],
    personas: { [FAKE_RAMESH.id]: 'slow_payer' },
    clock: () => FAKE_NOW,
  });
  const kicked: string[] = [];
  const next: number[] = [];
  const logs: { event: string; fields: LogFields }[] = [];
  const ashaRequests: ChatRequest[] = [];
  const deps: SimulatorDeps = {
    repo: repo.repo,
    store: store.reminders,
    asha: { name: 'sarvam', ask: answers(options.asha ?? [], ashaRequests) },
    shopkeeper: [
      { name: 'gemini', ask: () => Promise.reject(new Error('429')) },
      { name: 'sarvam', ask: answers(options.shop ?? []) },
    ],
    clock: () => FAKE_NOW,
    log: (_level, event, fields = {}) => logs.push({ event, fields }),
    kickFollowup: (callId) => kicked.push(callId),
    startNext: () => next.push(1),
  };
  return { deps, repo, store, kicked, next, logs, ashaRequests };
}

const tool = (name: string, args: Record<string, unknown> = {}, say = ''): string =>
  JSON.stringify({ say, tool: { name, args }, end_call: false });
const say = (text: string, end = false): string =>
  JSON.stringify({ say: text, tool: null, end_call: end });
const shop = (text: string, hangUp = false): string =>
  JSON.stringify({ say: text, hang_up: hangUp });

Deno.test('simulator › get_dues before identity is refused with no figures (same guard as live)', async () => {
  const s = setup({
    asha: [tool('get_dues'), say('May I know if this is Ramesh garu?'), say('Goodbye.', true)],
    shop: [shop('Hello?'), shop('...')],
  });
  assertEquals(await runNextSimulation(s.deps), 'done');
  const event = s.repo.state.toolEvents[0];
  assertEquals(event?.tool, 'get_dues');
  const result = event?.result as { ok: boolean; say: string };
  assertEquals([result.ok, hasDigits(result.say)], [false, false]);
  const toolReply = s.ashaRequests[1]?.messages.at(-1)?.content ?? '';
  assertStringIncludes(toolReply, 'IDENTITY_NOT_CONFIRMED');
});

Deno.test('simulator › identity, dues and a promise: audited, stored, followed up, next started', async () => {
  const s = setup({
    asha: [
      tool('confirm_identity', { answer: 'confirmed' }),
      tool('get_dues', {}, 'Thank you.'),
      say('You owe 8,500 rupees. When can you pay?'),
      tool('log_promise', { amount: 2000, promise_date: '2026-11-05' }),
      say('So 2,000 rupees on Thursday. Goodbye.', true),
    ],
    shop: [shop('Yes, Ramesh here.'), shop('2,000 on Thursday.')],
  });
  assertEquals(await runNextSimulation(s.deps), 'done');
  assertEquals(s.repo.state.toolEvents.map((e) => e.tool), [
    'confirm_identity',
    'get_dues',
    'log_promise',
  ]);
  assertEquals(s.repo.state.promises.map((p) => [p.amount, p.promiseDate]), [[2000, '2026-11-05']]);
  const call = s.store.state.calls[0];
  assertEquals([call?.status, call?.followupPending], ['completed', true]);
  assertEquals(call?.transcript?.[0]?.content.startsWith('నమస్కారం'), true);
  assertEquals([s.kicked, s.next.length], [[CALL_ID], 1]);
  const log = s.logs.find((entry) => entry.event === 'simulated_call')?.fields;
  assertEquals([log?.end, log?.toolCalls, log?.persona], ['asha_ended', 3, 'v1']);
  assert(
    s.logs.some((entry) =>
      entry.event === 'simulator_llm_failed' && entry.fields.provider === 'gemini'
    ),
  );
});

Deno.test('simulator › Asha speaks from the approved prompt with variables filled', async () => {
  const s = setup({ asha: [say('Bye', true)], shop: [shop('Yes')] });
  await runNextSimulation(s.deps);
  const system = s.ashaRequests[0]?.system ?? '';
  assertStringIncludes(
    system,
    'You are Asha, a polite AI assistant calling for Sri Lakshmi Traders',
  );
  assertStringIncludes(system, 'Today is Monday, 2026-11-02');
  assertEquals(system.includes('{{'), false);
  assertStringIncludes(system, '- record_payment_claim:');
  // Declared natively too: sarvam-105b calls tools that way (CP2 smoke finding).
  const tools = s.ashaRequests[0]?.tools?.map((tool) => tool.name) ?? [];
  assertEquals(tools.includes('confirm_identity') && tools.includes('log_promise'), true);
});

Deno.test('simulator › an unknown tool is audited under a fixed label', async () => {
  const s = setup({
    asha: [tool('delete_everything'), say('Goodbye.', true)],
    shop: [shop('Yes')],
  });
  await runNextSimulation(s.deps);
  assertEquals(s.repo.state.toolEvents.map((e) => e.tool), ['unknown']);
});

Deno.test('simulator › nothing queued → idle, nothing started', async () => {
  const s = setup({ calls: [] });
  assertEquals(await runNextSimulation(s.deps), 'idle');
  assertEquals([s.next.length, s.kicked.length], [0, 0]);
});

Deno.test('simulator › a stale simulated call is ended and its follow-up kicked', async () => {
  const stale = queued({ status: 'in_progress', acceptedAt: '2026-11-02T06:00:00.000Z' });
  const s = setup({ calls: [stale] });
  assertEquals(await runNextSimulation(s.deps), 'idle');
  assertEquals(s.kicked, [CALL_ID]);
  assertEquals(s.store.state.calls[0]?.status, 'completed');
});

Deno.test('simulator › a call that cannot be loaded is reported, and the next one still starts', async () => {
  const s = setup({ calls: [queued({ callId: 'ca000000-0000-4000-8000-0000000005ff' })] });
  assertEquals(await runNextSimulation(s.deps), 'not_found');
  assertEquals(s.next.length, 1);
});

Deno.test('simulator › a shopkeeper row that is gone is reported as not found', async () => {
  const s = setup();
  s.repo.state.shopkeepers = [];
  assertEquals(await runNextSimulation(s.deps), 'not_found');
});

Deno.test('simulator › a database failure mid-call is logged; the next call still starts', async () => {
  const s = setup({ asha: [say('Hi')], shop: [shop('Yes')] });
  const deps = {
    ...s.deps,
    store: { ...s.deps.store, getPersona: () => Promise.reject(new Error('db')) },
  };
  assertEquals(await runNextSimulation(deps), 'failed');
  assertEquals(s.next.length, 1);
  assert(s.logs.some((entry) => entry.event === 'simulated_call_failed'));
});

Deno.test('simulator › a call already ended elsewhere is not followed up twice', async () => {
  const s = setup({ asha: [say('Bye', true)], shop: [shop('Yes')] });
  const deps = {
    ...s.deps,
    store: { ...s.deps.store, finishSimulatedCall: () => Promise.resolve(false) },
  };
  await runNextSimulation(deps);
  assertEquals(s.kicked, []);
});

Deno.test("simulator › banned words in Asha's lines are counted (never in the shopkeeper's)", () => {
  assertEquals(
    countBannedWords([
      { role: 'assistant', content: 'We may go to the POLICE or court.' },
      { role: 'user', content: 'jail' },
    ]),
    2,
  );
});

Deno.test('simulator › every model failing ends the call quietly (logged, still finished)', async () => {
  const s = setup({ asha: [], shop: [shop('Yes')] });
  assertEquals(await runNextSimulation(s.deps), 'done');
  const log = s.logs.find((entry) => entry.event === 'simulated_call')?.fields;
  assertEquals(log?.end, 'asha_failed');
  assertEquals(s.kicked, [CALL_ID]);
});

Deno.test('simulator › a tool that hits a database error is logged as an error', async () => {
  const s = setup({
    asha: [tool('confirm_identity', { answer: 'confirmed' }), say('Sorry, goodbye.', true)],
    shop: [shop('Yes')],
  });
  const repo = { ...s.deps.repo, recordIdentity: () => Promise.reject(new Error('db')) };
  await runNextSimulation({ ...s.deps, repo });
  const event = s.logs.find((entry) => entry.event === 'tool_call')?.fields;
  assertEquals([event?.ok, typeof event?.error], [false, 'string']);
});
