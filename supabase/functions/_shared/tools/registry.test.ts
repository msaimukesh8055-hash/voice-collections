// supabase/functions/_shared/tools/registry.test.ts
import { assertEquals, assertStringIncludes } from '@std/assert';
import {
  createFakeRepository,
  FAKE_ANITA,
  FAKE_RAVI,
  type FakeCall,
  fakeCall,
} from '../db/fake-repository.ts';
import type { CallSession, Repository } from '../db/repository.ts';
import { runTool } from './registry.ts';
import type { ToolContext, ToolResult } from './types.ts';

const NOON_IST = new Date('2026-11-01T12:00:00+05:30');

async function contextFor(
  call: FakeCall,
): Promise<{ ctx: ToolContext; state: ReturnType<typeof createFakeRepository>['state'] }> {
  const { repo, state } = createFakeRepository({ calls: [call] });
  const session = (await repo.getCallSession(call.id)) as CallSession;
  return { ctx: { repo, session, now: NOON_IST }, state };
}

function verifiedAnita(): FakeCall {
  return fakeCall({ verified: true, verifyAttempts: 1 });
}

function errorCode(result: ToolResult): string | null {
  return result.ok ? null : result.code;
}

// --- registry -----------------------------------------------------------------------------

Deno.test('runTool › unknown tool name is refused', async () => {
  const { ctx } = await contextFor(fakeCall());
  const { result } = await runTool('delete_loan', {}, ctx);
  assertEquals(errorCode(result), 'UNKNOWN_TOOL');
});

Deno.test('runTool › invalid arguments return a readable validation error, no crash', async () => {
  const { ctx } = await contextFor(verifiedAnita());
  const { result } = await runTool(
    'log_promise_to_pay',
    { amount: 'lots', paymentMode: 'cash' },
    ctx,
  );
  assertEquals(errorCode(result), 'INVALID_ARGS');
  assertStringIncludes(result.ok ? '' : result.message, 'paymentMode');
});

Deno.test('runTool › non-object arguments are refused', async () => {
  const { ctx } = await contextFor(fakeCall());
  const { result } = await runTool('verify_customer', 'not-an-object', ctx);
  assertEquals(errorCode(result), 'INVALID_ARGS');
  assertStringIncludes(result.ok ? '' : result.message, 'arguments:');
});

// --- verify_customer -------------------------------------------------------------------------

Deno.test('verify_customer › correct DOB verifies and records it', async () => {
  const { ctx, state } = await contextFor(fakeCall());
  const outcome = await runTool('verify_customer', { dob: FAKE_ANITA.dob }, ctx);
  assertEquals(outcome.result, { ok: true, data: { verified: true } });
  assertEquals(outcome.session?.verified, true);
  assertEquals(state.calls[0]?.verified, true);
});

Deno.test('verify_customer › wrong DOB says "does not match", never "could not hear"', async () => {
  const { ctx } = await contextFor(fakeCall());
  const outcome = await runTool('verify_customer', { dob: '1990-01-01' }, ctx);
  const text = JSON.stringify(outcome.result);
  assertStringIncludes(text, 'does not match our records');
  assertStringIncludes(text, 'Do not say you could not hear or understand');
});

Deno.test('verify_customer › wrong DOB reports attempts left and never echoes a DOB', async () => {
  const { ctx, state } = await contextFor(fakeCall());
  const outcome = await runTool('verify_customer', { dob: '1990-01-01' }, ctx);
  assertEquals(outcome.result.ok && outcome.result.data['verified'], false);
  assertEquals(outcome.result.ok && outcome.result.data['attemptsLeft'], 1);
  assertEquals(JSON.stringify(outcome.result).includes(FAKE_ANITA.dob), false);
  assertEquals(state.calls[0]?.verifyAttempts, 1);
});

Deno.test('verify_customer › second wrong DOB leaves no attempts and says to end the call', async () => {
  const { ctx } = await contextFor(fakeCall({ verifyAttempts: 1 }));
  const outcome = await runTool('verify_customer', { dob: '1990-01-01' }, ctx);
  assertEquals(outcome.result.ok && outcome.result.data['attemptsLeft'], 0);
  assertStringIncludes(JSON.stringify(outcome.result), 'end the call');
});

Deno.test('verify_customer › 3rd try is refused even with the correct DOB', async () => {
  const { ctx, state } = await contextFor(fakeCall({ verifyAttempts: 2 }));
  const outcome = await runTool('verify_customer', { dob: FAKE_ANITA.dob }, ctx);
  assertEquals(errorCode(outcome.result), 'VERIFY_LOCKED');
  assertEquals(state.calls[0]?.verified, false);
});

Deno.test('verify_customer › already verified stays verified without another attempt', async () => {
  const { ctx, state } = await contextFor(verifiedAnita());
  const outcome = await runTool('verify_customer', { dob: '1990-01-01' }, ctx);
  assertEquals(outcome.result, { ok: true, data: { verified: true } });
  assertEquals(state.calls[0]?.verifyAttempts, 1);
});

Deno.test('verify_customer › identity comes from the call token, never from arguments', async () => {
  // Anita's call; the LLM tries to pass Ravi's id and DOB.
  const { ctx } = await contextFor(fakeCall());
  const outcome = await runTool(
    'verify_customer',
    { dob: FAKE_RAVI.dob, customerId: FAKE_RAVI.id },
    ctx,
  );
  assertEquals(outcome.result.ok && outcome.result.data['verified'], false);
});

