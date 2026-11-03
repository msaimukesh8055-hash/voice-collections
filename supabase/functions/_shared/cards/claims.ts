// supabase/functions/_shared/cards/claims.ts
// The owner settles a payment Asha recorded as "claimed" (M4 Decision 7). Only the owner's
// [Confirm received] makes it count; [Not received] marks it rejected, and M5 gives that to
// Asha's next call. The update only touches a payment that is still 'claimed', so a second tap
// changes nothing and says "already done".
import { formatInr } from '../format.ts';
import { computeDues } from '../ledger/dues.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { type Reply, textReply } from '../whatsapp/replies.ts';
import { type BotContext, findShopkeeper } from './context.ts';
import type { Tap } from './ids.ts';

type ClaimTap = Extract<Tap, { kind: 'claim' }>;

export async function handleClaimTap(tap: ClaimTap, ctx: BotContext): Promise<readonly Reply[]> {
  const phrases = phrasesFor(tap.language);
  const settled = await ctx.book.settleClaim(tap.entryId, tap.confirm ? 'confirmed' : 'rejected');
  if (!settled) return [textReply(phrases.alreadyHandled)];
  const name = findShopkeeper(ctx, settled.shopkeeperId)?.name ?? '';
  if (!tap.confirm) return [textReply(phrases.claimRejected(name))];
  const entries = await ctx.book.listShopkeeperEntries(settled.shopkeeperId);
  const balance = formatInr(computeDues(entries, ctx.today).outstanding);
  return [textReply(phrases.claimConfirmed(name, balance))];
}
