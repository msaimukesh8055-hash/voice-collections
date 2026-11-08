// supabase/functions/_shared/owner-tools/prepare-payment.ts
// prepare_payment(name, amount?, full?) and its executor (M8 B2, money, 100% tested). "Paid in
// full" is his outstanding now (computeDues, as WhatsApp's Paid in full); a part payment needs
// an amount. More than he owes is allowed with a warning in the read-back (as WhatsApp's card).
// On confirm, a full payment is checked again: if his outstanding changed since the read-back,
// nothing is saved and Munshi reads the new figure back (he said yes to that amount, not to
// "whatever it is now"). Saved as a confirmed payment, source 'munshi'.
// Rounds: prepare ① name + ref ② his entries ③ store; confirm ② claim + entries ③ insert.
import { formatRupees } from '../format.ts';
import {
  checkedAmount,
  claimWith,
  done,
  type EntryChange,
  type Executed,
  type ExecuteInput,
  findPerson,
  LOST,
  outstandingAfter,
  refused,
  storeAction,
  type VoicePayload,
  wouldAdd,
} from './actions.ts';
import { balanceChange, balanceNow } from './read-back.ts';
import type { OwnerToolArgs } from './schemas.ts';
import { ownerFail, ownerOk, type OwnerToolContext, type OwnerToolOutcome } from './types.ts';

export const MISSING_AMOUNT_SAY = 'Ask him how much was paid, or whether everything was paid.';

function paymentOf(amount: number, today: string): EntryChange {
  return wouldAdd({ kind: 'payment', amount, dueDate: null }, today);
}

/** What he said: everything he owes, or an amount. */
type Requested = { readonly full: true } | { readonly full: false; readonly amount: number };

function requestedOf(args: OwnerToolArgs<'prepare_payment'>): Requested | null {
  if (args.full === 'yes') return { full: true };
  return args.amount === undefined ? null : { full: false, amount: args.amount };
}

type Amounted =
  | { readonly ok: true; readonly amount: number }
  | { readonly ok: false; readonly outcome: OwnerToolOutcome };

function amountFor(requested: Requested, outstanding: number, label: string): Amounted {
  if (requested.full) {
    if (outstanding <= 0) {
      return { ok: false, outcome: ownerFail('NOTHING_OWED', `${label} owes nothing right now.`) };
    }
    return { ok: true, amount: outstanding };
  }
  const amount = checkedAmount(requested.amount);
  if (amount === null) return { ok: false, outcome: ownerFail('AMOUNT_OUT_OF_RANGE') };
  return { ok: true, amount };
}

interface PaymentChange {
  readonly label: string;
  readonly amount: number;
  readonly full: boolean;
  readonly before: number;
  readonly after: number;
}

function readBackOf({ label, amount, full, before, after }: PaymentChange): string {
  const what = full
    ? `mark ${label} as paid in full: a payment of ${formatRupees(amount)}.`
    : `mark a payment of ${formatRupees(amount)} from ${label}.`;
  const over = amount > before
    ? ` That is more than he owes (${formatRupees(before)}); the extra shows as paid in advance.`
    : '';
  return `${what} ${balanceChange(before, after)}${over}`;
}

export async function preparePayment(
  ctx: OwnerToolContext,
  args: OwnerToolArgs<'prepare_payment'>,
): Promise<OwnerToolOutcome> {
  const requested = requestedOf(args);
  if (requested === null) return ownerFail('INVALID_ARGS', MISSING_AMOUNT_SAY);
  const person = await findPerson(ctx, args.name);
  if (!person.ok) return person.outcome;
  const { shopkeeper, label, ref } = person;
  const entries = await ctx.reads.book.listShopkeeperEntries(shopkeeper.id);
  const before = outstandingAfter(entries, ctx.today);
  const amounted = amountFor(requested, before, label);
  if (!amounted.ok) return amounted.outcome;
  const { amount } = amounted;
  const { full } = requested;
  const after = outstandingAfter(entries, ctx.today, paymentOf(amount, ctx.today));
  return storeAction(
    {
      kind: 'voice_payment',
      payload: { shopkeeperId: shopkeeper.id, name: label, amount, full },
      readBack: readBackOf({ label, amount, full, before, after }),
      data: { shopkeeper: shopkeeper.name, amount, full, balance_after: after },
    },
    ref,
    ctx,
  );
}

export async function executePayment(
  { payload, ctx, claim }: ExecuteInput<VoicePayload<'voice_payment'>>,
): Promise<Executed> {
  const { shopkeeperId, name, amount, full } = payload;
  const { won, value: entries } = await claimWith(
    claim,
    ctx.reads.book.listShopkeeperEntries(shopkeeperId),
  );
  if (!won) return LOST;
  if (full && outstandingAfter(entries, ctx.today) !== amount) {
    return refused(ownerFail('BOOK_CHANGED'));
  }
  await ctx.writes.book.insertEntry({
    shopkeeperId,
    kind: 'payment',
    amount,
    entryDate: ctx.today,
    dueDate: null,
    note: null,
    source: 'munshi',
  });
  const after = outstandingAfter(entries, ctx.today, paymentOf(amount, ctx.today));
  return done(ownerOk(
    `Done: payment of ${formatRupees(amount)} from ${name} saved. ${balanceNow(after)}`,
    { saved: 'payment', amount, outstanding: after },
  ));
}