// --- verify-before-disclose guard ------------------------------------------------------------

const GUARDED_CALLS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['lookup_loan', {}],
  ['log_promise_to_pay', { amount: 6500, promiseDate: '2026-11-05', paymentMode: 'upi' }],
  ['send_payment_link', { amount: 6500 }],
];

for (const [tool, args] of GUARDED_CALLS) {
  Deno.test(`${tool} › refused with NOT_VERIFIED before verification, nothing written`, async () => {
    const { ctx, state } = await contextFor(fakeCall());
    const { result } = await runTool(tool, args, ctx);
    assertEquals(errorCode(result), 'NOT_VERIFIED');
    assertEquals(JSON.stringify(result).includes('6500'), false);
    assertEquals(state.promises.length, 0);
  });
}

// --- lookup_loan -----------------------------------------------------------------------------

Deno.test('lookup_loan › returns the seeded figures and only the last 4 loan digits', async () => {
  const { ctx } = await contextFor(verifiedAnita());
  const { result } = await runTool('lookup_loan', {}, ctx);
  assertEquals(result, {
    ok: true,
    data: {
      loanNumberLast4: '0871',
      product: 'personal_loan',
      overdueAmount: 6500,
      emiAmount: 6500,
      dueDate: '2026-10-10',
      daysPastDue: 21,
      lateFee: 500,
    },
  });
  assertEquals(JSON.stringify(result).includes('SF-PL-100871'), false);
});

Deno.test('loan tools › NOT_FOUND when the customer has no loan', async () => {
  const { repo } = createFakeRepository({ calls: [verifiedAnita()], loans: [] });
  const session = (await repo.getCallSession(verifiedAnita().id)) as CallSession;
  const ctx = { repo, session, now: NOON_IST };
  for (const [tool, args] of GUARDED_CALLS) {
    const { result } = await runTool(tool, args, ctx);
    assertEquals(errorCode(result), 'NOT_FOUND', tool);
  }
});

// --- log_promise_to_pay ----------------------------------------------------------------------

Deno.test('log_promise_to_pay › writes a promise for the token customer loan', async () => {
  const { ctx, state } = await contextFor(verifiedAnita());
  const args = { amount: 6500, promiseDate: '2026-11-05', paymentMode: 'upi' } as const;
  const { result } = await runTool('log_promise_to_pay', args, ctx);
  assertEquals(result, { ok: true, data: { logged: true, ...args } });
  assertEquals(state.promises, [
    { callId: verifiedAnita().id, loanId: '10000000-0000-4000-8000-000000000002', ...args },
  ]);
});

Deno.test('log_promise_to_pay › outside policy is refused with a reason Asha can say', async () => {
  const { ctx, state } = await contextFor(verifiedAnita());
  const args = { amount: 6500, promiseDate: '2026-11-30', paymentMode: 'upi' };
  const { result } = await runTool('log_promise_to_pay', args, ctx);
  assertEquals(errorCode(result), 'POLICY_REFUSED');
  assertStringIncludes(result.ok ? '' : result.message, '2026-11-11');
  assertEquals(state.promises.length, 0);
});

Deno.test('log_promise_to_pay › uses the demo-aware date as "today"', async () => {
  const { ctx } = await contextFor(verifiedAnita());
  const args = { amount: 6500, promiseDate: '2026-11-05', paymentMode: 'upi' };
  const later = { ...ctx, now: new Date('2026-11-20T12:00:00+05:30') };
  const { result } = await runTool('log_promise_to_pay', args, later);
  assertEquals(errorCode(result), 'POLICY_REFUSED');
});

// --- send_payment_link -----------------------------------------------------------------------

Deno.test('send_payment_link › confirms the masked number and amount', async () => {
  const { ctx } = await contextFor(verifiedAnita());
  const { result } = await runTool('send_payment_link', { amount: 6500 }, ctx);
  assertEquals(result, {
    ok: true,
    data: { sent: true, channel: 'sms', sentTo: FAKE_ANITA.phoneMasked, amount: 6500 },
  });
});

Deno.test('send_payment_link › refuses more than the overdue amount', async () => {
  const { ctx } = await contextFor(verifiedAnita());
  const { result } = await runTool('send_payment_link', { amount: 9000 }, ctx);
  assertEquals(errorCode(result), 'POLICY_REFUSED');
});

// --- transfer_to_human -----------------------------------------------------------------------

Deno.test('transfer_to_human › allowed before verification and creates a handoff', async () => {
  const call = fakeCall({ customerId: FAKE_RAVI.id, language: 'hi' });
  const { ctx, state } = await contextFor(call);
  const args = { reason: 'customer_request', summary: 'Wants to speak to a person.' };
  const { result } = await runTool('transfer_to_human', args, ctx);
  assertEquals(result.ok, true);
  assertEquals(state.handoffs, [{ callId: call.id, customerId: FAKE_RAVI.id, ...args }]);
});

Deno.test('transfer_to_human › tells Asha to keep listening, not to hang up', async () => {
  const { ctx } = await contextFor(fakeCall());
  const args = { reason: 'dispute', summary: 'Thinks the amount is wrong.' };
  const nextStep = JSON.stringify((await runTool('transfer_to_human', args, ctx)).result);
  assertStringIncludes(nextStep, 'Do not end the call yet');
  assertStringIncludes(nextStep, 'If they now want to pay, continue as normal');
});

// Type-only check: the fake satisfies the real contract.
const _contract: Repository = createFakeRepository().repo;
