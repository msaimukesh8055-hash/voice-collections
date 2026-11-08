// supabase/functions/sarvam-tools/handler.test.ts
import { assert, assertEquals } from '@std/assert';
import {
  createFakeRepository,
  FAKE_LATHA,
  FAKE_NOW,
  type FakeCall,
  fakeCall,
  type FakeState,
} from '../_shared/db/fake-repository.ts';
import { FAKE_OWNER_CALL_ID } from '../_shared/db/fake-owner-call-repository.ts';
import type { Repository } from '../_shared/db/repository.ts';
import type { LogFields, Logger } from '../_shared/log.ts';
import { AUDIT_MARKERS } from '../_shared/tools/registry.ts';
import { CALL_TOKEN_TTL_MS, handleToolRequest, type ToolsDeps } from './handler.ts';

const SECRET = 's'.repeat(40);
const BASE = 'https://ref.supabase.co/functions/v1/sarvam-tools';
const CALL = fakeCall({ status: 'in_progress', urlIssuedAt: '2026-11-02T06:29:05.000Z' });

interface Setup {
  readonly deps: ToolsDeps;
  readonly state: FakeState;
  readonly logs: Array<{ event: string; fields: LogFields }>;
}

function setup(
  call: Partial<FakeCall> = {},
  overrides: { state?: Partial<FakeState>; repo?: Partial<Repository> } = {},
): Setup {
  const fake = createFakeRepository({ calls: [{ ...CALL, ...call }], ...overrides.state });
  const logs: Array<{ event: string; fields: LogFields }> = [];
  const log: Logger = (_level, event, fields = {}) => logs.push({ event, fields });
  const repo = { ...fake.repo, ...overrides.repo };
  return { deps: { repo, secret: SECRET, clock: () => FAKE_NOW, log }, state: fake.state, logs };
}

