// supabase/functions/_shared/tools/log-promise.ts
// One promise per call, and the latest terms win (Saim, 2026-11-02, replacing M3 Decision 9's
// "a repeat returns the saved one"): if the shopkeeper changes the amount or date during the
// call, the call's promise is updated; the same terms again save nothing new. Every version
// stays in the audit log (tool_events). The database's unique rule stops two simultaneous
// requests from saving two rows.
import { istDate } from '../clock.ts';
import { checkPromise } from '../compliance/promise-policy.ts';
import type { SavedPromise } from '../db/repository.ts';
import { formatDay, formatRupees } from '../format.ts';
import { computeDues } from '../ledger/dues.ts';
import { requireIdentity } from './guards.ts';
import type { ToolArgs } from './schemas.ts';
import { fail, ok, type ToolContext, type ToolOutcome } from './types.ts';

function describe(promise: SavedPromise): string {
  return `${formatRupees(promise.amount)} on ${formatDay(promise.promiseDate)}`;
}

function sameTerms(a: SavedPromise, b: SavedPromise): boolean {
  return a.amount === b.amount && a.promiseDate === b.promiseDate;
}

function alreadySaved(promise: SavedPromise): ToolOutcome {
  return ok(
    `This promise is already saved: ${describe(promise)}. Read it back to the caller to confirm.`,
    {
      saved: false,
      already_saved: true,
      amount: promise.amount,
      promise_date: promise.promiseDate,
    },
  );
}

/** The call already has a promise: keep it if nothing changed, otherwise switch to the latest. */
async function replace(
  ctx: ToolContext,
  saved: SavedPromise,
  latest: SavedPromise,
): Promise<ToolOutcome> {
  if (sameTerms(saved, latest)) return alreadySaved(saved);
  if (!(await ctx.repo.updatePromiseForCall(ctx.session.callId, latest))) {
    return fail('TEMPORARY_ERROR');
  }
  return ok(
    `Promise updated: ${describe(latest)} (was ${describe(saved)}). ` +
      'Read the new one back to the caller to confirm.',
    {
      saved: true,
      updated: true,
      amount: latest.amount,
      promise_date: latest.promiseDate,
      previous_amount: saved.amount,
      previous_promise_date: saved.promiseDate,
    },
  );
}

export async function logPromise(
  ctx: ToolContext,
  args: ToolArgs<'log_promise'>,
): Promise<ToolOutcome> {
  const refusal = requireIdentity(ctx.session);
  if (refusal) return refusal;

  const { callId, shopkeeperId } = ctx.session;
  const [ledger, existing] = await Promise.all([
    ctx.repo.getLedger(shopkeeperId),
    ctx.repo.getPromiseForCall(callId),
  ]);
  const promise = { amount: args.amount, promiseDate: args.promise_date };
  if (existing && sameTerms(existing, promise)) return alreadySaved(existing);

  const today = istDate(ctx.now);
  const { outstanding } = computeDues(ledger, today);
  const policy = checkPromise({ ...promise, outstanding, today });
  if (!policy.ok) return fail('POLICY_REFUSED', policy.reason);

  if (existing) return replace(ctx, existing, promise);
  if (!(await ctx.repo.insertPromise({ callId, shopkeeperId, ...promise }))) {
    // Another request saved one a moment earlier: the latest terms still win.
    const winner = await ctx.repo.getPromiseForCall(callId);
    return winner ? replace(ctx, winner, promise) : fail('TEMPORARY_ERROR');
  }
  return ok(
    `Promise saved: ${describe(promise)}. Read it back to the caller to confirm.`,
    { saved: true, amount: promise.amount, promise_date: promise.promiseDate },
  );
}
