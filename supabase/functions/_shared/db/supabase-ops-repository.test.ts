// supabase/functions/_shared/db/supabase-ops-repository.test.ts
// The ops reads against a fake database HTTP API: the exact calls made, and the database's JSON
// mapped to the page's shape (a drift fails here, loudly).
import { assertEquals, assertRejects } from '@std/assert';
import { type PostgrestRequest, RepositoryError, UNIQUE_VIOLATION } from './postgrest.ts';
import { createSupabaseOpsRepository } from './supabase-ops-repository.ts';

const TRACE_ID = '55555555-5555-4555-8555-555555555555';

const SUMMARY_JSON = {
  windows: { day: { requests: 40, failed: 2 }, week: { requests: 300, failed: 5 } },
  sources: [{ source: 'sarvam-tools', requests: 12, failed: 0, p95_ms: 180 }],
  tools: [{ agent: 'asha', tool: 'get_dues', calls: 9, p50_ms: 120, p95_ms: 310 }],
  llm: [{ provider: 'sarvam', answers: 20, rejected: 3, failed: 1 }],
  tokens: [{ provider: 'sarvam', today_in: 100, today_out: 10, month_in: 1000, month_out: 90 }],
  paths: { command: 14, sarvam: 5, gemini: 1 },
  followups: { waiting: 1, stuck: 0, failed_week: 2 },
  spend: {
    today: { live_minutes: 2, simulated_calls: 3 },
    month: { live_minutes: 10, simulated_calls: 12 },
  },
  recent_errors: [{
    trace_id: TRACE_ID,
    source: 'whatsapp-webhook',
    step: 'unhandled_error',
    error_code: 'RepositoryError: x failed (HTTP 500)',
    created_at: '2026-11-11T05:00:00+00:00',
  }],
};

type Call = [string, string, PostgrestRequest | undefined];

function fakeQuery(rows: unknown): {
  query: Parameters<typeof createSupabaseOpsRepository>[0];
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    query: (operation, path, request) => {
      calls.push([operation, path, request]);
      return Promise.resolve({ rows, contentRange: null });
    },
  };
}

Deno.test('ops repository › the summary is one database function call, mapped to the page shape', async () => {
  const { query, calls } = fakeQuery(SUMMARY_JSON);
  const summary = await createSupabaseOpsRepository(query).getSummary();
  assertEquals(calls, [['getOpsSummary', 'rpc/ops_summary', { method: 'POST', body: {} }]]);
  assertEquals(summary, {
    day: { requests: 40, failed: 2 },
    week: { requests: 300, failed: 5 },
    sources: [{ source: 'sarvam-tools', requests: 12, failed: 0, p95Ms: 180 }],
    tools: [{ agent: 'asha', tool: 'get_dues', calls: 9, p50Ms: 120, p95Ms: 310 }],
    llm: [{ provider: 'sarvam', answers: 20, rejected: 3, failed: 1 }],
    tokens: [{
      provider: 'sarvam',
      today: { input: 100, output: 10 },
      month: { input: 1000, output: 90 },
    }],
    paths: { command: 14, sarvam: 5, gemini: 1 },
    followups: { waiting: 1, stuck: 0, failedWeek: 2 },
    voice: {
      today: { liveMinutes: 2, simulatedCalls: 3 },
      month: { liveMinutes: 10, simulatedCalls: 12 },
    },
    recentErrors: [{
      traceId: TRACE_ID,
      source: 'whatsapp-webhook',
      step: 'unhandled_error',
      errorCode: 'RepositoryError: x failed (HTTP 500)',
      createdAt: '2026-11-11T05:00:00+00:00',
    }],
  });
});

Deno.test('ops repository › counts that arrive as numeric strings are read as numbers', async () => {
  const spend = {
    today: { live_minutes: '2', simulated_calls: 3 },
    month: { live_minutes: '10', simulated_calls: 12 },
  };
  const { query } = fakeQuery({ ...SUMMARY_JSON, spend });
  const summary = await createSupabaseOpsRepository(query).getSummary();
  assertEquals(summary.voice.month.liveMinutes, 10);
});

Deno.test('ops repository › a summary that does not match the expected shape fails loudly', async () => {
  const { query } = fakeQuery({ ...SUMMARY_JSON, windows: null });
  await assertRejects(() => createSupabaseOpsRepository(query).getSummary());
});

Deno.test('ops repository › a trace is read oldest first, capped, by its id only', async () => {
  const row = {
    source: 'sarvam-tools',
    step: 'request',
    status: 'ok',
    error_code: null,
    provider: null,
    duration_ms: 40,
    tokens_in: null,
    tokens_out: null,
    detail: { route: '/get_dues' },
    created_at: '2026-11-11T05:00:00+00:00',
  };
  const { query, calls } = fakeQuery([row]);
  const steps = await createSupabaseOpsRepository(query).listTraceSteps(TRACE_ID);
  assertEquals(
    calls[0]?.[1],
    'ops_events?select=source,step,status,error_code,provider,duration_ms,tokens_in,tokens_out,' +
      `detail,created_at&trace_id=eq.${TRACE_ID}&order=created_at.asc&limit=400`,
  );
  assertEquals(steps, [{
    source: 'sarvam-tools',
    step: 'request',
    status: 'ok',
    errorCode: null,
    provider: null,
    durationMs: 40,
    tokensIn: null,
    tokensOut: null,
    detail: { route: '/get_dues' },
    createdAt: '2026-11-11T05:00:00+00:00',
  }]);
});

Deno.test('ops repository › recent errors: error steps only, since a time, newest first, capped', async () => {
  const row = SUMMARY_JSON.recent_errors[0];
  const { query, calls } = fakeQuery([row]);
  const since = '2026-11-11T04:52:00.000Z';
  const errors = await createSupabaseOpsRepository(query).listErrorsSince(since);
  assertEquals(
    calls[0]?.[1],
    'ops_events?select=trace_id,source,step,error_code,created_at&status=eq.error' +
      '&created_at=gte.2026-11-11T04%3A52%3A00.000Z&order=created_at.desc&limit=200',
  );
  assertEquals(errors[0]?.traceId, TRACE_ID);
});

Deno.test('ops repository › an alert claim is one insert; a second claim of the window is false', async () => {
  const claim = {
    key: 'sarvam-tools|request|HTTP 500',
    window: 1958960,
    count: 3,
    traceId: TRACE_ID,
  };
  const { query, calls } = fakeQuery(null);
  assertEquals(await createSupabaseOpsRepository(query).claimAlert(claim), true);
  assertEquals(calls[0], ['claimOpsAlert', 'ops_alerts', {
    method: 'POST',
    body: {
      alert_key: claim.key,
      alert_window: claim.window,
      error_count: 3,
      trace_id: TRACE_ID,
    },
    prefer: 'return=minimal',
  }]);
  const taken = createSupabaseOpsRepository(() =>
    Promise.reject(new RepositoryError('claimOpsAlert', UNIQUE_VIOLATION))
  );
  assertEquals(await taken.claimAlert(claim), false);
  const broken = createSupabaseOpsRepository(() =>
    Promise.reject(new RepositoryError('claimOpsAlert', 'HTTP 500'))
  );
  await assertRejects(() => broken.claimAlert(claim), RepositoryError);
});
