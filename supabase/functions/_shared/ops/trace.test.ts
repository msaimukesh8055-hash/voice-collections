// supabase/functions/_shared/ops/trace.test.ts
import { assertEquals } from '@std/assert';
import {
  currentTrace,
  drainTrace,
  isTraceId,
  MAX_EVENTS_PER_TRACE,
  newTrace,
  type OpsStep,
  recordStep,
  runInTrace,
} from './trace.ts';

const STEP: OpsStep = {
  step: 'brain_llm',
  status: 'ok',
  error_code: null,
  provider: 'sarvam',
  duration_ms: 12,
  tokens_in: null,
  tokens_out: null,
  detail: {},
  created_at: '2026-11-11T05:00:00.000Z',
};

Deno.test('trace › there is no current trace outside a request', () => {
  assertEquals(currentTrace(), null);
});

Deno.test('trace › the current trace follows awaited and background work', async () => {
  const trace = newTrace('whatsapp-webhook');
  let background: Promise<string | null> = Promise.resolve(null);
  const inside = await runInTrace(trace, async () => {
    await Promise.resolve();
    background = new Promise((resolve) => setTimeout(() => resolve(currentTrace()?.id ?? null), 0));
    return currentTrace()?.id ?? null;
  });
  assertEquals(inside, trace.id);
  assertEquals(await background, trace.id);
  assertEquals(currentTrace(), null);
});

Deno.test('trace › two requests at once keep their own traces', async () => {
  const seen = await Promise.all(
    ['a', 'b'].map((source) =>
      runInTrace(newTrace(source), async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return currentTrace()?.source;
      })
    ),
  );
  assertEquals(seen, ['a', 'b']);
});

Deno.test('trace › a step gets the trace id and source; draining empties the trace', () => {
  const trace = newTrace('sarvam-tools', '11111111-1111-4111-8111-111111111111');
  assertEquals(recordStep(trace, STEP), true);
  const events = drainTrace(trace);
  assertEquals(events, [{ ...STEP, trace_id: trace.id, source: 'sarvam-tools' }]);
  assertEquals(drainTrace(trace), []);
});

Deno.test('trace › a full trace refuses further steps', () => {
  const trace = newTrace('followup-worker');
  for (let i = 0; i < MAX_EVENTS_PER_TRACE; i += 1) recordStep(trace, STEP);
  assertEquals(recordStep(trace, STEP), false);
  assertEquals(drainTrace(trace).length, MAX_EVENTS_PER_TRACE);
});

Deno.test('trace › only a UUID is accepted as an inherited trace id', () => {
  assertEquals(isTraceId('11111111-1111-4111-8111-111111111111'), true);
  assertEquals(isTraceId(null), false);
  assertEquals(isTraceId(''), false);
  assertEquals(isTraceId("x'; drop table ops_events; --"), false);
});
