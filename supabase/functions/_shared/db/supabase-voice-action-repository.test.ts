// supabase/functions/_shared/db/supabase-voice-action-repository.test.ts
// Checks the exact database requests and row mapping of Munshi's voice actions, with a fake
// fetch (no network). FAKE DATA ONLY.
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { createPostgrestClient } from './postgrest.ts';
import { createSupabaseVoiceActionRepository } from './supabase-voice-action-repository.ts';

const ENV = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const OWNER_ID = '0e000000-0000-4000-8000-000000000001';
const CALL_ID = 'ca000000-0000-4000-8000-0000000000b1';
const ACTION_ID = 'aa000000-0000-4000-8000-000000000001';
const SHOPKEEPER_ID = '5e000000-0000-4000-8000-000000000001';

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly prefer: string | undefined;
  readonly body: Record<string, unknown> | null;
}

interface FakeReply {
  readonly body?: unknown;
  readonly contentRange?: string;
}

function setup(...replies: FakeReply[]): {
  repo: ReturnType<typeof createSupabaseVoiceActionRepository>;
  requests: Recorded[];
} {
  const requests: Recorded[] = [];
  const queue = [...replies];
  function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const headers = init?.headers as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    requests.push({
      url: decodeURIComponent(String(input)),
      method: init?.method ?? 'GET',
      prefer: headers['Prefer'],
      body,
    });
    const reply = queue.shift() ?? {};
    const text = reply.body === undefined ? null : JSON.stringify(reply.body);
    const responseHeaders = reply.contentRange
      ? { 'content-range': reply.contentRange }
      : undefined;
    return Promise.resolve(new Response(text, { status: 200, headers: responseHeaders }));
  }
  const repo = createSupabaseVoiceActionRepository(createPostgrestClient(ENV, fakeFetch));
  return { repo, requests };
}

const ROW = {
  id: ACTION_ID,
  owner_id: OWNER_ID,
  owner_call_id: CALL_ID,
  kind: 'voice_credit',
  payload: { ref: 'r2', data: { shopkeeperId: SHOPKEEPER_ID, amount: 5000 } },
  status: 'open',
  created_at: '2026-11-02T06:30:00+00:00',
  expires_at: '2026-11-02T06:33:00+00:00',
};

Deno.test('voice actions › countVoiceActions counts this owner call only, with HEAD', async () => {
  const { repo, requests } = setup({ contentRange: '*/4' });

  const count = await repo.countVoiceActions(CALL_ID);

  assertEquals(count, 4);
  assertEquals(requests[0]?.method, 'HEAD');
  assertStringIncludes(requests[0]?.url ?? '', `owner_call_id=eq.${CALL_ID}`);
  assertEquals(requests[0]?.prefer, 'count=exact');
});

Deno.test('voice actions › countVoiceActions without a count fails loudly', async () => {
  const { repo } = setup({});

  await assertRejects(() => repo.countVoiceActions(CALL_ID), Error, 'no count');
});

Deno.test('voice actions › createVoiceAction stores ref + data in the payload and our times', async () => {
  const { repo, requests } = setup({ body: [{ id: ACTION_ID }] });

  const id = await repo.createVoiceAction({
    ownerId: OWNER_ID,
    ownerCallId: CALL_ID,
    kind: 'voice_remind',
    ref: 'r1',
    data: { shopkeeperId: SHOPKEEPER_ID },
    createdAt: '2026-11-02T06:30:00.000Z',
    expiresAt: '2026-11-02T06:33:00.000Z',
  });

  assertEquals(id, ACTION_ID);
  assertEquals(requests[0]?.method, 'POST');
  assertEquals(requests[0]?.body, {
    owner_id: OWNER_ID,
    owner_call_id: CALL_ID,
    kind: 'voice_remind',
    payload: { ref: 'r1', data: { shopkeeperId: SHOPKEEPER_ID } },
    created_at: '2026-11-02T06:30:00.000Z',
    expires_at: '2026-11-02T06:33:00.000Z',
  });
});

