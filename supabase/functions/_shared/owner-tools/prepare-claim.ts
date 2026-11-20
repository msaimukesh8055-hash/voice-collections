// supabase/functions/_shared/owner-tools/prepare-claim.ts
// prepare_claim(name, decision, amount?, entry_date?) and its executor (M8 B4, money). A claim is
// a payment a shopkeeper told Asha about (status 'claimed', never counted). "Received" makes it
// a confirmed payment; "not received" marks it rejected (Asha's next call raises it, as M5).
// The executor uses the same settleClaim compare-and-set as WhatsApp's [Confirm received] /
// [Not received] card, so a later tap on that card says "already done", and a claim already
// settled on WhatsApp is refused here. Claims that sound the same count as one (the newest).
// prepare_payment uses storeClaim too: a payment he reports that matches an open claim (same
// shopkeeper, same amount) is that claim, so it is accepted rather than saved twice (gate case 12).
// Rounds: prepare ① name + ref ② his entries ③ store; confirm ② claim + entries ③ settleClaim.
import type { BookEntry } from '../db/book-repository.ts';
import { formatRupees, formatShortDay } from '../format.ts';
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
import { balanceChange, balanceNow } from './read-back.ts';
import { paidBy, topLines } from './say.ts';
import type { ClaimDecision, OwnerToolArgs } from './schemas.ts';
import { ownerFail, ownerOk, type OwnerToolContext, type OwnerToolOutcome } from './types.ts';

export const ALREADY_SETTLED_SAY =
  'That claim was already settled (maybe on WhatsApp), so nothing was changed now.';

const SETTLED_STATUS: Readonly<Record<ClaimDecision, 'confirmed' | 'rejected'>> = {
  received: 'confirmed',
  not_received: 'rejected',
};

type Filters = Pick<OwnerToolArgs<'prepare_claim'>, 'amount' | 'entry_date'>;

export function openClaims(entries: readonly BookEntry[], filters: Filters): readonly BookEntry[] {
  return entries.filter((entry) =>
    entry.kind === 'payment' && entry.status === 'claimed' &&
    (filters.amount === undefined || toPaise(entry.amount) === toPaise(filters.amount)) &&
    (filters.entry_date === undefined || entry.entryDate === filters.entry_date)
  ).sort(newestFirst);
}

/** "2,000 rupees on Sun 1 Nov by upi" */
function claimFacts(entry: BookEntry): string {
  return `${formatRupees(entry.amount)} on ${formatShortDay(entry.entryDate)}` +
    paidBy(entry.paymentMode);
}

function whichClaim(claims: readonly BookEntry[]): OwnerToolOutcome {
  return ownerOk(
    `There is more than one payment claim: ${topLines(claims.map(claimFacts))}. Ask him which ` +
      'one, by the amount or the date. Nothing is ready yet.',
    { choice_count: claims.length },
  );
}

/** The claim and how he said it; `matched`: he reported it as a payment (prepare_payment). */
export interface ClaimToStore {
  readonly person: { readonly shopkeeperId: string; readonly label: string; readonly ref: string };
  readonly claimed: BookEntry;
  readonly decision: ClaimDecision;
  readonly matched: boolean;
}

export function storeClaim(
  { person, claimed, decision, matched }: ClaimToStore,
  entries: readonly BookEntry[],
  ctx: OwnerToolContext,
): Promise<OwnerToolOutcome> {
  const { shopkeeperId, label, ref } = person;
  const status = SETTLED_STATUS[decision];
  const before = outstandingAfter(entries, ctx.today);
  const after = outstandingAfter(entries, ctx.today, withStatus(claimed.id, status));
  const mark = decision === 'received' ? 'received' : 'not received';
  const lead = matched
    ? `${label} already told Asha they paid ${claimFacts(claimed)}, so this is that payment. ` +
      `Accept it as received (not a second payment).`
    : `${label} told Asha they paid ${claimFacts(claimed)}. Mark it as ${mark}.`;
  return storeAction(
    {
      kind: 'voice_claim',
      payload: { shopkeeperId, name: label, entryId: claimed.id, amount: claimed.amount, decision },
      readBack: `${lead} ${balanceChange(before, after)}`,
      data: { shopkeeper: label, decision, balance_after: after },
    },
    ref,
    ctx,
  );
}

export async function prepareClaim(
  ctx: OwnerToolContext,
  args: OwnerToolArgs<'prepare_claim'>,
): Promise<OwnerToolOutcome> {
  const person = await findPerson(ctx, args.name);
  if (!person.ok) return person.outcome;
  const { shopkeeper, label, ref } = person;
  const entries = await ctx.reads.book.listShopkeeperEntries(shopkeeper.id);
  const claims = openClaims(entries, args);
  const [claimed] = claims;
  if (claimed === undefined) return ownerFail('NO_OPEN_CLAIM');
  // Claims he cannot tell apart by voice (same amount, date and mode, e.g. said on two of Asha's
  // calls) count as one, the newest: asking "which one?" again could never get an answer.
  const sameToHim = claims.every((each) => claimFacts(each) === claimFacts(claimed));
  if (!sameToHim) return whichClaim(claims);
  return storeClaim(
    {
      person: { shopkeeperId: shopkeeper.id, label, ref },
      claimed,
      decision: args.decision,
      matched: false,
    },
    entries,
    ctx,
  );
}

export async function executeClaim(
  { payload, ctx, claim }: ExecuteInput<VoicePayload<'voice_claim'>>,
): Promise<Executed> {
  const { won, value: entries } = await claimWith(
    claim,
    ctx.reads.book.listShopkeeperEntries(payload.shopkeeperId),
  );
  if (!won) return LOST;
  const status = SETTLED_STATUS[payload.decision];
  const settled = await ctx.writes.book.settleClaim(payload.entryId, status);
  if (!settled) return refused(ownerFail('NO_OPEN_CLAIM', ALREADY_SETTLED_SAY));
  const after = outstandingAfter(entries, ctx.today, withStatus(payload.entryId, status));
  const mark = payload.decision === 'received' ? 'received' : 'not received';
  return done(ownerOk(
    `Done: ${payload.name}'s ${formatRupees(payload.amount)} is marked ${mark}. ` +
      balanceNow(after),
    { settled: status, outstanding: after },
  ));
}
