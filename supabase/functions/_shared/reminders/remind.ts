// supabase/functions/_shared/reminders/remind.ts
// The owner's reminder actions on WhatsApp (SPEC §6.4, §6.5, M5 Decision 8):
//   "who is due?" / "due"  → the due alert (promise check first), Remind per person
//   "call Ramesh" / "Ramesh ko yaad dilao" (any words, dry-run fix 5) → "Call Ramesh now?"
//                            [Call] [Cancel]; [Call] is the same Remind tap, so nothing is called
//                            before it
//   [Remind Ramesh] / "remind Ramesh" → one live call through queueCall (the M3 pre-call check):
//                            it rings the phone page for anyone (Live remind, pre-M6), one at a
//                            time; a second one waits as 'queued' and rings after the first
//   [Remind all due] / "remind all"   → "Call 6 people? (1 called in the last hour)" [Yes] [No]
//   Yes                    → the batch is queued (pre-call check per person), all simulated;
//                            they start in the worker, at most 4 at once
// Nobody is ever called without one of the owner's taps or messages.
import { z } from 'zod';
import { MAX_SIMULATED_AT_ONCE, queueReminders } from '../calls/queue.ts';
import { queueCall } from '../calls/queue-call.ts';
import { cardButtonId, noCallButtonId, remindButtonId } from '../cards/ids.ts';
import { type BotContext, findShopkeeper } from '../cards/context.ts';
import { CARD_TTL_MS } from '../cards/schemas.ts';
import type { BookShopkeeper } from '../db/book-repository.ts';
import type { DueAlert } from '../ledger/due-alert.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { LanguageSchema } from '../schemas/shopkeeper.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { blocks, type Reply, textIn, textReply, withEnglish } from '../whatsapp/replies.ts';
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
  const say = (line: (phrases: ReturnType<typeof reminderPhrasesFor>) => string): Reply =>
    textIn(language, (each) => line(reminderPhrasesFor(each)));
  const { repo, clock } = ctx.reminder;
  const result = await queueCall({ repo, clock }, { shopkeeperId: shopkeeper.id, mode: 'live' });
  if (!result.ok) return [say((phrases) => phrases.blocked(result.code, shopkeeper.name))];
  ctx.log('info', 'reminder_queued', { callId: result.callId, again: result.alreadyQueued });
  if (result.alreadyQueued) return [say((phrases) => phrases.alreadyCalling(shopkeeper.name))];
  return [say((phrases) => phrases.ringing(shopkeeper.name))];
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

/** "Call Ramesh now?" [Call] [Cancel] (dry-run fix 5). Nothing is queued here: [Call] is the
 * ordinary Remind tap (rm:), which runs remindOne → queueCall with all its checks. */
export function offerCall(shopkeeper: BookShopkeeper, language: Language): readonly Reply[] {
  const buttons = [
    { id: remindButtonId(shopkeeper.id, language), title: reminderPhrasesFor(language).callButton },
    { id: noCallButtonId(language), title: phrasesFor(language).cancel },
  ];
  return [withEnglish(language, (each) => ({
    kind: 'buttons',
    text: reminderPhrasesFor(each).callConfirm(shopkeeper.name),
    buttons,
  }))];
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
  if (plan.toCall.length === 0) return [textReply(blocks(phrases.nobodyToCall, skipped))];
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
    text: blocks(phrases.confirmAll(plan.toCall.length), skipped),
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
    simulated: batch.simulated.length,
    blocked: batch.blocked.length,
  });
  const count = batch.simulated.length;
  const text = blocks(
    count > 0 ? phrases.startedAll(count) : phrases.nobodyToCall,
    batch.blocked.length > 0 ? phrases.notCalled(batch.blocked.length) : null,
  );
  return [textReply(text)];
}
