// supabase/functions/whatsapp-webhook/route.ts
// One owner message → replies. Button taps run the card action; text goes through the brain
// (fixed commands first, then the LLM) and the resulting command runs from a typed lookup map.
// Reads answer from the ledger; changes only ever create a card (nothing saved before Save).
import { type Command, type CommandKind } from '../_shared/brain/commands.ts';
import { interpret } from '../_shared/brain/interpret.ts';
import type { BrainLlm } from '../_shared/brain/llm.ts';
import { handleCardTap } from '../_shared/cards/actions.ts';
import { handleClaimTap } from '../_shared/cards/claims.ts';
import { type BotContext, findShopkeeper } from '../_shared/cards/context.ts';
import { parseTap } from '../_shared/cards/ids.ts';
import { startEntry } from '../_shared/cards/start.ts';
import type { BookShopkeeper, MessagePath } from '../_shared/db/book-repository.ts';
import { matchShopkeepers } from '../_shared/ledger/match.ts';
import {
  closedReply,
  lookupPickReply,
  pendingReply,
  shopkeeperReplies,
} from '../_shared/ledger/views.ts';
import type { Language } from '../_shared/schemas/shopkeeper.ts';
import type { InboundMessage } from '../_shared/whatsapp/inbound.ts';
import { dueAlertCommand, offerRemindAll, remindOne } from '../_shared/reminders/remind.ts';
import { scoreReplies } from '../_shared/reminders/score-explain.ts';
import { phrasesFor } from '../_shared/whatsapp/phrases.ts';
import { type Reply, textReply } from '../_shared/whatsapp/replies.ts';

export interface Outcome {
  readonly replies: readonly Reply[];
  readonly path: MessagePath;
  /** What was asked (command kind or tap kind) for the message log; never the text. */
  readonly command: string | null;
}

export interface RouteDeps {
  readonly llm: BrainLlm;
  /** Demo-clock "now", for the LLM prompt's date. */
  readonly demoNow: Date;
}

type Handler<K extends CommandKind> = (
  command: Extract<Command, { kind: K }>,
  ctx: BotContext,
) => Promise<readonly Reply[]>;

async function showShopkeeper(
  shopkeeper: BookShopkeeper,
  ctx: BotContext,
  language: Language,
): Promise<readonly Reply[]> {
  const [entries, lastPromise] = await Promise.all([
    ctx.book.listShopkeeperEntries(shopkeeper.id),
    ctx.book.getLastPromise(shopkeeper.id),
  ]);
  return shopkeeperReplies({ shopkeeper, entries, lastPromise, today: ctx.today, language });
}

async function bookView(ctx: BotContext): Promise<Parameters<typeof pendingReply>[0]> {
  const entries = await ctx.book.listEntries(ctx.owner.id);
  return { shopkeepers: ctx.shopkeepers, entries, today: ctx.today, language: ctx.language };
}

/** Runs `run` for the one shopkeeper the name matches; asks for the shop name when it matches
 * several, so a reminder never goes to the wrong Praveen. */
function withOneShopkeeper(
  name: string,
  ctx: BotContext,
  run: (shopkeeper: BookShopkeeper) => Promise<readonly Reply[]>,
): Promise<readonly Reply[]> {
  const match = matchShopkeepers(name, ctx.shopkeepers);
  if (match.kind === 'one') return run(match.shopkeeper);
  const phrases = phrasesFor(ctx.language);
  if (match.kind === 'none') return Promise.resolve([textReply(phrases.notFound(name))]);
  const shops = match.shopkeepers.map((shopkeeper) => `• ${shopkeeper.shopName}`);
  return Promise.resolve([textReply([phrases.pickPrompt(name), ...shops].join('\n'))]);
}