function toolRequest(
  tool: string,
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` },
): Request {
  return new Request(`${BASE}/${tool}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function reply(response: Response): Promise<Record<string, unknown>> {
  assertEquals(response.status, 200);
  return (await response.json()) as Record<string, unknown>;
}

const TOKEN = { call_token: CALL.callId };

Deno.test('sarvam-tools › no secret → 401 and nothing runs', async () => {
  const { deps, state } = setup({ identityStatus: 'confirmed' });
  const response = await handleToolRequest(toolRequest('get_dues', TOKEN, {}), deps);
  assertEquals(response.status, 401);
  assertEquals(state.toolEvents.length, 0);
});

Deno.test('sarvam-tools › wrong secret → 401', async () => {
  const { deps } = setup();
  const headers = { authorization: `Bearer ${'x'.repeat(40)}` };
  const response = await handleToolRequest(toolRequest('get_dues', TOKEN, headers), deps);
  assertEquals(response.status, 401);
});

Deno.test('sarvam-tools › a lowercase "bearer" scheme is accepted', async () => {
  const { deps } = setup({ identityStatus: 'confirmed' });
  const headers = { authorization: `bearer ${SECRET}` };
  const body = await reply(await handleToolRequest(toolRequest('get_dues', TOKEN, headers), deps));
  assertEquals(body['ok'], true);
});

Deno.test('sarvam-tools › GET /warm → 204 with no secret, no data and nothing written', async () => {
  const { deps, state } = setup();
  const response = await handleToolRequest(new Request(`${BASE}/warm`), deps);
  assertEquals(response.status, 204);
  assertEquals(await response.text(), '');
  assertEquals(state.toolEvents.length, 0);
});

Deno.test('sarvam-tools › only POST is allowed', async () => {
  const { deps } = setup();
  const response = await handleToolRequest(new Request(`${BASE}/get_dues`), deps);
  assertEquals(response.status, 405);
});

Deno.test('sarvam-tools › a body that is not JSON → 400', async () => {
  const { deps } = setup();
  const response = await handleToolRequest(toolRequest('get_dues', 'not json'), deps);
  assertEquals(response.status, 400);
});

Deno.test('sarvam-tools › missing or unknown token → refused, nothing written', async () => {
  const { deps, state } = setup({ identityStatus: 'confirmed' });
  const missing = await reply(await handleToolRequest(toolRequest('get_dues', {}), deps));
  const unknown = await reply(
    await handleToolRequest(toolRequest('get_dues', { call_token: crypto.randomUUID() }), deps),
  );
  assertEquals([missing['code'], unknown['code']], ['CALL_NOT_AUTHORISED', 'CALL_NOT_AUTHORISED']);
  assertEquals(state.toolEvents.length, 0);
});

Deno.test('sarvam-tools › a token not accepted on the phone yet is refused (and audited)', async () => {
  const { deps, state } = setup({ status: 'ringing', identityStatus: 'confirmed' });
  const body = await reply(await handleToolRequest(toolRequest('get_dues', TOKEN), deps));
  assertEquals(body['code'], 'CALL_NOT_AUTHORISED');
  assertEquals(state.toolEvents[0]?.tool, 'get_dues');
});

Deno.test('sarvam-tools › an ended call is refused', async () => {
  const { deps } = setup({ status: 'completed', identityStatus: 'confirmed' });
  const body = await reply(await handleToolRequest(toolRequest('get_dues', TOKEN), deps));
  assertEquals(body['code'], 'CALL_NOT_AUTHORISED');
});

Deno.test('sarvam-tools › a token older than its time limit is refused', async () => {
  const acceptedAt = new Date(FAKE_NOW.getTime() - CALL_TOKEN_TTL_MS - 1000).toISOString();
  const { deps } = setup({ acceptedAt, identityStatus: 'confirmed' });
  const body = await reply(await handleToolRequest(toolRequest('get_dues', TOKEN), deps));
  assertEquals(body['code'], 'CALL_NOT_AUTHORISED');
});

Deno.test('sarvam-tools › a call with no accept time is refused', async () => {
  const { deps } = setup({ acceptedAt: null, status: 'accepted' });
  const body = await reply(await handleToolRequest(toolRequest('get_dues', TOKEN), deps));
  assertEquals(body['code'], 'CALL_NOT_AUTHORISED');
});

Deno.test('sarvam-tools › unknown tool path → refused and audited with a marker', async () => {
  const { deps, state } = setup();
  const body = await reply(await handleToolRequest(toolRequest('wipe_ledger', TOKEN), deps));
  assertEquals(body['code'], 'UNKNOWN_TOOL');
  assertEquals(state.toolEvents[0]?.args, AUDIT_MARKERS.unknownTool);
});

Deno.test('sarvam-tools › bad arguments → INVALID_ARGS reply, no crash', async () => {
  const { deps } = setup({ identityStatus: 'confirmed' });
  const args = { ...TOKEN, amount: 'lots', promise_date: 'someday' };
  const body = await reply(await handleToolRequest(toolRequest('log_promise', args), deps));
  assertEquals(body['code'], 'INVALID_ARGS');
});

Deno.test('sarvam-tools › confirm then get_dues: flat reply with say; every call audited', async () => {
  const { deps, state } = setup();
  const confirm = { ...TOKEN, answer: 'confirmed' };
  await handleToolRequest(toolRequest('confirm_identity', confirm), deps);
  const body = await reply(await handleToolRequest(toolRequest('get_dues', TOKEN), deps));
  assertEquals([body['ok'], body['outstanding'], body['overdue_amount']], [true, 8500, 5000]);
  assert(typeof body['say'] === 'string');
  assertEquals(state.toolEvents.map((event) => event.tool), ['confirm_identity', 'get_dues']);
  assertEquals(state.toolEvents[0]?.args, { answer: 'confirmed' });
  assert(typeof state.toolEvents[1]?.durationMs === 'number');
});

Deno.test('sarvam-tools › the shopkeeper never comes from the arguments', async () => {
  const { deps } = setup({ identityStatus: 'confirmed' });
  const args = { ...TOKEN, shopkeeper_id: FAKE_LATHA.id };
  const body = await reply(await handleToolRequest(toolRequest('get_dues', args), deps));
  assertEquals(body['outstanding'], 8500);
});

Deno.test('sarvam-tools › the demo clock decides days overdue', async () => {
  const settings = {
    demoClock: '2026-11-06T12:00:00+05:30',
    callingHoursEnabled: false,
    callLimitsEnabled: false,
    liveShopkeeperId: null,
  };
  const { deps } = setup({ identityStatus: 'confirmed' }, { state: { settings } });
  const body = await reply(await handleToolRequest(toolRequest('get_dues', TOKEN), deps));
  assertEquals(body['days_overdue'], 16);
});

Deno.test('sarvam-tools › a failed audit write is logged; the reply still goes out', async () => {
  const insertToolEvent = (): Promise<void> => Promise.reject(new Error('db down'));
  const { deps, logs } = setup({ identityStatus: 'confirmed' }, { repo: { insertToolEvent } });
  const body = await reply(await handleToolRequest(toolRequest('get_dues', TOKEN), deps));
  assertEquals(body['ok'], true);
  assert(logs.some((entry) => entry.event === 'audit_write_failed'));
});

Deno.test('sarvam-tools › a tool that hits a database error replies safely and logs why', async () => {
  const getLedger = (): Promise<never> => Promise.reject(new Error('timeout'));
  const { deps, logs } = setup({ identityStatus: 'confirmed' }, { repo: { getLedger } });
  const body = await reply(await handleToolRequest(toolRequest('get_dues', TOKEN), deps));
  assertEquals(body['code'], 'TEMPORARY_ERROR');
  assertEquals(logs.find((entry) => entry.event === 'tool_call')?.fields['error'], 'Error');
});

Deno.test('sarvam-tools › an unexpected crash becomes a generic 500', async () => {
  const getCallSession = (): Promise<never> => Promise.reject(new Error('boom'));
  const { deps } = setup({}, { repo: { getCallSession } });
  const response = await handleToolRequest(toolRequest('get_dues', TOKEN), deps);
  assertEquals(response.status, 500);
});

Deno.test('sarvam-tools › a path outside /sarvam-tools/ names no tool', async () => {
  const { deps } = setup({ identityStatus: 'confirmed' });
  const req = new Request('https://local.test/get_dues', {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(TOKEN),
  });
  const body = await reply(await handleToolRequest(req, deps));
  assertEquals(body['code'], 'UNKNOWN_TOOL');
});

Deno.test("sarvam-tools › Munshi's tool names do not exist here (UNKNOWN_TOOL)", async () => {
  for (const tool of ['book_summary', 'lookup_shopkeeper']) {
    const { deps, state } = setup({ identityStatus: 'confirmed' });
    const body = await reply(await handleToolRequest(toolRequest(tool, TOKEN), deps));
    assertEquals(body['code'], 'UNKNOWN_TOOL', tool);
    assertEquals(state.toolEvents[0]?.args, AUDIT_MARKERS.unknownTool);
  }
});

Deno.test("sarvam-tools › an owner call's id never works as a shopkeeper call token", async () => {
  const { deps, state } = setup({ identityStatus: 'confirmed' });
  const ownerCallToken = { call_token: FAKE_OWNER_CALL_ID };
  const body = await reply(await handleToolRequest(toolRequest('get_dues', ownerCallToken), deps));
  assertEquals(body['code'], 'CALL_NOT_AUTHORISED');
  assertEquals(body['outstanding'], undefined);
  assertEquals(state.toolEvents.length, 0);
});

Deno.test("sarvam-tools › Munshi's owner tool secret is refused (401), nothing read", async () => {
  const { deps, state } = setup({ identityStatus: 'confirmed' });
  const ownerSecret = { authorization: `Bearer ${'o'.repeat(40)}` };
  const response = await handleToolRequest(toolRequest('get_dues', TOKEN, ownerSecret), deps);
  assertEquals(response.status, 401);
  assertEquals(state.toolEvents.length, 0);
});
