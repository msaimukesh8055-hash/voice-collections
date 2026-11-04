// supabase/functions/_shared/db/supabase-dashboard-repository.test.ts
// Dashboard reads (M6): request paths, mapping, caps, and the call token never leaving.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { createPostgrestClient } from './postgrest.ts';
import { createSupabaseDashboardRepository } from './supabase-dashboard-repository.ts';

const CALL_ID = 'c0000000-0000-4000-8000-000000000001';
const SHOPKEEPER_ID = 'b0000000-0000-4000-8000-000000000001';
const OWNER_ID = '0e000000-0000-4000-8000-000000000001';

const CALL = {
  id: CALL_ID,
  shopkeeper_id: SHOPKEEPER_ID,
  mode: 'live',
  status: 'completed',
  language: 'te',
  tone_level: 2,
  queued_at: '2026-11-04T10:00:00Z',
  ended_at: '2026-11-04T10:03:00Z',
  duration_seconds: 170,
  summary: 'Promised Monday',
};

interface Seen {
  url: string;
  method: string;
  body: unknown;
}

function setup(
  ...bodies: unknown[]
): { repo: ReturnType<typeof createSupabaseDashboardRepository>; seen: Seen[] } {
  const seen: Seen[] = [];
  const queue = [...bodies];
  function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    seen.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const body = queue.shift();
    return Promise.resolve(
      body === undefined ? new Response(null, { status: 204 }) : Response.json(body),
    );
  }
  const query = createPostgrestClient({
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
  }, fakeFetch);
  return { repo: createSupabaseDashboardRepository(query), seen };
}

Deno.test('dashboard repo › calls newest first, capped, optionally for one shopkeeper', async () => {
  const { repo, seen } = setup([CALL], [CALL]);
  const calls = await repo.listCalls({ limit: 10 });
  assertEquals(calls[0], {
    id: CALL_ID,
    shopkeeperId: SHOPKEEPER_ID,
    mode: 'live',
    status: 'completed',
    language: 'te',
    toneLevel: 2,
    queuedAt: CALL.queued_at,
    endedAt: CALL.ended_at,
    durationSeconds: 170,
    summary: 'Promised Monday',
  });
  assertStringIncludes(seen[0]?.url ?? '', 'order=queued_at.desc&limit=10');
  await repo.listCalls({ limit: 5, shopkeeperId: SHOPKEEPER_ID });
  assertStringIncludes(seen[1]?.url ?? '', `shopkeeper_id=eq.${SHOPKEEPER_ID}`);
});

Deno.test('dashboard repo › one call: transcript, tool calls without the token, follow-up', async () => {
  const { repo } = setup(
    [{ ...CALL, transcript: [{ role: 'assistant', content: 'Namaste' }] }],
    [{
      tool: 'get_dues',
      args: { call_token: CALL_ID, x: 1 },
      result: { ok: true },
      duration_ms: 120,
      created_at: CALL.queued_at,
    }],
    [{ path: 'rule', decision: 'check_promise', reasoning: 'Promise logged' }],
  );
  const call = await repo.getCall(CALL_ID);
  assertEquals(call?.transcript, [{ role: 'assistant', content: 'Namaste' }]);
  assertEquals(call?.toolEvents[0]?.args, { x: 1 });
  assert(!JSON.stringify(call).includes(`"call_token"`));
  assertEquals(call?.followup, {
    path: 'rule',
    decision: 'check_promise',
    reasoning: 'Promise logged',
  });
});

Deno.test('dashboard repo › unknown call → null; bad transcript or args → safe defaults', async () => {
  assertEquals(await setup([], [], []).repo.getCall(CALL_ID), null);
  const { repo } = setup(
    [{ ...CALL, transcript: 'garbage' }],
    [{ tool: 't', args: 'x', result: null, duration_ms: null, created_at: 'n' }],
    [],
  );
  const call = await repo.getCall(CALL_ID);
  assertEquals([call?.transcript, call?.toolEvents[0]?.args, call?.followup], [null, {}, null]);
});

Deno.test('dashboard repo › promises, notes and the English-under-Telugu switch', async () => {
  const { repo, seen } = setup(
    [{ amount: '3000.00', promise_date: '2026-10-30', status: 'broken', created_at: 'c' }],
    [{ note: 'Busy shop', created_at: 'd' }],
  );
  assertEquals(await repo.listPromises(SHOPKEEPER_ID), [
    { amount: 3000, promiseDate: '2026-10-30', status: 'broken', createdAt: 'c' },
  ]);
  assertEquals(await repo.listNotes(SHOPKEEPER_ID, 5), [{ note: 'Busy shop', createdAt: 'd' }]);
  assertStringIncludes(seen[1]?.url ?? '', 'limit=5');
  await repo.setEnglishUnderTelugu(OWNER_ID, false);
  assertEquals([seen[2]?.method, seen[2]?.body], ['PATCH', { english_under_telugu: false }]);
  assertStringIncludes(seen[2]?.url ?? '', `owners?id=eq.${OWNER_ID}`);
});
