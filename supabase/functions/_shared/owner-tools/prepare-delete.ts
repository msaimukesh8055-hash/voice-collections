// supabase/functions/_shared/owner-tools/prepare-delete.ts
// prepare_delete(name, kind?, amount?, entry_date?) and its executor (M8 B3, money, 100% tested).
// Only live (confirmed) entries can be deleted; claimed, rejected and already reversed ones are
// never offered. Any age is allowed (Saim, ADR-0018 amendment 4). With only the name (and maybe
// the kind) it is his newest entry; with an amount or a date and more than one fit, Munshi asks
// which one (up to 3 lines, newest first) and nothing is stored. Entries he cannot tell apart by
// voice (same kind, amount, date and due date) count as one: the newest is taken.
// Delete = reversal: confirm calls reverse_ledger_entry (confirmed → reversed + a
// ledger_reversals row with this owner call, at most once). Nothing is ever removed, and every
// money reader counts only confirmed entries, so the balance follows by itself.
// Rounds: prepare ① name + ref ② his entries ③ store; confirm ② claim + entries ③ the RPC.
import type { BookEntry } from '../db/book-repository.ts';
import { formatShortDay } from '../format.ts';
import { toPaise } from '../ledger/dues.ts';
import {
  claimWith,
  done,
  type Executed,
  type ExecuteInput,
  findPerson,
  LOST,
  outstandingAfter,
  refused,
  storeAction,
  type VoicePayload,
  withStatus,
} from './actions.ts';
import { newestFirst } from './lookup-shopkeeper.ts';
import { balanceChange, balanceNow, entryLine } from './read-back.ts';
import { topLines } from './say.ts';
import type { OwnerToolArgs } from './schemas.ts';
import { ownerFail, ownerOk, type OwnerToolContext, type OwnerToolOutcome } from './types.ts';

export const ALREADY_CHANGED_SAY = 'That entry was already changed, so nothing was changed now.';

type Filters = Omit<OwnerToolArgs<'prepare_delete'>, 'name'>;

function fits(entry: BookEntry, filters: Filters): boolean {
  if (filters.kind !== undefined && entry.kind !== filters.kind) return false;
  if (filters.amount !== undefined && toPaise(entry.amount) !== toPaise(filters.amount)) {
    return false;
  }
  return filters.entry_date === undefined || entry.entryDate === filters.entry_date;
}

/** His live entries that fit, newest first. */
export function deletable(entries: readonly BookEntry[], filters: Filters): readonly BookEntry[] {
  return entries.filter((entry) => entry.status === 'confirmed' && fits(entry, filters)).sort(
    newestFirst,
  );
}

/** What he can hear of an entry: two entries with the same words are the same to him. */
function spoken(entry: BookEntry): string {
  const due = entry.dueDate === null ? '' : `, due ${formatShortDay(entry.dueDate)}`;
  return `${entryLine(entry)}${due}`;
}

/** The entry to delete, or null when he must pick one of several he can tell apart. */
function chosen(
  newest: BookEntry,
  matches: readonly BookEntry[],
  filters: Filters,
): BookEntry | null {
  const narrowed = filters.amount !== undefined || filters.entry_date !== undefined;
  const sameToHim = matches.every((entry) => spoken(entry) === spoken(newest));
  return !narrowed || sameToHim ? newest : null;
}

function whichOne(matches: readonly BookEntry[]): OwnerToolOutcome {
  return ownerOk(
    `More than one entry fits: ${topLines(matches.map(spoken))}. Ask him which one, by the ` +
      'date. Nothing is ready to delete yet.',
    { choice_count: matches.length },
  );
}

export async function prepareDelete(
  ctx: OwnerToolContext,
  args: OwnerToolArgs<'prepare_delete'>,
): Promise<OwnerToolOutcome> {
  const { name: _name, ...filters } = args;
  const person = await findPerson(ctx, args.name);
  if (!person.ok) return person.outcome;
  const { shopkeeper, label, ref } = person;
  const entries = await ctx.reads.book.listShopkeeperEntries(shopkeeper.id);
  const matches = deletable(entries, filters);
  const [newest] = matches;
  if (newest === undefined) return ownerFail('NOTHING_TO_DELETE');
  const entry = chosen(newest, matches, filters);
  if (entry === null) return whichOne(matches);
  const before = outstandingAfter(entries, ctx.today);
  const after = outstandingAfter(entries, ctx.today, withStatus(entry.id, 'reversed'));
  const readBack = `delete ${label}'s ${entryLine(entry)}. It stays on record as reversed. ` +
    balanceChange(before, after);
  return storeAction(
    {
      kind: 'voice_delete',
      payload: {
        shopkeeperId: shopkeeper.id,
        name: label,
        entryId: entry.id,
        kind: entry.kind,
        amount: entry.amount,
        entryDate: entry.entryDate,
      },
      readBack,
      data: { shopkeeper: shopkeeper.name, entry_kind: entry.kind, balance_after: after },
    },
    ref,
    ctx,
  );
}

export async function executeDelete(
  { payload, ctx, claim }: ExecuteInput<VoicePayload<'voice_delete'>>,
): Promise<Executed> {
  const { won, value: entries } = await claimWith(
    claim,
    ctx.reads.book.listShopkeeperEntries(payload.shopkeeperId),
  );
  if (!won) return LOST;
  const reversed = await ctx.writes.book.reverseEntry(payload.entryId, ctx.ownerCall.id);
  if (!reversed) return refused(ownerFail('NOTHING_TO_DELETE', ALREADY_CHANGED_SAY));
  const after = outstandingAfter(entries, ctx.today, withStatus(payload.entryId, 'reversed'));
  return done(ownerOk(
    `Done: ${payload.name}'s ${entryLine(payload)} is reversed and kept on record. ` +
      balanceNow(after),
    { reversed: payload.kind, outstanding: after },
  ));
}
