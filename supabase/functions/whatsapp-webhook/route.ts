// supabase/functions/whatsapp-webhook/route.ts
// One owner message → replies. Button taps run the card action; text goes through the brain
// (fixed commands first, then the LLM) and the resulting command runs from a typed lookup map.
// A voice note (M6) is heard first (Saaras) and then takes exactly the text path, in the
// language Saaras detected; its replies start with "🎤 Heard: …" so a misheard name is seen.
// Reads answer from the ledger; changes only ever create a card (nothing saved before Save).
// "pending" and a lookup also show the reliability score (the same one "X score" explains).
import { type Command, type CommandKind } from '../_shared/brain/commands.ts';
import { interpret } from '../_shared/brain/interpret.ts';
import type { BrainLlm } from '../_shared/brain/llm.ts';
import { handleCardTap } from '../_shared/cards/actions.ts';
import { handleClaimTap } from '../_shared/cards/claims.ts';
import { booksLinkFor, type BotContext, findShopkeeper } from '../_shared/cards/context.ts';
import { parseTap } from '../_shared/cards/ids.ts';
import { startEntry } from '../_shared/cards/start.ts';
import type { BookShopkeeper, MessagePath } from '../_shared/db/book-repository.ts';
import { matchShopkeepers } from '../_shared/ledger/match.ts';
import {
  type BookView,
  closedReply,
  lookupPickReply,
  pendingReply,
  shopkeeperReplies,
  shownPending,
} from '../_shared/ledger/views.ts';
import type { Language } from '../_shared/schemas/shopkeeper.ts';
import { piePng, pieSlices } from '../_shared/charts/pie.ts';
import { computeInsights } from '../_shared/ledger/insights.ts';
import { dashboardReply, insightsReplies } from '../_shared/ledger/insights-reply.ts';
import type { Hearing } from '../_shared/speech/hear.ts';
import type { InboundMessage } from '../_shared/whatsapp/inbound.ts';
import {
  dueAlertCommand,
  offerCall,
  offerRemindAll,
  remindOne,
} from '../_shared/reminders/remind.ts';
import { reminderPhrasesFor } from '../_shared/reminders/phrases.ts';
import { scoreReplies, scoresFor, scoreWithEntries } from '../_shared/reminders/score-explain.ts';
import { phrasesFor } from '../_shared/whatsapp/phrases.ts';
import { blocks, hasText, type Reply, textIn, textReply } from '../_shared/whatsapp/replies.ts';

export interface Outcome {
  readonly replies: readonly Reply[];
  readonly path: MessagePath;
  /** What was asked (command kind or tap kind) for the message log; never the text. */
  readonly command: string | null;
  /** Set when the owner sent a voice note that was heard: the voice reply's language (M6). */
  readonly speakIn?: Language;
}

