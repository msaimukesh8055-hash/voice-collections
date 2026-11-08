// supabase/functions/whatsapp-webhook/taps.ts
// A tapped button or list row → replies, from a typed lookup map per tap kind (no switch). Ids
// carry a database id and a language, never an amount (cards/ids.ts). M7: Menu rows and the
// [Menu] / [Pending] / [Due today] buttons run the same command as typing it; [Paid in full]
// shows a payment card (nothing saved before Save); [Part payment] shows a hint; the lookup's
// [Remind] is the due alert's Remind tap (one call, all pre-call checks).
import type { Command } from '../_shared/brain/commands.ts';
import { handleCardTap } from '../_shared/cards/actions.ts';
import { handleClaimTap } from '../_shared/cards/claims.ts';
import { type BotContext, findShopkeeper } from '../_shared/cards/context.ts';
import { partPaymentHint, startFullPayment } from '../_shared/cards/full-payment.ts';
import { type MenuTarget, parseTap, type Tap } from '../_shared/cards/ids.ts';
import { offerRemindAll, remindOne } from '../_shared/reminders/remind.ts';
import { reminderPhrasesFor } from '../_shared/reminders/phrases.ts';
import { hintReply, menuReply } from '../_shared/whatsapp/menu.ts';
import { phrasesFor } from '../_shared/whatsapp/phrases.ts';
import { type Reply, textIn, textReply } from '../_shared/whatsapp/replies.ts';
import { startOwnerCall } from './owner-call.ts';
import { runCommand, showShopkeeper } from './run-command.ts';

/** The replies and what was tapped (for the message log; never the text). */
export interface TapResult {
  readonly replies: readonly Reply[];
  readonly command: string;
}

type TapHandler<K extends Tap['kind']> = (
  tap: Extract<Tap, { kind: K }>,
  ctx: BotContext,
) => Promise<TapResult>;

/** Commands a Menu row runs as they are: no name or amount needed. */
type BareCommand = Extract<
  Command,
  { kind: 'pending' | 'due_alert' | 'closed' | 'insights' | 'dashboard' | 'remind_all' }
>;

function command(bare: BareCommand): (ctx: BotContext) => Promise<readonly Reply[]> {
  return (ctx) => runCommand(bare, ctx);
}

/** Each Menu row (and the [Menu] button), in the tap's language. */
const MENU_ACTIONS: Readonly<Record<MenuTarget, (ctx: BotContext) => Promise<readonly Reply[]>>> = {
  pending: command({ kind: 'pending' }),
  due: command({ kind: 'due_alert' }),
  add: (ctx) => Promise.resolve([hintReply('add', ctx.language)]),
  paid: (ctx) => Promise.resolve([hintReply('paid', ctx.language)]),
  closed: command({ kind: 'closed' }),
  insights: command({ kind: 'insights' }),
  dashboard: command({ kind: 'dashboard' }),
  remind_all: command({ kind: 'remind_all' }),
  menu: (ctx) => Promise.resolve([menuReply(ctx.language, ctx.owner.name)]),
  // M8: a single-use link to the /munshi call page.
  munshi: startOwnerCall,
};

async function lookupTap(
  tap: Extract<Tap, { kind: 'lookup' }>,
  ctx: BotContext,
): Promise<TapResult> {
  const shopkeeper = findShopkeeper(ctx, tap.shopkeeperId);
  const replies = shopkeeper
    ? await showShopkeeper(shopkeeper, ctx, tap.language)
    : [textReply(phrasesFor(tap.language).expired)];
  return { replies, command: 'lookup' };
}

async function cardTap(
  tap: Extract<Tap, { kind: 'card' | 'pick' }>,
  ctx: BotContext,
): Promise<TapResult> {
  const replies = await handleCardTap(tap, ctx);
  return { replies, command: tap.kind === 'pick' ? 'pick' : tap.verb };
}

const TAPS: { readonly [K in Tap['kind']]: TapHandler<K> } = {
  card: cardTap,
  pick: cardTap,
  claim: async (tap, ctx) => ({
    replies: await handleClaimTap(tap, ctx),
    command: tap.confirm ? 'claim_confirm' : 'claim_reject',
  }),
  lookup: lookupTap,
  remind: async (tap, ctx) => ({
    replies: await remindOne(tap.shopkeeperId, ctx, tap.language),
    command: 'remind',
  }),
  remind_all: async (tap, ctx) => ({
    replies: await offerRemindAll(ctx, tap.language),
    command: 'remind_all',
  }),
  no_call: (tap) =>
    Promise.resolve({
      replies: [textIn(tap.language, (each) => reminderPhrasesFor(each).callCancelled)],
      command: 'no_call',
    }),
  menu: async (tap, ctx) => ({
    replies: await MENU_ACTIONS[tap.item]({ ...ctx, language: tap.language }),
    command: `menu_${tap.item}`,
  }),
  full_payment: async (tap, ctx) => ({
    replies: await startFullPayment(tap.shopkeeperId, ctx, tap.language),
    command: 'paid_in_full',
  }),
  part_payment: (tap, ctx) =>
    Promise.resolve({
      replies: partPaymentHint(tap.shopkeeperId, ctx, tap.language),
      command: 'part_payment',
    }),
};

/** An id we never sent → "this card has expired", nothing done. */
export function runTap(buttonId: string, ctx: BotContext): Promise<TapResult> {
  const tap = parseTap(buttonId);
  if (!tap) {
    const replies = [textReply(phrasesFor(ctx.language).expired)];
    return Promise.resolve({ replies, command: 'unknown_button' });
  }
  const handler = TAPS[tap.kind] as TapHandler<Tap['kind']>;
  return handler(tap, ctx);
}
