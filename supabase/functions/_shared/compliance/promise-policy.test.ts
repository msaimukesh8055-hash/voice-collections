// supabase/functions/_shared/compliance/promise-policy.test.ts
import { assertEquals, assertStringIncludes } from '@std/assert';
import { checkPaymentLinkAmount, checkPromise, type PromiseInput } from './promise-policy.ts';

const VALID: PromiseInput = {
  amount: 6500,
  promiseDate: '2026-11-05',
  overdueAmount: 6500,
  today: '2026-11-01',
};

function reasonOf(result: ReturnType<typeof checkPromise>): string {
  return result.ok ? '' : result.reason;
}

Deno.test('checkPromise › accepts the full overdue within the window', () => {
  assertEquals(checkPromise(VALID), { ok: true });
});

Deno.test('checkPromise › date window edges: today and today+10 allowed', () => {
  assertEquals(checkPromise({ ...VALID, promiseDate: '2026-11-01' }), { ok: true });
  assertEquals(checkPromise({ ...VALID, promiseDate: '2026-11-11' }), { ok: true });
});

Deno.test('checkPromise › refuses a past date or one beyond 10 days, naming the window', () => {
  assertStringIncludes(
    reasonOf(checkPromise({ ...VALID, promiseDate: '2026-10-31' })),
    '2026-11-11',
  );
  assertStringIncludes(
    reasonOf(checkPromise({ ...VALID, promiseDate: '2026-11-12' })),
    '2026-11-01',
  );
});

Deno.test('checkPromise › amount edges: 50% allowed, just below refused, above overdue refused', () => {
  assertEquals(checkPromise({ ...VALID, amount: 3250 }), { ok: true });
  assertStringIncludes(reasonOf(checkPromise({ ...VALID, amount: 3249 })), '₹3,250');
  assertStringIncludes(reasonOf(checkPromise({ ...VALID, amount: 6501 })), '₹6,500');
});

Deno.test('checkPromise › refuses when nothing is overdue', () => {
  assertStringIncludes(reasonOf(checkPromise({ ...VALID, overdueAmount: 0 })), 'no overdue');
});

Deno.test('checkPaymentLinkAmount › allows up to the overdue amount', () => {
  assertEquals(checkPaymentLinkAmount(6500, 6500), { ok: true });
  assertEquals(checkPaymentLinkAmount(100, 6500), { ok: true });
});

Deno.test('checkPaymentLinkAmount › refuses more than the overdue amount', () => {
  const result = checkPaymentLinkAmount(6501, 6500);
  assertEquals(result.ok, false);
  assertStringIncludes(result.ok ? '' : result.reason, '₹6,500');
});
