// supabase/functions/vapi-webhook/handler.test.ts
import { assertEquals, assertStringIncludes } from '@std/assert';
import {
  createFakeRepository,
  FAKE_ANITA,
  type FakeCall,
  fakeCall,
  type FakeState,
} from '../_shared/db/fake-repository.ts';
import { RepositoryError } from '../_shared/db/postgrest.ts';
import type { Repository } from '../_shared/db/repository.ts';
import type { LogFields, Logger, LogLevel } from '../_shared/log.ts';
import { VAPI_SECRET_HEADER } from '../_shared/vapi.ts';
import { CALL_TOKEN_TTL_MS, handleWebhook, type WebhookDeps } from './handler.ts';

const SECRET = 'test-secret-'.padEnd(43, 'x');
const NOW = new Date('2026-11-01T12:00:00+05:30');
const TOKEN = fakeCall().id;
const VAPI_CALL_ID = 'vapi-call-1';

interface LoggedLine {
  readonly level: LogLevel;
  readonly event: string;
  readonly fields: LogFields;
}

function setup(
  calls: readonly FakeCall[] = [fakeCall({ startedAt: NOW.toISOString() })],
  overrides: Partial<FakeState> = {},
): { deps: WebhookDeps; state: FakeState; logs: LoggedLine[] } {
  const { repo, state } = createFakeRepository({ calls, ...overrides });
  const logs: LoggedLine[] = [];
  const log: Logger = (level, event, fields = {}) => logs.push({ level, event, fields });
  return { deps: { repo, secret: SECRET, clock: () => NOW, log }, state, logs };
}

interface ToolCallInput {
  readonly name: string;
  readonly args: unknown;
}

function toolCallsBody(
  toolCalls: readonly ToolCallInput[],
  call: Record<string, unknown> = {
    id: VAPI_CALL_ID,
    assistantOverrides: { metadata: { callToken: TOKEN } },
  },
): unknown {
  return {
    message: {
      type: 'tool-calls',
      call,
      toolCallList: toolCalls.map((toolCall, index) => ({
        id: `tc-${index}`,
        type: 'function',
        function: { name: toolCall.name, arguments: toolCall.args },
      })),
    },
  };
}

function post(body: unknown, secret: string | null = SECRET): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers[VAPI_SECRET_HEADER] = secret;
  return new Request('https://fn.test/vapi-webhook', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

interface VapiResult {
  readonly toolCallId: string;
  readonly result: string;
}

async function resultsOf(response: Response): Promise<Array<Record<string, unknown>>> {
  const body = (await response.json()) as { results: VapiResult[] };
  return body.results.map((entry) => JSON.parse(entry.result) as Record<string, unknown>);
}

const VERIFY_ANITA = { name: 'verify_customer', args: { dob: FAKE_ANITA.dob } };
const LOOKUP = { name: 'lookup_loan', args: {} };

// --- security --------------------------------------------------------------------------------

Deno.test('webhook › missing secret → 401 and nothing processed', async () => {
  const { deps, state } = setup();
  const response = await handleWebhook(post(toolCallsBody([VERIFY_ANITA]), null), deps);
  assertEquals(response.status, 401);
  assertEquals(state.toolEvents.length, 0);
  assertEquals(state.calls[0]?.verified, false);
});

Deno.test('webhook › wrong secret → 401 and nothing processed', async () => {
  const { deps, state, logs } = setup();
  const response = await handleWebhook(post(toolCallsBody([VERIFY_ANITA]), `${SECRET}y`), deps);
  assertEquals(response.status, 401);
  assertEquals(state.toolEvents.length, 0);
  assertEquals(logs[0]?.event, 'webhook_unauthorised');
});

Deno.test('webhook › non-POST → 405', async () => {
  const { deps } = setup();
  const response = await handleWebhook(new Request('https://fn.test/vapi-webhook'), deps);
  assertEquals(response.status, 405);
});

Deno.test('webhook › malformed JSON or unknown shape → 400', async () => {
  const { deps } = setup();
  assertEquals((await handleWebhook(post('{not json'), deps)).status, 400);
  assertEquals((await handleWebhook(post({ hello: 'world' }), deps)).status, 400);
  const badToolCalls = { message: { type: 'tool-calls', call: { id: 'x' } } };
  assertEquals((await handleWebhook(post(badToolCalls), deps)).status, 400);
});

Deno.test('webhook › other message types are acknowledged and ignored (until M4)', async () => {
  const { deps, state } = setup();
  const response = await handleWebhook(post({ message: { type: 'status-update' } }), deps);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {});
  assertEquals(state.toolEvents.length, 0);
});

// --- call token --------------------------------------------------------------------------------

