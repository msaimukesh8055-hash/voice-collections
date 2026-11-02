// supabase/functions/_shared/tools/request-owner-callback.test.ts
import { assert, assertEquals } from '@std/assert';
import { requestOwnerCallback } from './request-owner-callback.ts';
import { hasDigits, toolSetup } from './__fixtures__/tool-context.ts';

const ARGS = {
  reason: 'wants_owner',
  summary: 'Son asks Srinivas garu to call his father.',
} as const;

Deno.test('request_owner_callback › works before identity and saves a follow-up row', async () => {
  const { ctx, state } = toolSetup();
  const outcome = await requestOwnerCallback(ctx, ARGS);
  assert(outcome.result.ok);
  assertEquals(state.callbacks, [
    { callId: ctx.session.callId, shopkeeperId: ctx.session.shopkeeperId, ...ARGS },
  ]);
});

Deno.test('request_owner_callback › works after "denied" too, and its reply shares nothing', async () => {
  const { ctx, state } = toolSetup({ call: { identityStatus: 'denied' } });
  const outcome = await requestOwnerCallback(ctx, ARGS);
  assert(outcome.result.ok);
  assertEquals(state.callbacks.length, 1);
  assertEquals(hasDigits(outcome.result.say), false);
});
