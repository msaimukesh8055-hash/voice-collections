// supabase/functions/_shared/cards/full-payment.ts
// The lookup's next steps (M7 Decision 9):
//   [Paid in full] → at tap time, his current outstanding (computeDues on confirmed entries, the
//                    demo-clock today) on the normal payment card [Save] [Edit] [Cancel]. Nothing
//                    is saved before Save; the amount is never in the button id. Owes nothing by
//                    then → "Ramesh owes nothing right now."
//   [Part payment] → a hint with his name; the next "Ramesh paid 2000" makes the card as today.
//                    No waiting state is stored.
import { computeDues } from '../ledger/dues.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { type Reply, textIn, textReply } from '../whatsapp/replies.ts';
import { type BotContext, findShopkeeper } from './context.ts';
import { createEntryCard } from './start.ts';

export async function startFullPayment(
  shopkeeperId: string,
  ctx: BotContext,
  language: Language,
): Promise<readonly Reply[]> {
  const shopkeeper = findShopkeeper(ctx, shopkeeperId);
  if (!shopkeeper) return [textReply(phrasesFor(language).expired)];
  const entries = await ctx.book.listShopkeeperEntries(shopkeeper.id);
  const outstanding = computeDues(entries, ctx.today).outstanding;
  if (outstanding <= 0) {
    return [textIn(language, (each) => phrasesFor(each).owesNothing(shopkeeper.name))];
  }
  const draft = { type: 'payment', amount: outstanding, dueDate: null, note: null } as const;
  return [await createEntryCard(shopkeeper, { draft, language }, ctx)];
}

export function partPaymentHint(
  shopkeeperId: string,
  ctx: BotContext,
  language: Language,
): readonly Reply[] {
  const shopkeeper = findShopkeeper(ctx, shopkeeperId);
  if (!shopkeeper) return [textReply(phrasesFor(language).expired)];
  return [textIn(language, (each) => phrasesFor(each).partHint(shopkeeper.name))];
}
