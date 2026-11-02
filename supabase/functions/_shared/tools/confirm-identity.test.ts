// supabase/functions/_shared/tools/confirm-identity.test.ts
import { assert, assertEquals, assertFalse, assertStringIncludes } from '@std/assert';
import { confirmIdentity, MAX_UNSURE_ANSWERS } from './confirm-identity.ts';
import { toolSetup } from './__fixtures__/tool-context.ts';

Deno.test('confirm_identity › "confirmed" unlocks amounts for the rest of the call', async () => {
  const { ctx, state } = toolSetup();
  const outcome = await confirmIdentity(ctx, { answer: 'confirmed' });
  assert(outcome.result.ok);
  assertEquals(state.calls[0]?.identityStatus, 'confirmed');
  assertEquals(outcome.session?.identityStatus, 'confirmed');
});

Deno.test('confirm_identity › asking again: "already confirmed", nothing written', async () => {
  const recordIdentity = (): Promise<boolean> => Promise.reject(new Error('must not write'));
  const { ctx } = toolSetup({ call: { identityStatus: 'confirmed' }, repo: { recordIdentity } });
  const outcome = await confirmIdentity(ctx, { answer: 'unsure' });
  assert(outcome.result.ok);
  assertEquals(outcome.result.data['identity'], 'confirmed');
  assertStringIncludes(outcome.result.say, 'Do not ask again');
});

Deno.test('confirm_identity › "denied" locks the call: share nothing, end politely', async () => {
  const { ctx, state } = toolSetup();
  const outcome = await confirmIdentity(ctx, { answer: 'denied' });
  assert(outcome.result.ok);
  assertEquals(state.calls[0]?.identityStatus, 'denied');
  assertStringIncludes(outcome.result.say, 'Share nothing');
});

Deno.test('confirm_identity › once denied, a later "confirmed" is refused', async () => {
  const { ctx, state } = toolSetup({ call: { identityStatus: 'denied' } });
  const outcome = await confirmIdentity(ctx, { answer: 'confirmed' });
  assertFalse(outcome.result.ok);
  assertEquals(outcome.result.ok ? null : outcome.result.code, 'IDENTITY_DENIED');
  assertEquals(state.calls[0]?.identityStatus, 'denied');
});

Deno.test('confirm_identity › one unsure answer asks once more', async () => {
  const { ctx, state } = toolSetup();
  const outcome = await confirmIdentity(ctx, { answer: 'unsure' });
  assert(outcome.result.ok);
  assertEquals(state.calls[0]?.identityStatus, 'unknown');
  assertEquals(state.calls[0]?.identityUnsureCount, 1);
});

Deno.test('confirm_identity › unsure twice is treated as denied', async () => {
  const { ctx, state } = toolSetup({ call: { identityUnsureCount: MAX_UNSURE_ANSWERS - 1 } });
  const outcome = await confirmIdentity(ctx, { answer: 'unsure' });
  assertEquals(state.calls[0]?.identityStatus, 'denied');
  assert(outcome.result.ok && outcome.result.data['identity'] === 'denied');
});

Deno.test('confirm_identity › a parallel request changed identity first → temporary error', async () => {
  const recordIdentity = (): Promise<boolean> => Promise.resolve(false);
  const { ctx } = toolSetup({ repo: { recordIdentity } });
  const outcome = await confirmIdentity(ctx, { answer: 'confirmed' });
  assertEquals(outcome.result.ok ? null : outcome.result.code, 'TEMPORARY_ERROR');
});
