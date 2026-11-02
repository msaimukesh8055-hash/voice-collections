// supabase/functions/_shared/tools/log-promise.test.ts
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { SavedPromise } from '../db/repository.ts';
import { logPromise } from './log-promise.ts';
import { confirmedSetup, hasDigits, toolSetup } from './__fixtures__/tool-context.ts';

const PROMISE = { amount: 3000, promise_date: '2026-11-09' };

Deno.test('log_promise › refused before identity, nothing saved, no amount said', async () => {
  const { ctx, state } = toolSetup();
  const outcome = await logPromise(ctx, PROMISE);
  assertEquals(outcome.result.ok ? null : outcome.result.code, 'IDENTITY_NOT_CONFIRMED');
  assertEquals(hasDigits(outcome.result.say), false);
  assertEquals(state.promises.length, 0);
});

Deno.test('log_promise › saves the first promise and gives a read-back line', async () => {
  const { ctx, state } = confirmedSetup();
  const outcome = await logPromise(ctx, PROMISE);
  assert(outcome.result.ok);
  assertEquals(state.promises, [
    {
      callId: ctx.session.callId,
      shopkeeperId: ctx.session.shopkeeperId,
      amount: 3000,
      promiseDate: '2026-11-09',
    },
  ]);
  assertEquals(outcome.result.data['saved'], true);
  assertStringIncludes(outcome.result.say, '3,000 rupees on Monday, 9 November 2026');
});

Deno.test('log_promise › the same terms again: nothing saved twice, read the saved one back', async () => {
  const { ctx, state } = confirmedSetup();
  await logPromise(ctx, PROMISE);
  const again = await logPromise(ctx, PROMISE);
  assert(again.result.ok);
  assertEquals(state.promises.length, 1);
  assertEquals(again.result.data, {
    saved: false,
    already_saved: true,
    amount: 3000,
    promise_date: '2026-11-09',
  });
});

Deno.test('log_promise › new terms in the same call update the promise (latest wins)', async () => {
  const { ctx, state } = confirmedSetup();
  await logPromise(ctx, PROMISE);
  const changed = await logPromise(ctx, { amount: 3000, promise_date: '2026-11-10' });
  assert(changed.result.ok);
  assertEquals(state.promises.length, 1);
  assertEquals(state.promises[0]?.promiseDate, '2026-11-10');
  assertEquals(changed.result.data, {
    saved: true,
    updated: true,
    amount: 3000,
    promise_date: '2026-11-10',
    previous_amount: 3000,
    previous_promise_date: '2026-11-09',
  });
  assertStringIncludes(changed.result.say, 'Promise updated: 3,000 rupees on Tuesday, 10 November');
  assertStringIncludes(changed.result.say, 'was 3,000 rupees on Monday, 9 November');
});

Deno.test('log_promise › new terms outside the rules: refused, the earlier promise stays', async () => {
  const { ctx, state } = confirmedSetup();
  await logPromise(ctx, PROMISE);
  const refused = await logPromise(ctx, { amount: 50, promise_date: '2026-11-10' });
  assertEquals(refused.result.ok ? null : refused.result.code, 'POLICY_REFUSED');
  assertEquals(state.promises[0]?.amount, 3000);
  assertEquals(state.promises[0]?.promiseDate, '2026-11-09');
});

Deno.test('log_promise › the update finds no row → temporary error', async () => {
  const saved: SavedPromise = { amount: 3000, promiseDate: '2026-11-09' };
  const getPromiseForCall = (): Promise<SavedPromise | null> => Promise.resolve(saved);
  const updatePromiseForCall = (): Promise<boolean> => Promise.resolve(false);
  const { ctx } = confirmedSetup({ repo: { getPromiseForCall, updatePromiseForCall } });
  const outcome = await logPromise(ctx, { amount: 3000, promise_date: '2026-11-10' });
  assertEquals(outcome.result.ok ? null : outcome.result.code, 'TEMPORARY_ERROR');
});

Deno.test('log_promise › lost a save race to different terms: updates to the latest', async () => {
  let reads = 0;
  const winner: SavedPromise = { amount: 2500, promiseDate: '2026-11-08' };
  const getPromiseForCall = (): Promise<SavedPromise | null> => {
    reads += 1;
    return Promise.resolve(reads === 1 ? null : winner);
  };
  const insertPromise = (): Promise<boolean> => Promise.resolve(false);
  const updates: SavedPromise[] = [];
  const updatePromiseForCall = (_callId: string, promise: SavedPromise): Promise<boolean> => {
    updates.push(promise);
    return Promise.resolve(true);
  };
  const { ctx } = confirmedSetup({
    repo: { getPromiseForCall, insertPromise, updatePromiseForCall },
  });
  const outcome = await logPromise(ctx, PROMISE);
  assert(outcome.result.ok);
  assertEquals(updates, [{ amount: 3000, promiseDate: '2026-11-09' }]);
  assertEquals(outcome.result.data['previous_amount'], 2500);
});

Deno.test('log_promise › a simultaneous duplicate blocked by the database returns the saved one', async () => {
  let reads = 0;
  const saved: SavedPromise = { amount: 3000, promiseDate: '2026-11-09' };
  const getPromiseForCall = (): Promise<SavedPromise | null> => {
    reads += 1;
    return Promise.resolve(reads === 1 ? null : saved);
  };
  const insertPromise = (): Promise<boolean> => Promise.resolve(false);
  const { ctx } = confirmedSetup({ repo: { getPromiseForCall, insertPromise } });
  const outcome = await logPromise(ctx, PROMISE);
  assert(outcome.result.ok);
  assertEquals(outcome.result.data['already_saved'], true);
  assertEquals(outcome.result.data['amount'], 3000);
});

Deno.test('log_promise › duplicate blocked but the saved one cannot be read → temporary error', async () => {
  const insertPromise = (): Promise<boolean> => Promise.resolve(false);
  const { ctx } = confirmedSetup({ repo: { insertPromise } });
  const outcome = await logPromise(ctx, PROMISE);
  assertEquals(outcome.result.ok ? null : outcome.result.code, 'TEMPORARY_ERROR');
});

Deno.test('log_promise › outside the rules: a reason Asha can say, nothing saved', async () => {
  const { ctx, state } = confirmedSetup();
  const outcome = await logPromise(ctx, { amount: 50, promise_date: '2026-11-09' });
  assert(!outcome.result.ok);
  assertEquals(outcome.result.code, 'POLICY_REFUSED');
  assertStringIncludes(outcome.result.say, 'between 100 rupees and 8,500 rupees');
  assertEquals(state.promises.length, 0);
});
