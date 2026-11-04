// supabase/functions/_shared/cards/actions.ts
// Button taps on cards (M4 Decision 4). Each tap first moves the card out of 'open' with a
// compare-and-set, so a second tap (or Meta re-sending the tap) does nothing harmful:
//   Save   → open→saved, then the one ledger write; reply with the new balance and the
//            "View in books" link to that customer's page (reply links, cloud build)
//   Edit   → open→cancelled, "send the corrected line"
//   Cancel → open→cancelled, nothing saved
//   Yes/No → new shopkeeper (open→done) then the Save card / open→cancelled
//   pick   → open→done, then the Save card for the chosen shopkeeper
//   Remind all Yes/No (M5) → open→done, then the calls are queued / open→cancelled
// A card past its 30 minutes is marked expired and nothing is saved.
import type { ActionKind, ActionStatus, PendingAction } from '../db/book-repository.ts';
import { formatInr } from '../format.ts';
import { computeDues } from '../ledger/dues.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { blocks, type Reply, textIn, textReply } from '../whatsapp/replies.ts';
import { booksLinkFor, type BotContext, findShopkeeper } from './context.ts';
import type { CardVerb, Tap } from './ids.ts';
import {
  type EntryPayload,
  EntryPayloadSchema,
  NewShopkeeperPayloadSchema,
  PickPayloadSchema,
} from './schemas.ts';
import { createEntryCard } from './start.ts';
import { RemindAllPayloadSchema, startRemindAll } from '../reminders/remind.ts';

type CardTap = Extract<Tap, { kind: 'card' | 'pick' }>;
/** pickIndex: the tapped list row (-1 for buttons). */
type Step = (
  action: PendingAction,
  pickIndex: number,
  ctx: BotContext,
) => Promise<readonly Reply[]>;

function languageOf(action: PendingAction, fallback: Language): Language {
  const payload = action.payload as { language?: unknown };
  return payload.language === 'te' || payload.language === 'hi' || payload.language === 'en'
    ? payload.language
    : fallback;
}

/** The reply for a card that was already closed (or a tap that lost the race). */
function closedReply(status: ActionStatus, language: Language): readonly Reply[] {
  const phrases = phrasesFor(language);
  const lines: Readonly<Record<ActionStatus, string>> = {
    saved: phrases.alreadySaved,
    expired: phrases.expired,
    cancelled: phrases.alreadyHandled,
    done: phrases.alreadyHandled,
    open: phrases.alreadyHandled,
  };
  return [textReply(lines[status])];
}

async function lostRace(action: PendingAction, ctx: BotContext): Promise<readonly Reply[]> {
  const latest = await ctx.book.getPendingAction(action.id);
  return closedReply(latest?.status ?? 'expired', languageOf(action, ctx.language));
}

async function close(
  action: PendingAction,
  to: ActionStatus,
  ctx: BotContext,
): Promise<boolean> {
  return await ctx.book.transitionPendingAction(action.id, 'open', to);
}

async function save(action: PendingAction, ctx: BotContext): Promise<readonly Reply[]> {
  const payload: EntryPayload = EntryPayloadSchema.parse(action.payload);
  const phrases = phrasesFor(payload.language);
  if (!(await close(action, 'saved', ctx))) return lostRace(action, ctx);
  const { draft } = payload;
  try {
    await ctx.book.insertEntry({
      shopkeeperId: payload.shopkeeperId,
      kind: draft.type,
      amount: draft.amount,
      entryDate: ctx.today,
      dueDate: draft.type === 'credit' ? draft.dueDate : null,
      note: draft.note,
    });
  } catch (error) {
    ctx.log('error', 'card_save_failed', {
      actionId: action.id,
      error: error instanceof Error ? error.name : 'unknown',
    });
    await ctx.book.transitionPendingAction(action.id, 'saved', 'open');
    return [textReply(phrases.saveFailed)];
  }
  const [entries, link] = await Promise.all([
    ctx.book.listShopkeeperEntries(payload.shopkeeperId),
    booksLinkFor(ctx, payload.shopkeeperId),
  ]);
  const name = findShopkeeper(ctx, payload.shopkeeperId)?.name ?? '';
  const balance = formatInr(computeDues(entries, ctx.today).outstanding);
  return [textIn(payload.language, function savedLine(each): string {
    const words = phrasesFor(each);
    return blocks(words.saved(name, balance), link ? words.viewInBooks(link) : null);
  })];
}

