// evals/sarvam/eval-data.ts
// The fake data one eval run needs, as database rows (M9 Build C). Sarvam Tests calls our real
// tool server, so each case gets a real call token on a real row. To keep that away from the
// trader's book, every run gets its own "eval owner": the bot, alerts, insights, scores and the
// dashboard all read by owner (the first one created), so they never see these rows. Nothing
// here touches an existing row.
import type { EvalCase } from './types.ts';

/** How eval owners are told apart from the real one by a person reading the table. */
export const EVAL_CITY = 'EVAL DATA (not a real owner)';
const BROKEN_PROMISE_AMOUNT = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface EvalIds {
  readonly shopkeeperId: string;
  /** The call id is the one-time call token Asha's tools check (ADR-0009). */
  readonly callId: string;
}

export interface EvalRows {
  readonly owner: Record<string, unknown>;
  readonly shopkeepers: readonly Record<string, unknown>[];
  readonly entries: readonly Record<string, unknown>[];
  readonly promises: readonly Record<string, unknown>[];
  readonly calls: readonly Record<string, unknown>[];
  readonly byCase: ReadonlyMap<string, EvalIds>;
}

export interface EvalDataOptions {
  /** India date of the run on the demo clock, "YYYY-MM-DD": what Asha's tools call today. */
  readonly today: string;
  /** Real time now: tool calls are accepted for 10 minutes after a call is accepted. */
  readonly now: Date;
  readonly newId: () => string;
  readonly owner: { readonly name: string; readonly businessName: string };
}

/** "YYYY-MM-DD" `days` before `today` (negative = after). */
export function daysBefore(today: string, days: number): string {
  const at = new Date(`${today}T00:00:00Z`).getTime() - days * DAY_MS;
  return new Date(at).toISOString().slice(0, 10);
}

/** What the shopkeeper owes going into the call: every credit in the setup. */
export function outstandingOf(evalCase: EvalCase): number {
  return evalCase.setup.credits.reduce((sum, credit) => sum + credit.amount, 0);
}

function rowsForCase(
  evalCase: EvalCase,
  ids: EvalIds & { ownerId: string },
  options: EvalDataOptions,
): Pick<EvalRows, 'shopkeepers' | 'entries' | 'promises' | 'calls'> {
  const { setup } = evalCase;
  const { today, now } = options;
  return {
    shopkeepers: [
      {
        id: ids.shopkeeperId,
        owner_id: ids.ownerId,
        name: setup.shopkeeperName,
        shop_name: setup.shopName,
        area: 'Eval',
        phone: '+91 00000 00000',
        language: 'te',
      },
    ],
    entries: setup.credits.map((credit) => ({
      shopkeeper_id: ids.shopkeeperId,
      kind: 'credit',
      amount: credit.amount,
      entry_date: daysBefore(today, credit.givenDaysAgo),
      due_date: daysBefore(today, credit.dueDaysAgo),
      status: 'confirmed',
      source: 'seed',
    })),
    promises: setup.brokenPromiseDaysAgo.map((daysAgo) => ({
      shopkeeper_id: ids.shopkeeperId,
      amount: BROKEN_PROMISE_AMOUNT,
      promise_date: daysBefore(today, daysAgo),
      status: 'broken',
    })),
    // "simulated" keeps the row out of the live phone line; "accepted" is what the tools require.
    calls: [
      {
        id: ids.callId,
        shopkeeper_id: ids.shopkeeperId,
        mode: 'simulated',
        status: 'accepted',
        language: 'te',
        accepted_at: now.toISOString(),
      },
    ],
  };
}

export function buildEvalRows(cases: readonly EvalCase[], options: EvalDataOptions): EvalRows {
  const ownerId = options.newId();
  const owner = {
    id: ownerId,
    name: options.owner.name,
    business_name: options.owner.businessName,
    city: EVAL_CITY,
    language: 'te',
  };
  const byCase = new Map<string, EvalIds>();
  const parts = cases.map((evalCase) => {
    const ids = { shopkeeperId: options.newId(), callId: options.newId() };
    byCase.set(evalCase.id, ids);
    return rowsForCase(evalCase, { ...ids, ownerId }, options);
  });
  return {
    owner,
    shopkeepers: parts.flatMap((part) => part.shopkeepers),
    entries: parts.flatMap((part) => part.entries),
    promises: parts.flatMap((part) => part.promises),
    calls: parts.flatMap((part) => part.calls),
    byCase,
  };
}
