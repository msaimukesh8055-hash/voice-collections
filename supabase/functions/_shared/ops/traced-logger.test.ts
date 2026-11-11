// supabase/functions/_shared/ops/traced-logger.test.ts
import { assertEquals } from '@std/assert';
import type { LogFields, LogLevel } from '../log.ts';
import { drainTrace, newTrace, runInTrace } from './trace.ts';
import { createTracedLogger, MAX_ERROR_CODE_LENGTH, toOpsStep } from './traced-logger.ts';

const NOW = new Date('2026-11-11T05:00:00.000Z');
type Line = [LogLevel, string, LogFields | undefined];

function capture(): { lines: Line[]; log: ReturnType<typeof createTracedLogger> } {
  const lines: Line[] = [];
  const log = createTracedLogger((level, event, fields) => {
    lines.push([level, event, fields]);
  }, () => NOW);
  return { lines, log };
}

Deno.test('traced logger › outside a request it is the plain logger', () => {
  const { lines, log } = capture();
  log('info', 'startup', { ok: true });
  assertEquals(lines, [['info', 'startup', { ok: true }]]);
});

Deno.test('traced logger › inside a request the line carries the trace id and becomes a step', () => {
  const { lines, log } = capture();
  const trace = newTrace('whatsapp-webhook', '11111111-1111-4111-8111-111111111111');
  runInTrace(
    trace,
    () => log('info', 'brain_llm', { provider: 'sarvam', outcome: 'ok', ms: 412.6 }),
  );
  assertEquals(lines, [[
    'info',
    'brain_llm',
    { provider: 'sarvam', outcome: 'ok', ms: 412.6, trace_id: trace.id },
  ]]);
  assertEquals(drainTrace(trace), [{
    trace_id: trace.id,
    source: 'whatsapp-webhook',
    step: 'brain_llm',
    status: 'ok',
    error_code: null,
    provider: 'sarvam',
    duration_ms: 413,
    tokens_in: null,
    tokens_out: null,
    detail: { provider: 'sarvam', outcome: 'ok', ms: 412.6 },
    created_at: NOW.toISOString(),
  }]);
});

Deno.test('traced logger › a rejected LLM answer keeps its label as the error code', () => {
  const step = toOpsStep({
    level: 'warn',
    event: 'brain_llm',
    fields: { provider: 'sarvam', outcome: 'bad_json', ms: 300 },
  }, NOW);
  assertEquals([step.status, step.error_code, step.provider], ['warn', 'bad_json', 'sarvam']);
});

Deno.test('traced logger › token counts are kept; an "ok" line never has an error code', () => {
  const step = toOpsStep({
    level: 'info',
    event: 'llm_usage',
    fields: { provider: 'sarvam', tokens_in: 812, tokens_out: 44, outcome: 'ok' },
  }, NOW);
  assertEquals([step.tokens_in, step.tokens_out, step.error_code], [812, 44, null]);
});

Deno.test('traced logger › error code: "code" wins, then "outcome", then "error"; cut when long', () => {
  const at = (fields: LogFields): string | null =>
    toOpsStep({ level: 'error', event: 'x', fields }, NOW).error_code;
  assertEquals(at({ error: 'TypeError', outcome: 'HTTP 503', code: '23505' }), '23505');
  assertEquals(at({ error: 'TypeError', outcome: 'HTTP 503' }), 'HTTP 503');
  assertEquals(at({ error: 'TypeError' }), 'TypeError');
  assertEquals(at({ ok: false, status: 500 }), null);
  assertEquals(at({ error: 'x'.repeat(500) })?.length, MAX_ERROR_CODE_LENGTH);
});

Deno.test('traced logger › a timing that is not a finite number is left out', () => {
  const step = toOpsStep({ level: 'info', event: 'x', fields: { ms: Number.NaN } }, NOW);
  assertEquals(step.duration_ms, null);
});