Deno.test('webhook › unknown token → refused, no tool runs, no audit row', async () => {
  const { deps, state, logs } = setup([]);
  const response = await handleWebhook(post(toolCallsBody([VERIFY_ANITA])), deps);
  const [result] = await resultsOf(response);
  assertEquals(result?.['code'], 'CALL_NOT_AUTHORISED');
  assertEquals(state.toolEvents.length, 0);
  assertEquals(logs[0]?.fields['reason'], 'unknown_token');
});

Deno.test('webhook › missing or malformed token → refused', async () => {
  const { deps, logs } = setup();
  const noToken = toolCallsBody([LOOKUP], { id: VAPI_CALL_ID });
  const [first] = await resultsOf(await handleWebhook(post(noToken), deps));
  assertEquals(first?.['code'], 'CALL_NOT_AUTHORISED');
  const badToken = toolCallsBody([LOOKUP], { id: VAPI_CALL_ID, metadata: { callToken: 'abc' } });
  const [second] = await resultsOf(await handleWebhook(post(badToken), deps));
  assertEquals(second?.['code'], 'CALL_NOT_AUTHORISED');
  assertEquals(logs.map((line) => line.fields['reason']), ['missing_token', 'missing_token']);
});

Deno.test('webhook › token in call.metadata is accepted too', async () => {
  const { deps } = setup();
  const body = toolCallsBody([VERIFY_ANITA], { id: VAPI_CALL_ID, metadata: { callToken: TOKEN } });
  const [result] = await resultsOf(await handleWebhook(post(body), deps));
  assertEquals(result, { ok: true, data: { verified: true } });
});

Deno.test('webhook › token locks to the first Vapi call; a second call is refused', async () => {
  const { deps, state, logs } = setup();
  await handleWebhook(post(toolCallsBody([VERIFY_ANITA])), deps);
  assertEquals(state.calls[0]?.vapiCallId, VAPI_CALL_ID);

  const replay = toolCallsBody([LOOKUP], {
    id: 'vapi-call-2',
    assistantOverrides: { metadata: { callToken: TOKEN } },
  });
  const [result] = await resultsOf(await handleWebhook(post(replay), deps));
  assertEquals(result?.['code'], 'CALL_NOT_AUTHORISED');
  assertEquals(logs.at(-1)?.fields['reason'], 'token_in_use');
});

Deno.test('webhook › same Vapi call keeps working after the claim', async () => {
  const { deps } = setup();
  await handleWebhook(post(toolCallsBody([VERIFY_ANITA])), deps);
  const [result] = await resultsOf(await handleWebhook(post(toolCallsBody([LOOKUP])), deps));
  assertEquals(result?.['ok'], true);
});

Deno.test('webhook › unclaimed token older than the TTL is refused', async () => {
  const issued = new Date(NOW.getTime() - CALL_TOKEN_TTL_MS - 1).toISOString();
  const { deps, logs } = setup([fakeCall({ startedAt: issued })]);
  const [result] = await resultsOf(await handleWebhook(post(toolCallsBody([LOOKUP])), deps));
  assertEquals(result?.['code'], 'CALL_NOT_AUTHORISED');
  assertEquals(logs[0]?.fields['reason'], 'token_expired');
});

Deno.test('webhook › losing the claim race is refused', async () => {
  const { deps, logs } = setup();
  const racingRepo: Repository = { ...deps.repo, claimCall: () => Promise.resolve(false) };
  const response = await handleWebhook(post(toolCallsBody([LOOKUP])), {
    ...deps,
    repo: racingRepo,
  });
  const [result] = await resultsOf(response);
  assertEquals(result?.['code'], 'CALL_NOT_AUTHORISED');
  assertEquals(logs[0]?.fields['reason'], 'claim_lost');
});

// --- dispatch + audit --------------------------------------------------------------------------

Deno.test('webhook › lookup before verification refused and audited', async () => {
  const { deps, state } = setup();
  const [result] = await resultsOf(await handleWebhook(post(toolCallsBody([LOOKUP])), deps));
  assertEquals(result?.['code'], 'NOT_VERIFIED');
  assertEquals(state.toolEvents.length, 1);
  assertEquals(state.toolEvents[0]?.tool, 'lookup_loan');
});

Deno.test('webhook › verify then lookup in one request: the second call sees verification', async () => {
  const { deps, state } = setup();
  const response = await handleWebhook(post(toolCallsBody([VERIFY_ANITA, LOOKUP])), deps);
  const body = (await response.clone().json()) as { results: VapiResult[] };
  assertEquals(body.results.map((entry) => entry.toolCallId), ['tc-0', 'tc-1']);
  const [, lookup] = await resultsOf(response);
  assertEquals((lookup?.['data'] as Record<string, unknown>)['overdueAmount'], 6500);
  assertEquals(state.toolEvents.length, 2);
});

