// supabase/functions/_shared/tools/record-payment-claim.test.ts
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { SavedClaim } from '../db/repository.ts';
import { getDues } from './get-dues.ts';
import { recordPaymentClaim } from './record-payment-claim.ts';
import { confirmedSetup, hasDigits, toolSetup } from './__fixtures__/tool-context.ts';

const CLAIM = { amount: 2000, paid_date: '2026-11-01', mode: 'upi' } as const;

Deno.test('record_payment_claim › refused before identity, nothing saved', async () => {
  const { ctx, state } = toolSetup();
  const before = state.ledger.length;
  const outcome = await recordPaymentClaim(ctx, CLAIM);
  assertEquals(outcome.result.ok ? null : outcome.result.code, 'IDENTITY_NOT_CONFIRMED');
  assertEquals(hasDigits(outcome.result.say), false);
  assertEquals(state.ledger.length, before);
});

Deno.test('record_payment_claim › saved as "claimed" for the owner to confirm', async () => {
  const { ctx, state } = confirmedSetup();
  const outcome = await recordPaymentClaim(ctx, CLAIM);
  assert(outcome.result.ok);
  const saved = state.ledger.at(-1);
  assertEquals([saved?.kind, saved?.status, saved?.amount, saved?.callId], [
    'payment',
    'claimed',
    2000,
    ctx.session.callId,
  ]);
  assertStringIncludes(outcome.result.say, 'Do not say the balance has gone down');
});

Deno.test('record_payment_claim › never reduces the balance: dues before = dues after', async () => {
  const { ctx } = confirmedSetup();
  const before = await getDues(ctx, {});
  await recordPaymentClaim(ctx, CLAIM);
  const after = await getDues(ctx, {});
  assertEquals(after.result, before.result);
});

Deno.test('record_payment_claim › once per call: a second claim returns the first', async () => {
  const { ctx, state } = confirmedSetup();
  await recordPaymentClaim(ctx, CLAIM);
  const again = await recordPaymentClaim(ctx, { ...CLAIM, amount: 1000 });
  assert(again.result.ok);
  assertEquals(state.ledger.filter((row) => row.status === 'claimed').length, 1);
  assertEquals(again.result.data, {
    saved: false,
    already_saved: true,
    amount: 2000,
    paid_date: '2026-11-01',
    mode: 'upi',
  });
});

Deno.test('record_payment_claim › more than the outstanding is refused', async () => {
  const { ctx, state } = confirmedSetup();
  const outcome = await recordPaymentClaim(ctx, { ...CLAIM, amount: 9000 });
  assertEquals(outcome.result.ok ? null : outcome.result.code, 'POLICY_REFUSED');
  assertEquals(state.ledger.some((row) => row.status === 'claimed'), false);
});

Deno.test('record_payment_claim › a simultaneous duplicate returns the saved claim', async () => {
  let reads = 0;
  const saved: SavedClaim = { amount: 1500, paidDate: '2026-10-31', mode: 'cash' };
  const getClaimForCall = (): Promise<SavedClaim | null> => {
    reads += 1;
    return Promise.resolve(reads === 1 ? null : saved);
  };
  const insertPaymentClaim = (): Promise<boolean> => Promise.resolve(false);
  const { ctx } = confirmedSetup({ repo: { getClaimForCall, insertPaymentClaim } });
  const outcome = await recordPaymentClaim(ctx, CLAIM);
  assert(outcome.result.ok);
  assertEquals(outcome.result.data['amount'], 1500);
});

Deno.test('record_payment_claim › duplicate blocked but unreadable → temporary error', async () => {
  const insertPaymentClaim = (): Promise<boolean> => Promise.resolve(false);
  const { ctx } = confirmedSetup({ repo: { insertPaymentClaim } });
  const outcome = await recordPaymentClaim(ctx, CLAIM);
  assertEquals(outcome.result.ok ? null : outcome.result.code, 'TEMPORARY_ERROR');
});
