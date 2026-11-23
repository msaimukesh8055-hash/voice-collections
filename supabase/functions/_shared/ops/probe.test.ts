// supabase/functions/_shared/ops/probe.test.ts
// The health probe: what it records for an answer, an error status and no answer at all.
import { assertEquals } from '@std/assert';
import type { LogFields } from '../log.ts';
import { type HealthCheck, healthUrlOf, type ProbeDeps, runHealthProbe } from './probe.ts';

interface Seen {
  readonly checks: HealthCheck[];
  readonly logs: Array<[string, LogFields | undefined]>;
  readonly requests: Array<{ url: string; headers: Record<string, string> }>;
}

function probeDeps(fetchImpl: typeof fetch, anonKey: string | null = 'anon'): [ProbeDeps, Seen] {
  const seen: Seen = { checks: [], logs: [], requests: [] };
  let clock = 1_000;
  const deps: ProbeDeps = {
    healthUrl: healthUrlOf('https://ref.supabase.co/'),
    anonKey,
    fetchImpl: (input, init) => {
      seen.requests.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      clock += 120;
      return fetchImpl(input, init);
    },
    now: () => clock,
    record: (check) => {
      seen.checks.push(check);
      return Promise.resolve();
    },
    log: (_level, event, fields) => seen.logs.push([event, fields]),
  };
  return [deps, seen];
}

function answer(status: number, body: unknown): typeof fetch {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

Deno.test('probe › a 200 is up: status, time, database and version are recorded', async () => {
  const body = { status: 'ok', checks: { database: 'ok' }, version: 'abc123' };
  const [deps, seen] = probeDeps(answer(200, body));
  const check = await runHealthProbe(deps);
  assertEquals(check, {
    ok: true,
    statusCode: 200,
    durationMs: 120,
    database: 'ok',
    version: 'abc123',
    errorCode: null,
  });
  assertEquals(seen.checks, [check]);
  assertEquals(seen.logs, []);
  assertEquals(seen.requests[0]?.url, 'https://ref.supabase.co/functions/v1/calls-api/v1/health');
  assertEquals(seen.requests[0]?.headers, { Authorization: 'Bearer anon', apikey: 'anon' });
});

Deno.test('probe › a 503 (database unreachable) is down and logged as an error', async () => {
  const [deps, seen] = probeDeps(answer(503, { checks: { database: 'fail' }, version: 'v' }));
  const check = await runHealthProbe(deps);
  assertEquals([check.ok, check.statusCode, check.database], [false, 503, 'fail']);
  assertEquals(seen.logs, [['health_probe_failed', {
    status: 503,
    error: null,
    database: 'fail',
  }]]);
});

Deno.test('probe › no answer is down, with the error class only', async () => {
  const timeout = () => Promise.reject(new DOMException('slow', 'TimeoutError'));
  const [deps, seen] = probeDeps(timeout, null);
  const check = await runHealthProbe(deps);
  assertEquals(check, {
    ok: false,
    statusCode: null,
    durationMs: 120,
    database: null,
    version: null,
    errorCode: 'TimeoutError',
  });
  assertEquals(seen.requests[0]?.headers, {});
  assertEquals(seen.checks.length, 1);
});

Deno.test('probe › an answer that is not JSON is still recorded by its status', async () => {
  const html: typeof fetch = () => Promise.resolve(new Response('<html>', { status: 401 }));
  const [deps] = probeDeps(html);
  const check = await runHealthProbe(deps);
  assertEquals([check.ok, check.statusCode, check.database, check.version], [
    false,
    401,
    null,
    null,
  ]);
});
