// supabase/functions/_shared/llm/langfuse.test.ts
// Langfuse tracing with fake keys and a fake fetch: off without keys, one OpenTelemetry span per
// call keyed by our trace id, masking when REDACT is on, and a failed send is a warning only.
import { assertEquals, assertExists } from '@std/assert';
import type { LogFields } from '../log.ts';
import {
  createLangfuseObserver,
  type Generation,
  LANGFUSE_DEFAULT_HOST,
  type LangfuseDeps,
  type LangfuseEnv,
  langfuseSettings,
  langfuseTraceLink,
  otelTraceId,
  otlpPayload,
  redactText,
} from './langfuse.ts';

const ENV: LangfuseEnv = {
  LANGFUSE_PUBLIC_KEY: 'pk-lf-fake',
  LANGFUSE_SECRET_KEY: 'sk-lf-fake',
  LANGFUSE_HOST: 'https://langfuse.test/',
  LANGFUSE_REDACT: null,
};

const GENERATION: Generation = {
  name: 'brain_llm',
  provider: 'sarvam',
  model: 'sarvam-105b',
  promptVersion: 'v3',
  system: 'You read the owner’s message. Today is 2026-11-23.',
  messages: [{ role: 'user', content: 'Ramesh paid 5000, call him on 98765 43210' }],
  output: '{"intent":"mark_paid","name":"Ramesh","amount":5000}',
  error: null,
  tokensIn: 1000,
  tokensOut: 20,
  startedAt: new Date('2026-11-23T10:00:00.000Z'),
  endedAt: new Date('2026-11-23T10:00:00.400Z'),
};

const TRACE = '9fe11f9b-ec4f-4205-a9c7-cddccff15ebf';
const TRACE_HEX = '9fe11f9bec4f4205a9c7cddccff15ebf';

interface Seen {
  readonly sent: Array<{ url: string; init: RequestInit | undefined }>;
  readonly logs: Array<[string, LogFields | undefined]>;
  readonly tasks: Promise<unknown>[];
}

function deps(fetchImpl: typeof fetch, traceId: string | null = TRACE): [LangfuseDeps, Seen] {
  const seen: Seen = { sent: [], logs: [], tasks: [] };
  let next = 0;
  return [{
    fetchImpl: (input, init) => {
      seen.sent.push({ url: String(input), init });
      return fetchImpl(input, init);
    },
    defer: (task) => seen.tasks.push(task),
    log: (_level, event, fields) => seen.logs.push([event, fields]),
    traceId: () => traceId,
    newId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
  }, seen];
}

const accepted: typeof fetch = () => Promise.resolve(new Response('{}', { status: 200 }));

function fail(): never {
  throw new Error('settings expected');
}

type Attr = { key: string; value: { stringValue: string } };
interface Span {
  traceId: string;
  spanId: string;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Attr[];
  status: { code: number; message?: string };
}

function spanOf(payload: unknown): Span {
  const resources = (payload as Record<string, unknown>)['resourceSpans'] as Array<
    { scopeSpans: Array<{ spans: Span[] }> }
  >;
  const span = resources[0]?.scopeSpans[0]?.spans[0];
  assertExists(span);
  return span;
}

function attr(span: Span, key: string): string | undefined {
  return span.attributes.find((one) => one.key === key)?.value.stringValue;
}

function sentSpan(seen: Seen): Span {
  return spanOf(JSON.parse(String(seen.sent[0]?.init?.body)));
}

const IDS = { traceId: TRACE, spanId: '00000000-0000-4000-8000-000000000001' };

Deno.test('langfuse › off unless both keys are set; host defaults to Langfuse Cloud', () => {
  assertEquals(langfuseSettings({ ...ENV, LANGFUSE_SECRET_KEY: null }), null);
  assertEquals(langfuseSettings({ ...ENV, LANGFUSE_PUBLIC_KEY: null }), null);
  const [off] = deps(accepted);
  assertEquals(createLangfuseObserver({ ...ENV, LANGFUSE_PUBLIC_KEY: null }, off), undefined);
  assertEquals(langfuseSettings({ ...ENV, LANGFUSE_HOST: null })?.host, LANGFUSE_DEFAULT_HOST);
  assertEquals(langfuseSettings(ENV)?.redact, false);
  assertEquals(langfuseSettings({ ...ENV, LANGFUSE_REDACT: 'ON' })?.redact, true);
});