async function cancel(
  action: PendingAction,
  ctx: BotContext,
  line: 'cancelled' | 'editHint',
): Promise<readonly Reply[]> {
  if (!(await close(action, 'cancelled', ctx))) return lostRace(action, ctx);
  return [textReply(phrasesFor(languageOf(action, ctx.language))[line])];
}

async function addShopkeeper(action: PendingAction, ctx: BotContext): Promise<readonly Reply[]> {
  const payload = NewShopkeeperPayloadSchema.parse(action.payload);
  if (!(await close(action, 'done', ctx))) return lostRace(action, ctx);
  const created = await ctx.book.insertShopkeeper({
    ownerId: ctx.owner.id,
    name: payload.name,
    shopName: payload.name,
    area: ctx.owner.city,
    phone: ctx.newPhone(),
    language: ctx.owner.language,
  });
  const next = { ...ctx, shopkeepers: [...ctx.shopkeepers, created] };
  const card = await createEntryCard(created, payload, next);
  return [textReply(phrasesFor(payload.language).newShopkeeperAdded(created.name)), card];
}

async function pick(
  action: PendingAction,
  pickIndex: number,
  ctx: BotContext,
): Promise<readonly Reply[]> {
  const payload = PickPayloadSchema.parse(action.payload);
  const chosenId = payload.candidates[pickIndex];
  const chosen = chosenId ? findShopkeeper(ctx, chosenId) : null;
  if (!chosen) return closedReply('expired', payload.language);
  if (!(await close(action, 'done', ctx))) return lostRace(action, ctx);
  return [await createEntryCard(chosen, payload, ctx)];
}

async function remindAll(action: PendingAction, ctx: BotContext): Promise<readonly Reply[]> {
  const payload = RemindAllPayloadSchema.parse(action.payload);
  if (!(await close(action, 'done', ctx))) return lostRace(action, ctx);
  return startRemindAll(payload, ctx);
}

const cancelled: Step = (action, _index, ctx) => cancel(action, ctx, 'cancelled');

/** Which taps each kind of card accepts, and what each does. */
const STEPS: Readonly<Record<ActionKind, Partial<Readonly<Record<CardVerb | 'pick', Step>>>>> = {
  entry: {
    save: (action, _index, ctx) => save(action, ctx),
    edit: (action, _index, ctx) => cancel(action, ctx, 'editHint'),
    cancel: cancelled,
  },
  new_shopkeeper: { yes: (action, _index, ctx) => addShopkeeper(action, ctx), no: cancelled },
  pick: { pick },
  remind_all: { yes: (action, _index, ctx) => remindAll(action, ctx), no: cancelled },
};

export async function handleCardTap(tap: CardTap, ctx: BotContext): Promise<readonly Reply[]> {
  const action = await ctx.book.getPendingAction(tap.actionId);
  if (!action) return closedReply('expired', ctx.language);
  const language = languageOf(action, ctx.language);
  if (action.status !== 'open') return closedReply(action.status, language);
  if (Date.parse(action.expiresAt) <= ctx.now.getTime()) {
    await ctx.book.transitionPendingAction(action.id, 'open', 'expired');
    return closedReply('expired', language);
  }
  const [verb, pickIndex] = tap.kind === 'pick' ? ['pick' as const, tap.index] : [tap.verb, -1];
  const step = STEPS[action.kind][verb];
  if (!step) return closedReply('expired', language);
  return step(action, pickIndex, ctx);
}