Deno.test('webhook › audit rows never store the DOB', async () => {
  const { deps, state } = setup();
  await handleWebhook(post(toolCallsBody([VERIFY_ANITA])), deps);
  assertEquals(state.toolEvents[0]?.args, { dob: '[redacted]' });
  assertEquals(JSON.stringify(state.toolEvents).includes(FAKE_ANITA.dob), false);
});

Deno.test('webhook › arguments sent as a JSON string are parsed', async () => {
  const { deps } = setup();
  const body = toolCallsBody([{
    name: 'verify_customer',
    args: JSON.stringify({ dob: FAKE_ANITA.dob }),
  }]);
  const [result] = await resultsOf(await handleWebhook(post(body), deps));
  assertEquals(result, { ok: true, data: { verified: true } });
});

Deno.test('webhook › truncated JSON holding a real DOB → INVALID_ARGS, DOB never audited', async () => {
  const { deps, state } = setup();
  const truncated = `{"dob":"${FAKE_ANITA.dob}"`;
  const response = await handleWebhook(
    post(toolCallsBody([{ name: 'verify_customer', args: truncated }])),
    deps,
  );
  assertEquals(response.status, 200);
  const [result] = await resultsOf(response);
  assertEquals(result?.['code'], 'INVALID_ARGS');
  assertEquals(state.toolEvents[0]?.args, '[invalid]');
  assertEquals(JSON.stringify(state.toolEvents).includes(FAKE_ANITA.dob), false);
});

Deno.test('webhook › extra or renamed DOB keys are never audited', async () => {
  const { deps, state } = setup();
  const renamed = { name: 'verify_customer', args: { date_of_birth: FAKE_ANITA.dob } };
  const extra = {
    name: 'verify_customer',
    args: { dob: FAKE_ANITA.dob, spokenDob: '3 Sept 1991' },
  };
  await handleWebhook(post(toolCallsBody([renamed, extra])), deps);
  assertEquals(state.toolEvents.map((event) => event.args), ['[invalid]', { dob: '[redacted]' }]);
  assertEquals(JSON.stringify(state.toolEvents).includes('1991'), false);
});

Deno.test('webhook › audit keeps only schema-checked arguments for other tools', async () => {
  const verified = fakeCall({ startedAt: NOW.toISOString(), verified: true, verifyAttempts: 1 });
  const { deps, state } = setup([verified]);
  const promise = {
    name: 'log_promise_to_pay',
    args: { amount: 6500, promiseDate: '2026-11-05', paymentMode: 'upi', note: 'DOB 1991-09-03' },
  };
  await handleWebhook(
    post(toolCallsBody([promise, { name: 'no_such_tool', args: { x: 1 } }])),
    deps,
  );
  assertEquals(state.toolEvents.map((event) => event.args), [
    { amount: 6500, promiseDate: '2026-11-05', paymentMode: 'upi' },
    '[unknown tool]',
  ]);
});

// --- failures inside a tool (CP1 H2) -----------------------------------------------------------

Deno.test('webhook › a database error inside a tool → safe TEMPORARY_ERROR, audited, logged', async () => {
  const verified = fakeCall({ startedAt: NOW.toISOString(), verified: true, verifyAttempts: 1 });
  const { deps, state, logs } = setup([verified]);
  const broken: Repository = {
    ...deps.repo,
    getLoanForCustomer: () =>
      Promise.reject(new RepositoryError('getLoanForCustomer failed (57014)')),
  };
  const response = await handleWebhook(post(toolCallsBody([LOOKUP])), { ...deps, repo: broken });
  assertEquals(response.status, 200);
  const [result] = await resultsOf(response);
  assertEquals(result?.['code'], 'TEMPORARY_ERROR');
  assertStringIncludes(String(result?.['message']), 'Share no loan figures');
  assertEquals(state.toolEvents[0]?.result, {
    ok: false,
    code: 'TEMPORARY_ERROR',
    message: String(result?.['message']),
  });
  const line = logs.find((entry) => entry.event === 'tool_call');
  assertEquals(line?.level, 'error');
  assertEquals(line?.fields['error'], 'getLoanForCustomer failed (57014)');
});

Deno.test('webhook › a non-database error is logged by name only (its message could hold data)', async () => {
  const verified = fakeCall({ startedAt: NOW.toISOString(), verified: true, verifyAttempts: 1 });
  const { deps, logs } = setup([verified]);
  const broken: Repository = {
    ...deps.repo,
    getLoanForCustomer: () => Promise.reject(new TypeError(`bad row ${FAKE_ANITA.dob}`)),
  };
  await handleWebhook(post(toolCallsBody([LOOKUP])), { ...deps, repo: broken });
  assertEquals(logs.find((entry) => entry.event === 'tool_call')?.fields['error'], 'TypeError');
  assertEquals(JSON.stringify(logs).includes(FAKE_ANITA.dob), false);
});