Deno.test('langfuse › one call is one OpenTelemetry span on our trace id, sent in the background', async () => {
  const [d, seen] = deps(accepted);
  const observe = createLangfuseObserver(ENV, d);
  assertExists(observe);
  observe(GENERATION);
  assertEquals(seen.sent.length, 1);
  await Promise.all(seen.tasks);
  const { url, init } = seen.sent[0] ?? { url: '', init: undefined };
  assertEquals(url, 'https://langfuse.test/api/public/otel/v1/traces');
  const headers = init?.headers as Record<string, string>;
  assertEquals(headers['Authorization'], `Basic ${btoa('pk-lf-fake:sk-lf-fake')}`);
  assertEquals(headers['x-langfuse-ingestion-version'], '4');
  const span = sentSpan(seen);
  assertEquals([span.traceId, span.spanId.length, span.name], [TRACE_HEX, 16, 'brain_llm']);
  assertEquals(
    [span.startTimeUnixNano, span.endTimeUnixNano],
    [`${GENERATION.startedAt.getTime()}000000`, `${GENERATION.endedAt.getTime()}000000`],
  );
  assertEquals(attr(span, 'langfuse.trace.metadata.ops_trace_id'), TRACE);
  assertEquals(
    ['type', 'model.name', 'level', 'output'].map((k) => attr(span, `langfuse.observation.${k}`)),
    ['generation', 'sarvam-105b', 'DEFAULT', GENERATION.output ?? undefined],
  );
  assertEquals(attr(span, 'langfuse.observation.usage_details'), '{"input":1000,"output":20}');
  assertEquals(attr(span, 'langfuse.version'), 'v3');
  assertEquals(attr(span, 'langfuse.observation.metadata.provider'), 'sarvam');
  assertEquals(attr(span, 'langfuse.observation.metadata.redacted'), 'false');
  assertEquals(Number(attr(span, 'langfuse.observation.metadata.cost_inr')) > 0, true);
  const input = JSON.parse(attr(span, 'langfuse.observation.input') ?? '[]') as unknown[];
  assertEquals(input.length, 2);
  assertEquals(seen.logs, []);
});

Deno.test('langfuse › trace ids: a UUID loses its dashes; anything else gets a new trace', async () => {
  assertEquals(otelTraceId(TRACE), TRACE_HEX);
  assertEquals(otelTraceId('trace-1'), null);
  for (const ours of [null, 'not-a-uuid']) {
    const [d, seen] = deps(accepted, ours);
    createLangfuseObserver(ENV, d)?.(GENERATION);
    await Promise.all(seen.tasks);
    assertEquals(sentSpan(seen).traceId, '00000000000040008000000000000001');
  }
});

Deno.test('langfuse › REDACT masks names, phone numbers and amounts, and leaves the system prompt out', () => {
  const settings = langfuseSettings({ ...ENV, LANGFUSE_REDACT: 'on' }) ?? fail();
  const span = spanOf(otlpPayload(settings, GENERATION, IDS));
  const input = JSON.parse(attr(span, 'langfuse.observation.input') ?? '[]') as Array<{
    role: string;
    content: string;
  }>;
  assertEquals(
    input[0]?.content,
    `[system prompt left out: ${GENERATION.system.length} characters]`,
  );
  assertEquals(input[1]?.content, '[name] paid #, call him on #');
  assertEquals(
    attr(span, 'langfuse.observation.output'),
    '{"intent":"mark_paid","name":"[name]","amount":#}',
  );
  assertEquals(attr(span, 'langfuse.observation.metadata.redacted'), 'true');
  const text = JSON.stringify(span);
  for (const secret of ['Ramesh', '5000', '98765', '43210', 'Today is']) {
    assertEquals(text.includes(secret), false, secret);
  }
});

Deno.test('langfuse › redactText keeps the other words; it would rather mask too much', () => {
  assertEquals(redactText('add ₹12,500 credit for Lakshmi'), 'add ₹# credit for [name]');
  assertEquals(
    redactText('Suresh Stores owes 3000. Remind him'),
    '[name] [name] owes #. [name] him',
  );
});

Deno.test('langfuse › a failed call is an ERROR generation with the error class only', () => {
  const failed = {
    ...GENERATION,
    output: null,
    error: 'TimeoutError',
    tokensIn: null,
    tokensOut: null,
  };
  const span = spanOf(otlpPayload(langfuseSettings(ENV) ?? fail(), failed, IDS));
  assertEquals(span.status, { code: 2, message: 'TimeoutError' });
  assertEquals(
    ['level', 'status_message', 'output', 'usage_details', 'metadata.cost_inr'].map((k) =>
      attr(span, `langfuse.observation.${k}`)
    ),
    ['ERROR', 'TimeoutError', undefined, undefined, undefined],
  );
});

Deno.test('langfuse › a failed send is one warning, never an error or a throw', async () => {
  const down: typeof fetch = () => Promise.reject(new TypeError('network'));
  const refused: typeof fetch = () => Promise.resolve(new Response('no', { status: 410 }));
  for (
    const [fetchImpl, fields] of [[down, { error: 'TypeError' }], [refused, {
      status: 410,
    }]] as const
  ) {
    const [d, seen] = deps(fetchImpl);
    createLangfuseObserver(ENV, d)?.(GENERATION);
    await Promise.all(seen.tasks);
    assertEquals(seen.logs, [['langfuse_send_failed', fields]]);
  }
});

Deno.test('langfuse › trace link: our id without dashes, under the project; off without both', () => {
  const link = langfuseTraceLink({ ...ENV, LANGFUSE_PROJECT_ID: 'proj_1' });
  assertEquals(
    link?.(TRACE),
    'https://langfuse.test/project/proj_1/traces/9fe11f9bec4f4205a9c7cddccff15ebf',
  );
  assertEquals(link?.('not-a-trace-id'), null);
  assertEquals(langfuseTraceLink(ENV), null);
  assertEquals(
    langfuseTraceLink({ ...ENV, LANGFUSE_PUBLIC_KEY: null, LANGFUSE_PROJECT_ID: 'p' }),
    null,
  );
});