Deno.test('voice actions › createVoiceAction with no row back fails loudly', async () => {
  const { repo } = setup({ body: [] });

  await assertRejects(
    () =>
      repo.createVoiceAction({
        ownerId: OWNER_ID,
        ownerCallId: CALL_ID,
        kind: 'voice_remind',
        ref: 'r1',
        data: {},
        createdAt: '2026-11-02T06:30:00.000Z',
        expiresAt: '2026-11-02T06:33:00.000Z',
      }),
    Error,
    'no row',
  );
});

Deno.test('voice actions › cancelOpenVoiceActions closes only older open actions of this call', async () => {
  const { repo, requests } = setup({ body: [{ id: ACTION_ID }, { id: CALL_ID }] });

  const count = await repo.cancelOpenVoiceActions(CALL_ID, '2026-11-02T06:30:00.000Z');

  assertEquals(count, 2);
  const url = requests[0]?.url ?? '';
  assertEquals(requests[0]?.method, 'PATCH');
  assertStringIncludes(url, `owner_call_id=eq.${CALL_ID}`);
  assertStringIncludes(url, 'status=eq.open');
  assertStringIncludes(url, 'created_at=lt.2026-11-02T06:30:00.000Z');
  assertEquals(requests[0]?.body?.['status'], 'cancelled');
});

Deno.test('voice actions › latestVoiceActions reads the newest two of this call and maps them', async () => {
  const { repo, requests } = setup({ body: [ROW] });

  const [action] = await repo.latestVoiceActions(CALL_ID);

  assertEquals(action, {
    id: ACTION_ID,
    ownerId: OWNER_ID,
    ownerCallId: CALL_ID,
    kind: 'voice_credit',
    ref: 'r2',
    data: { shopkeeperId: SHOPKEEPER_ID, amount: 5000 },
    status: 'open',
    createdAt: '2026-11-02T06:30:00+00:00',
    expiresAt: '2026-11-02T06:33:00+00:00',
  });
  assertStringIncludes(requests[0]?.url ?? '', 'order=created_at.desc,id.desc&limit=2');
});

Deno.test('voice actions › latestVoiceActions is empty when the call has none', async () => {
  const { repo } = setup({ body: [] });

  assertEquals(await repo.latestVoiceActions(CALL_ID), []);
});

Deno.test('voice actions › getVoiceAction only finds voice actions (owner call set)', async () => {
  const { repo, requests } = setup({ body: [ROW] });

  const action = await repo.getVoiceAction(ACTION_ID);

  assertEquals(action?.ref, 'r2');
  assertStringIncludes(requests[0]?.url ?? '', `id=eq.${ACTION_ID}`);
  assertStringIncludes(requests[0]?.url ?? '', 'owner_call_id=not.is.null');
});

Deno.test('voice actions › a row with a WhatsApp kind or no ref is refused, not trusted', async () => {
  const { repo } = setup({ body: [{ ...ROW, kind: 'entry' }] }, {
    body: [{ ...ROW, payload: { data: {} } }],
  });

  await assertRejects(() => repo.getVoiceAction(ACTION_ID));
  await assertRejects(() => repo.getVoiceAction(ACTION_ID));
});

Deno.test('voice actions › transitionVoiceAction is a compare-and-set on the status', async () => {
  const { repo, requests } = setup({ body: [{ id: ACTION_ID }] }, { body: [] });

  const first = await repo.transitionVoiceAction(ACTION_ID, 'open', 'saved');
  const second = await repo.transitionVoiceAction(ACTION_ID, 'open', 'saved');

  assertEquals([first, second], [true, false]);
  assertStringIncludes(requests[0]?.url ?? '', `id=eq.${ACTION_ID}&status=eq.open`);
  assertEquals(requests[0]?.body?.['status'], 'saved');
});