const COMMANDS: { readonly [K in CommandKind]: Handler<K> } = {
  help: (_command, ctx) => Promise.resolve([textReply(phrasesFor(ctx.language).help)]),
  pending: async (_command, ctx) => [pendingReply(await bookView(ctx))],
  closed: async (_command, ctx) => [closedReply(await bookView(ctx))],
  lookup: (command, ctx) => {
    const match = matchShopkeepers(command.name, ctx.shopkeepers);
    if (match.kind === 'one') return showShopkeeper(match.shopkeeper, ctx, ctx.language);
    if (match.kind === 'several') {
      return Promise.resolve([lookupPickReply(command.name, match.shopkeepers, ctx.language)]);
    }
    return Promise.resolve([textReply(phrasesFor(ctx.language).notFound(command.name))]);
  },
  add_credit: (command, ctx) =>
    startEntry({
      name: command.name,
      draft: {
        type: 'credit',
        amount: command.amount,
        dueDate: command.dueDate,
        note: command.note,
      },
      language: ctx.language,
    }, ctx),
  mark_paid: (command, ctx) =>
    startEntry({
      name: command.name,
      draft: { type: 'payment', amount: command.amount, dueDate: null, note: null },
      language: ctx.language,
    }, ctx),
  due_alert: (_command, ctx) => dueAlertCommand(ctx, ctx.language),
  remind: (command, ctx) =>
    withOneShopkeeper(command.name, ctx, (found) => remindOne(found.id, ctx, ctx.language)),
  remind_all: (_command, ctx) => offerRemindAll(ctx, ctx.language),
  score: (command, ctx) =>
    withOneShopkeeper(command.name, ctx, (found) => scoreReplies(found, ctx, ctx.language)),
};

export function runCommand(command: Command, ctx: BotContext): Promise<readonly Reply[]> {
  const handler = COMMANDS[command.kind] as Handler<CommandKind>;
  return handler(command, ctx);
}

function didNotGet(language: Language): readonly Reply[] {
  const phrases = phrasesFor(language);
  return [textReply(`${phrases.sorry}\n\n${phrases.help}`)];
}

async function routeText(text: string, ctx: BotContext, deps: RouteDeps): Promise<Outcome> {
  const isKnownName = (name: string): boolean =>
    matchShopkeepers(name, ctx.shopkeepers).kind !== 'none';
  const understood = await interpret(text, {
    today: ctx.today,
    now: deps.demoNow,
    llm: deps.llm,
    isKnownName,
  });
  const withLanguage = { ...ctx, language: understood.language };
  if (!understood.command) {
    return { replies: didNotGet(understood.language), path: understood.path, command: 'unknown' };
  }
  const replies = await runCommand(understood.command, withLanguage);
  return { replies, path: understood.path, command: understood.command.kind };
}

async function routeTap(buttonId: string, ctx: BotContext): Promise<Outcome> {
  const tap = parseTap(buttonId);
  const button = (replies: readonly Reply[], command: string): Outcome => ({
    replies,
    path: 'button',
    command,
  });
  if (!tap) return button([textReply(phrasesFor(ctx.language).expired)], 'unknown_button');
  if (tap.kind === 'claim') {
    return button(await handleClaimTap(tap, ctx), tap.confirm ? 'claim_confirm' : 'claim_reject');
  }
  if (tap.kind === 'remind') {
    return button(await remindOne(tap.shopkeeperId, ctx, tap.language), 'remind');
  }
  if (tap.kind === 'remind_all') {
    return button(await offerRemindAll(ctx, tap.language), 'remind_all');
  }
  if (tap.kind === 'lookup') {
    const shopkeeper = findShopkeeper(ctx, tap.shopkeeperId);
    const replies = shopkeeper
      ? await showShopkeeper(shopkeeper, ctx, tap.language)
      : [textReply(phrasesFor(tap.language).expired)];
    return button(replies, 'lookup');
  }
  const replies = await handleCardTap(tap, ctx);
  return button(replies, tap.kind === 'pick' ? 'pick' : tap.verb);
}

export function routeMessage(
  message: InboundMessage,
  ctx: BotContext,
  deps: RouteDeps,
): Promise<Outcome> {
  if (message.kind === 'tap') return routeTap(message.buttonId, ctx);
  if (message.kind === 'text') return routeText(message.text, ctx, deps);
  const replies = [textReply(phrasesFor(ctx.language).textOnly)];
  return Promise.resolve({ replies, path: 'command', command: 'unsupported' });
}
