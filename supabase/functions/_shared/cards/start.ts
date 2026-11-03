// supabase/functions/_shared/cards/start.ts
// Turns "add credit" / "mark paid" (from a fixed command or an LLM suggestion) into the next
// card. Nothing is written to the ledger here: one clear match → Save card; several → pick list;
// no match → "add as a new shopkeeper?" for credit, "no such shopkeeper" for a payment.
import { dueDateOrDefault } from '../brain/dates.ts';
import type { BookShopkeeper } from '../db/book-repository.ts';
import { computeDues } from '../ledger/dues.ts';
import { matchShopkeepers } from '../ledger/match.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { type Reply, textReply } from '../whatsapp/replies.ts';
import type { BotContext } from './context.ts';
import { entryCard, newShopkeeperCard, pickCard } from './render.ts';
import { CARD_TTL_MS, type Draft, type EntryPayload } from './schemas.ts';
import type { Language } from '../schemas/shopkeeper.ts';

export interface EntryRequest {
  readonly name: string;
  readonly draft: Draft;
  readonly language: Language;
}

function expiresAt(ctx: BotContext): string {
  return new Date(ctx.now.getTime() + CARD_TTL_MS).toISOString();
}

/** Creates the Save card for one known shopkeeper. */
export async function createEntryCard(
  shopkeeper: BookShopkeeper,
  request: Omit<EntryRequest, 'name'>,
  ctx: BotContext,
): Promise<Reply> {
  const { draft, language } = request;
  const isCredit = draft.type === 'credit';
  const payload: EntryPayload = {
    shopkeeperId: shopkeeper.id,
    draft: {
      ...draft,
      dueDate: isCredit ? dueDateOrDefault(draft.dueDate, ctx.today) : null,
      dueDefaulted: isCredit && draft.dueDate === null,
    },
    language,
  };
  const [entries, actionId] = await Promise.all([
    ctx.book.listShopkeeperEntries(shopkeeper.id),
    ctx.book.createPendingAction({
      ownerId: ctx.owner.id,
      kind: 'entry',
      payload,
      expiresAt: expiresAt(ctx),
    }),
  ]);
  const outstanding = computeDues(entries, ctx.today).outstanding;
  return entryCard({ actionId, shopkeeper, payload, outstanding });
}

async function askWhichOne(
  request: EntryRequest,
  shopkeepers: readonly BookShopkeeper[],
  ctx: BotContext,
): Promise<Reply> {
  const payload = {
    name: request.name,
    candidates: shopkeepers.map((shopkeeper) => shopkeeper.id),
    draft: request.draft,
    language: request.language,
  };
  const actionId = await ctx.book.createPendingAction({
    ownerId: ctx.owner.id,
    kind: 'pick',
    payload,
    expiresAt: expiresAt(ctx),
  });
  return pickCard(actionId, { name: request.name, shopkeepers, language: request.language });
}

async function askNewShopkeeper(request: EntryRequest, ctx: BotContext): Promise<Reply> {
  const payload = { name: request.name, draft: request.draft, language: request.language };
  const actionId = await ctx.book.createPendingAction({
    ownerId: ctx.owner.id,
    kind: 'new_shopkeeper',
    payload,
    expiresAt: expiresAt(ctx),
  });
  return newShopkeeperCard(actionId, request.name, request.language);
}

export async function startEntry(
  request: EntryRequest,
  ctx: BotContext,
): Promise<readonly Reply[]> {
  const match = matchShopkeepers(request.name, ctx.shopkeepers);
  if (match.kind === 'one') return [await createEntryCard(match.shopkeeper, request, ctx)];
  if (match.kind === 'several') return [await askWhichOne(request, match.shopkeepers, ctx)];
  if (request.draft.type === 'payment') {
    return [textReply(phrasesFor(request.language).notFound(request.name))];
  }
  return [await askNewShopkeeper(request, ctx)];
}
