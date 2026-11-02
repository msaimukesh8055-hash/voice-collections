// supabase/functions/_shared/tools/registry.test.ts
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { RepositoryError } from '../db/postgrest.ts';
import { FAKE_LATHA } from '../db/fake-repository.ts';
import { AUDIT_MARKERS, describeFailure, runTool } from './registry.ts';
import { TOOL_NAMES } from './schemas.ts';
import { toReplyBody } from './types.ts';
import { confirmedSetup, toolSetup } from './__fixtures__/tool-context.ts';

Deno.test('registry › all five tools are registered', () => {
  assertEquals([...TOOL_NAMES].sort(), [
    'confirm_identity',
    'get_dues',
    'log_promise',
    'record_payment_claim',
    'request_owner_callback',
  ]);
});

Deno.test('registry › an unknown tool is refused and audited with a marker only', async () => {
  const { ctx } = toolSetup();
  const run = await runTool('delete_ledger', { anything: 1 }, ctx);
  assertEquals(run.result.ok ? null : run.result.code, 'UNKNOWN_TOOL');
  assertEquals(run.auditArgs, AUDIT_MARKERS.unknownTool);
});

Deno.test('registry › bad arguments → INVALID_ARGS naming the field; nothing runs or is kept', async () => {
  const { ctx, state } = confirmedSetup();
  const run = await runTool('log_promise', { amount: 'lots', promise_date: 'Friday' }, ctx);
  assert(!run.result.ok);
  assertEquals(run.result.code, 'INVALID_ARGS');
  assertStringIncludes(run.result.say, 'promise_date');
  assertEquals(run.auditArgs, AUDIT_MARKERS.invalid);
  assertEquals(state.promises.length, 0);
});

Deno.test('registry › a non-object body is invalid, not a crash', async () => {
  const { ctx } = toolSetup();
  const run = await runTool('request_owner_callback', 'call me', ctx);
  assertEquals(run.result.ok ? null : run.result.code, 'INVALID_ARGS');
});

Deno.test('registry › an unknown callback reason is invalid', async () => {
  const { ctx, state } = toolSetup();
  const run = await runTool('request_owner_callback', { reason: 'angry', summary: 'x' }, ctx);
  assertEquals(run.result.ok ? null : run.result.code, 'INVALID_ARGS');
  assertEquals(state.callbacks.length, 0);
});

Deno.test('registry › an amount sent as text is accepted as a number', async () => {
  const { ctx, state } = confirmedSetup();
  const run = await runTool('log_promise', { amount: '3000', promise_date: '2026-11-09' }, ctx);
  assert(run.result.ok);
  assertEquals(state.promises[0]?.amount, 3000);
  assertEquals(run.auditArgs, { amount: 3000, promise_date: '2026-11-09' });
});

Deno.test('registry › a shopkeeper id in the arguments is ignored: the token decides', async () => {
  const { ctx } = confirmedSetup();
  const run = await runTool('get_dues', { shopkeeper_id: FAKE_LATHA.id }, ctx);
  assert(run.result.ok);
  assertEquals(run.result.data['outstanding'], 8500);
  assertEquals(run.auditArgs, {});
});

Deno.test('registry › a database failure becomes a safe reply plus a loggable reason', async () => {
  const getLedger = (): Promise<never> =>
    Promise.reject(new RepositoryError('getLedger', 'HTTP 503'));
  const { ctx } = confirmedSetup({ repo: { getLedger } });
  const run = await runTool('get_dues', {}, ctx);
  assertEquals(run.result.ok ? null : run.result.code, 'TEMPORARY_ERROR');
  assertEquals(run.failure, 'getLedger failed (HTTP 503)');
});

Deno.test('registry › failures that are not ours are described by name only', () => {
  assertEquals(describeFailure(new TypeError('row value 8500')), 'TypeError');
  assertEquals(describeFailure('boom'), 'unknown error');
});

Deno.test('reply body › success is flat with ok and say; refusals carry the code', async () => {
  const { ctx } = toolSetup();
  const refused = await runTool('get_dues', {}, ctx);
  assertEquals(Object.keys(toReplyBody(refused.result)).sort(), ['code', 'ok', 'say']);
  const { ctx: confirmed } = confirmedSetup();
  const body = toReplyBody((await runTool('get_dues', {}, confirmed)).result);
  assertEquals([body['ok'], body['outstanding']], [true, 8500]);
  assertEquals(typeof body['say'], 'string');
});
