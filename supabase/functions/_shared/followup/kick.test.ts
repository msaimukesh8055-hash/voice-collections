// supabase/functions/_shared/followup/kick.test.ts
import { assertEquals } from '@std/assert';
import type { LogFields } from '../log.ts';
import { newTrace, runInTrace } from '../ops/trace.ts';
import { TRACE_HEADER } from '../ops/tracing.ts';
import {
  createFollowupKicker,
  createJobKicker,
  type FollowupKicker,
  followupWorkerUrl,
  SIMULATION_NEXT_PATH,
  SWEEP_PATH,
} from './kick.ts';

const CALL_ID = 'ca000000-0000-4000-8000-0000000000aa';
const SECRET = 'w'.repeat(40);

interface KickSetup {
  readonly kick: FollowupKicker;
  readonly tasks: Promise<unknown>[];
  readonly slept: number[];
  readonly seen: { url: string; headers: Record<string, string>; method: string }[];
  readonly logs: LogFields[];
}

function setup(answer: Response | Error | string): KickSetup {
  const tasks: Promise<unknown>[] = [];
  const slept: number[] = [];
  const seen: { url: string; headers: Record<string, string>; method: string }[] = [];
  const logs: LogFields[] = [];
  function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    seen.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      method: init?.method ?? 'GET',
    });
    if (answer instanceof Response) return Promise.resolve(answer);
    return Promise.reject(answer);
  }
  const kick = createFollowupKicker({
    workerUrl: followupWorkerUrl('https://ref.supabase.co/'),
    secret: SECRET,
    fetchImpl: fakeFetch,
    log: (_level, _event, fields = {}) => logs.push(fields),
    defer: (task) => tasks.push(task),
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  });
  return { kick, tasks, slept, seen, logs };
}

Deno.test('kick › posts to the worker with the bearer secret, in the background', async () => {
  const { kick, tasks, seen, slept } = setup(new Response(null, { status: 202 }));
  kick(CALL_ID);
  await Promise.all(tasks);
  assertEquals(
    seen[0]?.url,
    `https://ref.supabase.co/functions/v1/followup-worker/calls/${CALL_ID}`,
  );
  assertEquals(seen[0]?.method, 'POST');
  assertEquals(seen[0]?.headers['authorization'], `Bearer ${SECRET}`);
  assertEquals(slept, []);
});

Deno.test('kick › a delayed kick waits first (transcript retry)', async () => {
  const { kick, tasks, slept } = setup(new Response(null, { status: 202 }));
  kick(CALL_ID, 30_000);
  await Promise.all(tasks);
  assertEquals(slept, [30_000]);
});

Deno.test('kick › a refused or failed kick is logged without the secret', async () => {
  for (const answer of [new Response(null, { status: 401 }), new TypeError('down'), 'odd']) {
    const { kick, tasks, logs } = setup(answer);
    kick(CALL_ID);
    await Promise.all(tasks);
    assertEquals(logs.length, 1);
    assertEquals(JSON.stringify(logs).includes(SECRET), false);
  }
});

Deno.test('kick › the default sleep really waits', async () => {
  const tasks: Promise<unknown>[] = [];
  const kick = createFollowupKicker({
    workerUrl: 'https://ref.supabase.co/functions/v1/followup-worker',
    secret: SECRET,
    fetchImpl: () => Promise.resolve(new Response(null, { status: 202 })),
    log: () => undefined,
    defer: (task) => tasks.push(task),
  });
  const started = Date.now();
  kick(CALL_ID, 5);
  await Promise.all(tasks);
  assertEquals(Date.now() - started >= 4, true);
});

Deno.test('kick › a job kick posts a fixed path, once per wake (M5 5b)', async () => {
  const tasks: Promise<unknown>[] = [];
  const urls: string[] = [];
  const kickJob = createJobKicker({
    workerUrl: followupWorkerUrl('https://ref.supabase.co'),
    secret: SECRET,
    fetchImpl: (input) => {
      urls.push(String(input));
      return Promise.resolve(new Response(null, { status: 202 }));
    },
    log: () => {},
    defer: (task) => tasks.push(task),
  });
  kickJob(SIMULATION_NEXT_PATH, 3);
  kickJob(SWEEP_PATH);
  await Promise.all(tasks);
  assertEquals(urls.length, 4);
  assertEquals(urls[3], 'https://ref.supabase.co/functions/v1/followup-worker/sweep');
});

Deno.test('kick › inside a request the worker gets the trace id; outside it only the secret', async () => {
  const outside = setup(new Response('{}', { status: 200 }));
  outside.kick(CALL_ID);
  await Promise.all(outside.tasks);
  assertEquals(outside.seen[0]?.headers, { authorization: `Bearer ${SECRET}` });

  const inside = setup(new Response('{}', { status: 200 }));
  const trace = newTrace('calls-api', '44444444-4444-4444-8444-444444444444');
  // A delayed kick still carries the id of the request that made it.
  runInTrace(trace, () => inside.kick(CALL_ID, 500));
  await Promise.all(inside.tasks);
  assertEquals(inside.seen[0]?.headers, {
    authorization: `Bearer ${SECRET}`,
    [TRACE_HEADER]: trace.id,
  });
});
