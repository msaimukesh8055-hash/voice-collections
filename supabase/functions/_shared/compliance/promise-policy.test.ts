// supabase/functions/_shared/compliance/promise-policy.test.ts
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import {
  checkPaymentClaim,
  checkPromise,
  CLAIM_WINDOW_DAYS,
  MIN_PROMISE_AMOUNT,
  PROMISE_WINDOW_DAYS,
} from './promise-policy.ts';

const TODAY = '2026-11-02';
const promise = { amount: 3000, promiseDate: '2026-11-09', outstanding: 8500, today: TODAY };
const claim = { amount: 2000, paidDate: '2026-11-01', outstanding: 8500, today: TODAY };

function reasonOf(result: { ok: boolean; reason?: string }): string {
  assert(!result.ok);
  return result.reason ?? '';
}

Deno.test('promise policy › a part payment within two weeks is accepted', () => {
  assertEquals(checkPromise(promise), { ok: true });
});

Deno.test('promise policy › the full outstanding, today or on the last day, is accepted', () => {
  assertEquals(checkPromise({ ...promise, amount: 8500, promiseDate: TODAY }), { ok: true });
  assertEquals(checkPromise({ ...promise, promiseDate: '2026-11-16' }), { ok: true });
  assertEquals(PROMISE_WINDOW_DAYS, 14);
});

Deno.test('promise policy › less than ₹100 is refused with the range Asha can offer', () => {
  const reason = reasonOf(checkPromise({ ...promise, amount: MIN_PROMISE_AMOUNT - 1 }));
  assertStringIncludes(reason, '100 rupees and 8,500 rupees');
});

Deno.test('promise policy › more than the outstanding is refused', () => {
  assertStringIncludes(reasonOf(checkPromise({ ...promise, amount: 8501 })), '8,500 rupees');
});

Deno.test('promise policy › a date in the past or beyond 14 days is refused with spoken dates', () => {
  const past = reasonOf(checkPromise({ ...promise, promiseDate: '2026-11-01' }));
  assertStringIncludes(past, 'Monday, 2 November 2026 and Monday, 16 November 2026');
  assert(!checkPromise({ ...promise, promiseDate: '2026-11-17' }).ok);
});

Deno.test('promise policy › nothing outstanding means nothing to promise', () => {
  assertStringIncludes(reasonOf(checkPromise({ ...promise, outstanding: 0 })), 'Nothing');
});

Deno.test('claim policy › a payment yesterday, up to the outstanding, is accepted', () => {
  assertEquals(checkPaymentClaim(claim), { ok: true });
  assertEquals(checkPaymentClaim({ ...claim, amount: 8500, paidDate: TODAY }), { ok: true });
});

Deno.test('claim policy › more than the outstanding is refused', () => {
  assertStringIncludes(reasonOf(checkPaymentClaim({ ...claim, amount: 9000 })), '8,500 rupees');
});

Deno.test('claim policy › a future date or one older than 30 days is refused', () => {
  assertStringIncludes(reasonOf(checkPaymentClaim({ ...claim, paidDate: '2026-11-03' })), 'future');
  assertEquals(checkPaymentClaim({ ...claim, paidDate: '2026-10-03' }), { ok: true });
  const old = reasonOf(checkPaymentClaim({ ...claim, paidDate: '2026-10-02' }));
  assertStringIncludes(old, `${CLAIM_WINDOW_DAYS} days`);
});

Deno.test('claim policy › nothing outstanding: the claim is not recorded', () => {
  assertStringIncludes(reasonOf(checkPaymentClaim({ ...claim, outstanding: 0 })), 'Nothing');
});
