// supabase/functions/_shared/owner-tools/prepare-credit.ts
// prepare_credit(name, amount, due_date?) and its executor (M8 B2, money, 100% tested). The due
// date defaults to 15 days from today (SPEC §6.2, as WhatsApp); a past date is refused. The
// read-back names the person, the amount, the due date and the balance before and after. On
// confirm: one confirmed credit, source 'munshi', and the new balance from computeDues.
// Rounds: prepare ① name + ref ② his entries ③ store; confirm ② claim + entries ③ insert.
import { DEFAULT_DUE_DAYS } from '../brain/dates.ts';
import { addDays } from '../clock.ts';
import { formatRupees, formatShortDay } from '../format.ts';
import {
  checkedAmount,
  claimWith,
  done,
  type Executed,
  type ExecuteInput,
  findPerson,
  LOST,
  outstandingAfter,
  storeAction,
  type VoicePayload,
  wouldAdd,
} from './actions.ts';
import { balanceChange, balanceNow } from './read-back.ts';
import type { OwnerToolArgs } from './schemas.ts';
import { ownerFail, ownerOk, type OwnerToolContext, type OwnerToolOutcome } from './types.ts';

export async function prepareCredit(
  ctx: OwnerToolContext,
  args: OwnerToolArgs<'prepare_credit'>,
): Promise<OwnerToolOutcome> {
  const amount = checkedAmount(args.amount);
  if (amount === null) return ownerFail('AMOUNT_OUT_OF_RANGE');
  const dueDate = args.due_date ?? addDays(ctx.today, DEFAULT_DUE_DAYS);
  if (dueDate < ctx.today) return ownerFail('DATE_IN_PAST');
  const person = await findPerson(ctx, args.name);
  if (!person.ok) return person.outcome;
  const { shopkeeper, label, ref } = person;
  const entries = await ctx.reads.book.listShopkeeperEntries(shopkeeper.id);
  const before = outstandingAfter(entries, ctx.today);
  const after = outstandingAfter(
    entries,
    ctx.today,
    wouldAdd({ kind: 'credit', amount, dueDate }, ctx.today),
  );
  const readBack = `add a credit of ${formatRupees(amount)} for ${label}, due ` +
    `${formatShortDay(dueDate)}. ${balanceChange(before, after)}`;
  return storeAction(
    {
      kind: 'voice_credit',
      payload: { shopkeeperId: shopkeeper.id, name: label, amount, dueDate },
      readBack,
      data: { shopkeeper: shopkeeper.name, amount, due_date: dueDate, balance_after: after },
    },
    ref,
    ctx,
  );
}

export async function executeCredit(
  { payload, ctx, claim }: ExecuteInput<VoicePayload<'voice_credit'>>,
): Promise<Executed> {
  const { shopkeeperId, name, amount, dueDate } = payload;
  const { won, value: entries } = await claimWith(
    claim,
    ctx.reads.book.listShopkeeperEntries(shopkeeperId),
  );
  if (!won) return LOST;
  await ctx.writes.book.insertEntry({
    shopkeeperId,
    kind: 'credit',
    amount,
    entryDate: ctx.today,
    dueDate,
    note: null,
    source: 'munshi',
  });
  const after = outstandingAfter(
    entries,
    ctx.today,
    wouldAdd({ kind: 'credit', amount, dueDate }, ctx.today),
  );
  return done(ownerOk(
    `Done: credit of ${formatRupees(amount)} for ${name} saved, due ${formatShortDay(dueDate)}. ` +
      balanceNow(after),
    { saved: 'credit', amount, outstanding: after },
  ));
}
