// supabase/functions/_shared/ops/tracing.test.ts
import { assertEquals, assertMatch } from '@std/assert';
import type { LogFields, LogLevel } from '../log.ts';
import type { OpsEvent } from './trace.ts';
import { createTracing, routeOf, TRACE_HEADER, type Tracing } from './tracing.ts';

const TRACE_ID = '22222222-2222-4222-8222-222222222222';
const URL_BASE = 'https://ref.supabase.co/functions/v1';
const TICK_MS = 100;

interface Harness {
  readonly tracing: Tracing;
  readonly written: OpsEvent[][];
  readonly consoleLines: [LogLevel, string, LogFields | undefined][];
  /** Resolves when everything handed to waitUntil has finished. */
  settle(): Promise<void>;
}

function harness(options: { failWrites?: boolean; acceptTraceHeader?: boolean } = {}): Harness {
  const written: OpsEvent[][] = [];
  const consoleLines: Harness['consoleLines'] = [];
  const tasks: Promise<unknown>[] = [];
  let tick = 0;
  const tracing = createTracing({
    source: 'sarvam-tools',
    write: (events) => {
      if (options.failWrites) return Promise.reject(new TypeError('network'));
      written.push([...events]);
      return Promise.resolve();
    },
    waitUntil: (task) => {
      tasks.push(task);
    },
    baseLog: (level, event, fields) => {
      consoleLines.push([level, event, fields]);
    },
    // Each reading is 100 ms after the last, so durations are exact.
    clock: () => new Date(Date.UTC(2026, 10, 11, 5, 0, 0, (tick++) * TICK_MS)),
    acceptTraceHeader: options.acceptTraceHeader ?? false,
  });
  async function settle(): Promise<void> {
    await Promise.all(tasks);
  }
  return { tracing, written, consoleLines, settle };
}

function post(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`${URL_BASE}/sarvam-tools${path}`, { method: 'POST', headers });
}

function respond(status: number): () => Promise<Response> {
  return () => Promise.resolve(new Response(null, { status }));
}

Deno.test('tracing › a request writes its steps and a request event after the response', async () => {
  const h = harness();
  const handle = h.tracing.serve((_req) => {
    h.tracing.log('info', 'tool_call', { tool: 'get_dues', ms: 40 });
    return Promise.resolve(new Response('ok', { status: 200 }));
  });
  const response = await handle(post('/get_dues'));
  assertEquals(response.status, 200);
  await h.settle();
  const events = h.written.flat();
  assertEquals(events.map((event) => event.step), ['tool_call', 'request']);
  assertEquals(new Set(events.map((event) => event.trace_id)).size, 1);
  const request = events[1];
  assertEquals(request?.status, 'ok');
  assertEquals(request?.error_code, null);
  assertEquals(request?.duration_ms, 2 * TICK_MS);
  assertEquals(request?.detail, { method: 'POST', route: '/get_dues', http_status: 200 });
});

Deno.test('tracing › a 5xx is an error and a 4xx a warning, with the HTTP status as the code', async () => {
  for (const [httpStatus, status] of [[500, 'error'], [401, 'warn']] as const) {
    const h = harness();
    await h.tracing.serve(respond(httpStatus))(post('/x'));
    await h.settle();
    const request = h.written.flat()[0];
    assertEquals([request?.status, request?.error_code], [status, `HTTP ${httpStatus}`]);
  }
});

Deno.test('tracing › background work joins the trace and is written when it finishes', async () => {
  const h = harness();
  const gate = Promise.withResolvers<void>();
  const handle = h.tracing.serve((_req) => {
    h.tracing.defer(gate.promise.then(() => h.tracing.log('info', 'reply_sent', { ms: 5 })));
    return Promise.resolve(new Response('EVENT_RECEIVED'));
  });
  await handle(post('/'));
  gate.resolve();
  await h.settle();
  const events = h.written.flat();
  assertEquals(events.map((event) => event.step).sort(), ['reply_sent', 'request']);
  assertEquals(new Set(events.map((event) => event.trace_id)).size, 1);
});

Deno.test('tracing › a failed write is logged to the console and never fails the request', async () => {
  const h = harness({ failWrites: true });
  const response = await h.tracing.serve(respond(200))(post('/x'));
  await h.settle();
  assertEquals(response.status, 200);
  assertEquals(h.consoleLines, [[
    'error',
    'ops_events_write_failed',
    { error: 'TypeError', lost: 1 },
  ]]);
});

Deno.test('tracing › preflight requests are not traced', async () => {
  const h = harness();
  const request = new Request(`${URL_BASE}/sarvam-tools/x`, { method: 'OPTIONS' });
  await h.tracing.serve(respond(204))(request);
  await h.settle();
  assertEquals(h.written, []);
});

Deno.test('tracing › the caller trace id is used only where allowed, and only a UUID', async () => {
  async function traceIdFor(acceptTraceHeader: boolean, header: string): Promise<string> {
    const h = harness({ acceptTraceHeader });
    await h.tracing.serve(respond(200))(post('/sweep', { [TRACE_HEADER]: header }));
    await h.settle();
    return h.written.flat()[0]?.trace_id ?? '';
  }
  assertEquals(await traceIdFor(true, TRACE_ID), TRACE_ID);
  assertMatch(await traceIdFor(false, TRACE_ID), /^(?!22222222)[0-9a-f-]{36}$/);
  assertMatch(await traceIdFor(true, 'not-a-uuid'), /^[0-9a-f-]{36}$/);
});

Deno.test('tracing › routes drop the query string and hide signed tokens', () => {
  function at(path: string): string {
    return routeOf(new Request(`${URL_BASE}${path}`), 'calls-api');
  }
  assertEquals(at('/calls-api/v1/calls?token=secret'), '/v1/calls');
  assertEquals(at('/calls-api'), '/');
  assertEquals(
    at('/calls-api/v1/calls/33333333-3333-4333-8333-333333333333'),
    '/v1/calls/33333333-3333-4333-8333-333333333333',
  );
  assertEquals(at(`/calls-api/v1/link/${'a'.repeat(80)}`), '/v1/link/:token');
});
