// supabase/functions/_shared/reminders/remind.ts
// The owner's reminder actions on WhatsApp (SPEC §6.4, §6.5, M5 Decision 8):
//   "who is due?" / "due"  → the due alert (promise check first), Remind per person
//   [Remind Ramesh] / "remind Ramesh" → one call through queueCall (the M3 pre-call check); the
//                            live shopkeeper rings the phone page, anyone else is simulated
//   [Remind all due] / "remind all"   → "Call 6 people? (1 called in the last hour)" [Yes] [No]
//   Yes                    → the batch is queued (pre-call check per person); simulated calls
//                            start in the worker, at most 4 at once
// Nobody is ever called without one of the owner's taps or messages.
import { z } from 'zod';
import { MAX_SIMULATED_AT_ONCE, queueReminders } from '../calls/queue.ts';
import { queueCall } from '../calls/queue-call.ts';
import { cardButtonId } from '../cards/ids.ts';
import { type BotContext, findShopkeeper } from '../cards/context.ts';
import { CARD_TTL_MS } from '../cards/schemas.ts';
import type { BookShopkeeper } from '../db/book-repository.ts';
import type { DueAlert } from '../ledger/due-alert.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { LanguageSchema } from '../schemas/shopkeeper.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { type Reply, textReply } from '../whatsapp/replies.ts';
import { dueAlertReplies } from './alert-replies.ts';
import { loadDueAlert } from './load-alert.ts';
import { reminderPhrasesFor } from './phrases.ts';
import { MAX_REMIND_ALL, planRemindAll, RECENT_CALL_MS, type RemindPlan } from './plan.ts';

export const RemindAllPayloadSchema = z.object({
  shopkeeperIds: z.array(z.uuid()).min(1).max(MAX_REMIND_ALL),
  language: LanguageSchema,
});
export type RemindAllPayload = z.infer<typeof RemindAllPayloadSchema>;

async function currentAlert(ctx: BotContext): Promise<DueAlert> {
  const source = { book: ctx.book, store: ctx.reminder.store, repo: ctx.reminder.repo };
  const scope = { ownerId: ctx.owner.id, shopkeepers: ctx.shopkeepers, today: ctx.today };
  return (await loadDueAlert(source, scope)).alert;
}

export async function dueAlertCommand(ctx: BotContext, language: Language): Promise<Reply[]> {
  return dueAlertReplies(await currentAlert(ctx), ctx.today, language);
}

async function remindShopkeeper(
  shopkeeper: BookShopkeeper,
  ctx: BotContext,
  language: Language,
): Promise<readonly Reply[]> {
  const phrases = reminderPhrasesFor(language);
  const { repo, clock } = ctx.reminder;
  const { liveShopkeeperId } = await repo.getDemoSettings();
  const mode = shopkeeper.id === liveShopkeeperId ? 'live' : 'simulated';
  const result = await queueCall({ repo, clock }, { shopkeeperId: shopkeeper.id, mode });
  if (!result.ok) return [textReply(phrases.blocked(result.code, shopkeeper.name))];
  ctx.log('info', 'reminder_queued', { callId: result.callId, mode, again: result.alreadyQueued });
  if (result.alreadyQueued) return [textReply(phrases.alreadyCalling(shopkeeper.name))];
  if (mode === 'live') return [textReply(phrases.ringing(shopkeeper.name))];
  ctx.reminder.startSimulations(1);
  return [textReply(phrases.simulatedStarted(shopkeeper.name))];
}

/** A Remind tap (by id) or "remind X" (already matched to one shopkeeper). */
export function remindOne(
  shopkeeperId: string,
  ctx: BotContext,
  language: Language,
): Promise<readonly Reply[]> {
  const shopkeeper = findShopkeeper(ctx, shopkeeperId);
  if (!shopkeeper) return Promise.resolve([textReply(phrasesFor(language).expired)]);
  return remindShopkeeper(shopkeeper, ctx, language);
}

async function planFor(ctx: BotContext): Promise<RemindPlan> {
  const { store, clock } = ctx.reminder;
  const now = clock();
  const [alert, recentCalls, paused, doNotCall] = await Promise.all([
    currentAlert(ctx),
    store.listCallsSince(new Date(now.getTime() - RECENT_CALL_MS)),
    store.listPausedShopkeepers(),
    store.listDoNotCall(ctx.owner.id),
  ]);
  const due = alert.people.map((person) => person.shopkeeper.id);
  return planRemindAll({ due, recentCalls, paused, doNotCall, now });
}

/** "Call 6 people?" [Yes] [No]: who will be called is fixed on the card, so Yes calls exactly
 * the people counted. Nothing is queued before Yes. */
export async function offerRemindAll(ctx: BotContext, language: Language): Promise<Reply[]> {
  const phrases = reminderPhrasesFor(language);
  const plan = await planFor(ctx);
  const skipped = phrases.skipped({
    recent: plan.skippedRecent,
    paused: plan.skippedPaused,
    doNotCall: plan.skippedDoNotCall,
    notIncluded: plan.notIncluded,
  });
  if (plan.toCall.length === 0) return [textReply([phrases.nobodyToCall, ...skipped].join('\n'))];
  const payload: RemindAllPayload = { shopkeeperIds: [...plan.toCall], language };
  const actionId = await ctx.book.createPendingAction({
    ownerId: ctx.owner.id,
    kind: 'remind_all',
    payload,
    expiresAt: new Date(ctx.now.getTime() + CARD_TTL_MS).toISOString(),
  });
  const common = phrasesFor(language);
  return [{
    kind: 'buttons',
    text: [phrases.confirmAll(plan.toCall.length), ...skipped].join('\n'),
    buttons: [
      { id: cardButtonId(actionId, 'yes'), title: common.yes },
      { id: cardButtonId(actionId, 'no'), title: common.no },
    ],
  }];
}

/** Runs after the card moved open → done (compare-and-set), so a double tap queues nothing. */
export async function startRemindAll(
  payload: RemindAllPayload,
  ctx: BotContext,
): Promise<readonly Reply[]> {
  const phrases = reminderPhrasesFor(payload.language);
  const { repo, store, clock } = ctx.reminder;
  const doNotCall = new Set(await store.listDoNotCall(ctx.owner.id));
  const shopkeepers = payload.shopkeeperIds
    .map((id) => findShopkeeper(ctx, id))
    .filter((shopkeeper): shopkeeper is BookShopkeeper => shopkeeper !== null);
  const targets = shopkeepers.map((shopkeeper) => ({
    shopkeeperId: shopkeeper.id,
    language: shopkeeper.language,
    doNotCall: doNotCall.has(shopkeeper.id),
  }));
  const batch = await queueReminders({ repo, store, clock }, targets);
  ctx.reminder.startSimulations(Math.min(batch.simulated.length, MAX_SIMULATED_AT_ONCE));
  ctx.log('info', 'remind_all_queued', {
    live: batch.live !== null,
    simulated: batch.simulated.length,
    blocked: batch.blocked.length,
  });
  const live = shopkeepers.find((shopkeeper) => shopkeeper.id === batch.live?.shopkeeperId);
  const liveName = live?.name ?? null;
  const count = batch.simulated.length + (batch.live ? 1 : 0);
  const lines = [
    count > 0 ? phrases.startedAll(count, liveName, batch.simulated.length) : phrases.nobodyToCall,
    ...(batch.blocked.length > 0 ? [phrases.notCalled(batch.blocked.length)] : []),
  ];
  return [textReply(lines.join('\n'))];
}
