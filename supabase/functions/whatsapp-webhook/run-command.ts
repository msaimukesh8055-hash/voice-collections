// supabase/functions/whatsapp-webhook/run-command.ts
// One understood command → replies, from a typed lookup map (no switch). Typed text, a voice
// note and a Menu row (M7) all end up here, so a tap does exactly what typing does. Reads answer
// from the ledger; changes only ever create a card (nothing saved before Save). "pending" and a
// lookup also show the reliability score (the same one "X score" explains).
import type { Command, CommandKind } from '../_shared/brain/commands.ts';
import { booksLinkFor, type BotContext } from '../_shared/cards/context.ts';
import { startEntry } from '../_shared/cards/start.ts';
import { piePng, pieSlices } from '../_shared/charts/pie.ts';
import type { BookShopkeeper } from '../_shared/db/book-repository.ts';
import { computeInsights } from '../_shared/ledger/insights.ts';
import { dashboardReply, insightsReplies } from '../_shared/ledger/insights-reply.ts';
import { matchShopkeepers } from '../_shared/ledger/match.ts';
import {
  type BookView,
  closedReply,
  lookupPickReply,
  pendingOpenList,
  pendingReply,
  shopkeeperReplies,
  shownPending,
} from '../_shared/ledger/views.ts';
import {
  dueAlertCommand,
  offerCall,
  offerRemindAll,
  remindOne,
} from '../_shared/reminders/remind.ts';
import { scoreReplies, scoresFor, scoreWithEntries } from '../_shared/reminders/score-explain.ts';
import type { Language } from '../_shared/schemas/shopkeeper.ts';
import { menuReply, sorryMenuReply } from '../_shared/whatsapp/menu.ts';
import { phrasesFor } from '../_shared/whatsapp/phrases.ts';
import { blocks, type Reply, textIn } from '../_shared/whatsapp/replies.ts';

type Handler<K extends CommandKind> = (
  command: Extract<Command, { kind: K }>,
  ctx: BotContext,
) => Promise<readonly Reply[]>;

/** One shopkeeper's lookup, then "What next for Ramesh?" with its buttons (M7). */
export async function showShopkeeper(
  shopkeeper: BookShopkeeper,
  ctx: BotContext,
  language: Language,
): Promise<readonly Reply[]> {
  const [entries, lastPromise, lastNote, booksLink] = await Promise.all([
    ctx.book.listShopkeeperEntries(shopkeeper.id),
    ctx.book.getLastPromise(shopkeeper.id),
    ctx.reminder.repo.getLastNote(shopkeeper.id),
    booksLinkFor(ctx, shopkeeper.id),
  ]);
  const score = await scoreWithEntries(shopkeeper.id, entries, ctx);
  const { today } = ctx;
  const view = { shopkeeper, entries, lastPromise, lastNote, score, today, language, booksLink };
  return shopkeeperReplies(view);
}

async function bookView(ctx: BotContext): Promise<BookView> {
  const entries = await ctx.book.listEntries(ctx.owner.id);
  return { shopkeepers: ctx.shopkeepers, entries, today: ctx.today, language: ctx.language };
}

/** "pending" with each shown row's score band (SPEC §6.1); only those rows are scored. M7: then
 * the same rows as an "Open a shopkeeper" list. */
async function pendingWithScores(ctx: BotContext): Promise<readonly Reply[]> {
  const view = await bookView(ctx);
  const scores = await scoresFor(shownPending(view), ctx);
  const list = pendingOpenList(view);
  return list ? [pendingReply({ ...view, scores }), list] : [pendingReply({ ...view, scores })];
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
  if (match.kind === 'none') {
    return Promise.resolve([textIn(ctx.language, (each) => phrasesFor(each).notFound(name))]);
  }
  const shops = match.shopkeepers.map((shopkeeper) => `• ${shopkeeper.shopName}`);
  const pick = textIn(ctx.language, (each) => blocks(phrasesFor(each).pickPrompt(name), shops));
  return Promise.resolve([pick]);
}

/** Figures, then the chart (uploaded to Meta) and the link, in parallel (M6, SPEC §6.6). */
async function showInsights(ctx: BotContext): Promise<readonly Reply[]> {
  const entries = await ctx.book.listEntries(ctx.owner.id);
  const insights = computeInsights(ctx.shopkeepers, entries, ctx.today);
  const rows = insights.top.map(({ shopkeeper }) => ({
    shopkeeper,
    entries: entries.filter((entry) => entry.shopkeeperId === shopkeeper.id),
  }));
  const { split } = insights;
  const [scores, chartId, dashboardLink] = await Promise.all([
    scoresFor(rows, ctx),
    split.total > 0 ? piePng(pieSlices(split)).then(ctx.web.uploadImage) : Promise.resolve(null),
    ctx.web.dashboardLink(),
  ]);
  return insightsReplies({ insights, scores, language: ctx.language, chartId, dashboardLink });
}

function lookup(name: string, ctx: BotContext): Promise<readonly Reply[]> {
  const match = matchShopkeepers(name, ctx.shopkeepers);
  if (match.kind === 'one') return showShopkeeper(match.shopkeeper, ctx, ctx.language);
  if (match.kind === 'several') {
    return Promise.resolve([lookupPickReply(name, match.shopkeepers, ctx.language)]);
  }
  return Promise.resolve([textIn(ctx.language, (each) => phrasesFor(each).notFound(name))]);
}

const COMMANDS: { readonly [K in CommandKind]: Handler<K> } = {
  help: (_command, ctx) => Promise.resolve([menuReply(ctx.language, ctx.owner.name)]),
  pending: (_command, ctx) => pendingWithScores(ctx),
  closed: async (_command, ctx) => [closedReply(await bookView(ctx))],
  lookup: (command, ctx) => lookup(command.name, ctx),
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
  call_request: (command, ctx) =>
    withOneShopkeeper(
      command.name,
      ctx,
      (found) => Promise.resolve(offerCall(found, ctx.language)),
    ),
  remind_all: (_command, ctx) => offerRemindAll(ctx, ctx.language),
  score: (command, ctx) =>
    withOneShopkeeper(command.name, ctx, (found) => scoreReplies(found, ctx, ctx.language)),
  insights: (_command, ctx) => showInsights(ctx),
  dashboard: async (_command, ctx) => [dashboardReply(await ctx.web.dashboardLink(), ctx.language)],
};

export function runCommand(command: Command, ctx: BotContext): Promise<readonly Reply[]> {
  const handler = COMMANDS[command.kind] as Handler<CommandKind>;
  return handler(command, ctx);
}

/** "Sorry, I didn't get that" with the Menu under it (M7 Decision 9). */
export function didNotGet(ctx: BotContext, language: Language): readonly Reply[] {
  return [sorryMenuReply(language, ctx.owner.name)];
}