Deno.test('webhook › a failing tool does not stop the next one; each gets its own result', async () => {
  const { deps } = setup();
  const broken: Repository = {
    ...deps.repo,
    recordVerification: () =>
      Promise.reject(new RepositoryError('recordVerification failed (08006)')),
  };
  const response = await handleWebhook(post(toolCallsBody([VERIFY_ANITA, LOOKUP])), {
    ...deps,
    repo: broken,
  });
  const [verify, lookup] = await resultsOf(response);
  assertEquals(verify?.['code'], 'TEMPORARY_ERROR');
  assertEquals(lookup?.['code'], 'NOT_VERIFIED'); // verification never landed, so no figures leak
});

Deno.test('webhook › a failed audit write keeps the tool result (no duplicate promise)', async () => {
  const verified = fakeCall({ startedAt: NOW.toISOString(), verified: true, verifyAttempts: 1 });
  const { deps, state, logs } = setup([verified]);
  const broken: Repository = {
    ...deps.repo,
    insertToolEvent: () => Promise.reject(new RepositoryError('insertToolEvent failed (57014)')),
  };
  const promise = {
    name: 'log_promise_to_pay',
    args: { amount: 6500, promiseDate: '2026-11-05', paymentMode: 'upi' },
  };
  const response = await handleWebhook(post(toolCallsBody([promise])), { ...deps, repo: broken });
  assertEquals(response.status, 200);
  const [result] = await resultsOf(response);
  assertEquals(result?.['ok'], true);
  assertEquals(state.promises.length, 1);
  const line = logs.find((entry) => entry.event === 'audit_write_failed');
  assertEquals(line?.fields['error'], 'insertToolEvent failed (57014)');
});

Deno.test('webhook › demo clock decides "today" for promise rules', async () => {
  const verified = fakeCall({ startedAt: NOW.toISOString(), verified: true, verifyAttempts: 1 });
  const { deps } = setup([verified], {
    settings: {
      demoClock: '2026-11-25T12:00:00+05:30',
      callingHoursEnabled: false,
      callLimitsEnabled: false,
    },
  });
  const promise = {
    name: 'log_promise_to_pay',
    args: { amount: 6500, promiseDate: '2026-11-05', paymentMode: 'upi' },
  };
  const [result] = await resultsOf(await handleWebhook(post(toolCallsBody([promise])), deps));
  assertEquals(result?.['code'], 'POLICY_REFUSED');
});

Deno.test('webhook › each tool call is logged with tool, outcome and timing only', async () => {
  const { deps, logs } = setup();
  await handleWebhook(post(toolCallsBody([VERIFY_ANITA])), deps);
  const line = logs.find((entry) => entry.event === 'tool_call');
  assertEquals(line?.fields['tool'], 'verify_customer');
  assertEquals(line?.fields['ok'], true);
  assertEquals(typeof line?.fields['ms'], 'number');
  assertEquals(JSON.stringify(logs).includes(FAKE_ANITA.dob), false);
});

Deno.test('webhook › a database failure → 500 with a generic message, detail logged', async () => {
  const { deps, logs } = setup();
  const broken: Repository = {
    ...deps.repo,
    getCallSession: () => Promise.reject(new Error('getCallSession failed (08006)')),
  };
  const response = await handleWebhook(post(toolCallsBody([LOOKUP])), { ...deps, repo: broken });
  assertEquals(response.status, 500);
  assertStringIncludes(JSON.stringify(await response.json()), 'Something went wrong');
  assertStringIncludes(String(logs[0]?.fields['error']), '08006');
});

Deno.test('webhook › a tool call without arguments is treated as empty arguments', async () => {
  const { deps } = setup([fakeCall({ startedAt: NOW.toISOString(), verified: true })]);
  const [result] = await resultsOf(
    await handleWebhook(post(toolCallsBody([{ name: 'lookup_loan', args: undefined }])), deps),
  );
  assertEquals(result?.['ok'], true);
});

Deno.test('webhook › something other than an Error thrown → logged as "unknown error"', async () => {
  const verified = fakeCall({ startedAt: NOW.toISOString(), verified: true, verifyAttempts: 1 });
  const { deps, logs } = setup([verified]);
  const broken: Repository = {
    ...deps.repo,
    getLoanForCustomer: () => Promise.reject('boom'),
    insertToolEvent: () => Promise.reject('boom'),
  };
  const [result] = await resultsOf(
    await handleWebhook(post(toolCallsBody([LOOKUP])), { ...deps, repo: broken }),
  );
  assertEquals(result?.['code'], 'TEMPORARY_ERROR');
  assertEquals(logs.find((entry) => entry.event === 'tool_call')?.fields['error'], 'unknown error');
  assertEquals(
    logs.find((entry) => entry.event === 'audit_write_failed')?.fields['error'],
    'unknown error',
  );
});