export interface RouteDeps {
  readonly llm: BrainLlm;
  /** Demo-clock "now", for the LLM prompt's date. */
  readonly demoNow: Date;
  /** Voice note → what was said (M6); called only for voice messages. */
  readonly hear: (mediaId: string) => Promise<Hearing>;
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

/** "pending" with each shown row's score band (SPEC §6.1); only those rows are scored. */
async function pendingWithScores(ctx: BotContext): Promise<Reply> {
  const view = await bookView(ctx);
  const scores = await scoresFor(shownPending(view), ctx);
  return pendingReply({ ...view, scores });
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

const COMMANDS: { readonly [K in CommandKind]: Handler<K> } = {
  help: (_command, ctx) => Promise.resolve([textIn(ctx.language, (each) => phrasesFor(each).help)]),
  pending: async (_command, ctx) => [await pendingWithScores(ctx)],
  closed: async (_command, ctx) => [closedReply(await bookView(ctx))],
  lookup: (command, ctx) => {
    const match = matchShopkeepers(command.name, ctx.shopkeepers);
    if (match.kind === 'one') return showShopkeeper(match.shopkeeper, ctx, ctx.language);
    if (match.kind === 'several') {
      return Promise.resolve([lookupPickReply(command.name, match.shopkeepers, ctx.language)]);
    }
    const notFound = textIn(ctx.language, (each) => phrasesFor(each).notFound(command.name));
    return Promise.resolve([notFound]);
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

function didNotGet(language: Language): readonly Reply[] {
  return [textIn(language, (each) => `${phrasesFor(each).sorry}\n\n${phrasesFor(each).help}`)];
}

interface Said {
  readonly text: string;
  /** A voice note's language from Saaras wins over guessing from the words. */
  readonly spoken?: Language;
}

/**
 * A voice note's language from Saaras wins, except that Saaras' translit mode can report "en"
 * for Latin-letter Hindi or Telugu ("Salim ne 1,000 rupaye diye", dry-run fix 3): then the words
 * decide, so the card comes back in Hindi rather than English.
 */
export function replyLanguage(spoken: Language | undefined, fromWords: Language): Language {
  if (spoken === undefined) return fromWords;
  return spoken === 'en' && fromWords !== 'en' ? fromWords : spoken;
}

async function routeText(
  { text, spoken }: Said,
  ctx: BotContext,
  deps: RouteDeps,
): Promise<Outcome> {
  const isKnownName = (name: string): boolean =>
    matchShopkeepers(name, ctx.shopkeepers).kind !== 'none';
  const understood = await interpret(text, {
    today: ctx.today,
    now: deps.demoNow,
    llm: deps.llm,
    isKnownName,
  });
  const language = replyLanguage(spoken, understood.language);
  const withLanguage = { ...ctx, language };
  if (!understood.command) {
    return { replies: didNotGet(language), path: understood.path, command: 'unknown' };
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
  if (tap.kind === 'no_call') {
    const cancelled = textIn(tap.language, (each) => reminderPhrasesFor(each).callCancelled);
    return button([cancelled], 'no_call');
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

/** What Saaras heard is shown at most this long (a 30 s note is ~400 characters). */
export const MAX_HEARD_CHARS = 300;

function heardLine(text: string, language: Language): string {
  const shown = text.length > MAX_HEARD_CHARS ? `${text.slice(0, MAX_HEARD_CHARS - 1)}…` : text;
  return `${phrasesFor(language).heard}: “${shown}”`;
}

/** The Heard line in the reply's language and, for the twin, in English (what was heard stays
 * as heard; the twin translates it as free text). */
export interface HeardLine {
  readonly line: string;
  readonly english: string;
}

/** Puts the "Heard" line on top of the first reply that has a body. */
export function withHeard(replies: readonly Reply[], heard: HeardLine): readonly Reply[] {
  const [first, ...rest] = replies;
  if (!first || !hasText(first) || first.kind === 'template') {
    const alone: Reply = heard.line === heard.english
      ? textReply(heard.line)
      : { kind: 'text', text: heard.line, english: heard.english };
    return [alone, ...replies];
  }
  const english = first.english === undefined ? {} : {
    english: blocks(heard.english, first.english),
  };
  return [{ ...first, text: blocks(heard.line, first.text), ...english }, ...rest];
}

async function routeVoice(mediaId: string, ctx: BotContext, deps: RouteDeps): Promise<Outcome> {
  const heard = await deps.hear(mediaId);
  if (heard.kind !== 'heard') {
    const replies = [textReply(phrasesFor(ctx.language).voiceProblem[heard.kind])];
    return { replies, path: 'command', command: `voice_${heard.kind}` };
  }
  const outcome = await routeText({ text: heard.text, spoken: heard.language }, ctx, deps);
  const line = {
    line: heardLine(heard.text, heard.language),
    english: heardLine(heard.text, 'en'),
  };
  const replies = withHeard(outcome.replies, line);
  return { ...outcome, replies, speakIn: heard.language };
}

export function routeMessage(
  message: InboundMessage,
  ctx: BotContext,
  deps: RouteDeps,
): Promise<Outcome> {
  if (message.kind === 'tap') return routeTap(message.buttonId, ctx);
  if (message.kind === 'text') return routeText({ text: message.text }, ctx, deps);
  if (message.kind === 'voice') return routeVoice(message.mediaId, ctx, deps);
  const replies = [textReply(phrasesFor(ctx.language).textOnly)];
  return Promise.resolve({ replies, path: 'command', command: 'unsupported' });
}
