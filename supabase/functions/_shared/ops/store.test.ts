// supabase/functions/_shared/ops/store.test.ts
import { assertEquals } from '@std/assert';
import type { PostgrestRequest } from '../db/postgrest.ts';
import { createOpsEventWriter } from './store.ts';
import type { OpsEvent } from './trace.ts';

const EVENT: OpsEvent = {
  trace_id: '11111111-1111-4111-8111-111111111111',
  source: 'sarvam-tools',
  step: 'request',
  status: 'ok',
  error_code: null,
  provider: null,
  duration_ms: 40,
  tokens_in: null,
  tokens_out: null,
  detail: { method: 'POST', route: '/get_dues', http_status: 200 },
  created_at: '2026-11-11T05:00:00.000Z',
};

Deno.test('ops store › all events of a request go in one insert, nothing read back', async () => {
  const calls: [string, string, PostgrestRequest | undefined][] = [];
  const write = createOpsEventWriter((operation, path, request) => {
    calls.push([operation, path, request]);
    return Promise.resolve({ rows: null, contentRange: null });
  });
  await write([EVENT, EVENT]);
  assertEquals(calls, [[
    'write_ops_events',
    'ops_events',
    { method: 'POST', body: [EVENT, EVENT], prefer: 'return=minimal' },
  ]]);
});
