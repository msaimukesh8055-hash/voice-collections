// supabase/functions/_shared/reminders/score-explain.ts
// "why is Ramesh 42?" / "Ramesh score" (SPEC §9, M5 Decision 9): the score worked out now, on
// the demo-clock date, with its four parts in one line each and the counts behind them. Plain
// code, no AI: every number can be traced to the book. Promises are judged in memory first (the
// same checker as get_dues), so the explanation matches what the next call would see.
import type { BotContext } from '../cards/context.ts';
import type { BookEntry, BookShopkeeper } from '../db/book-repository.ts';
import { summaryPhrasesFor } from '../followup/summary-phrases.ts';
import { applyPromiseChanges, checkPromises } from '../ledger/promise-check.ts';
import { computeScore, type Score } from '../ledger/score.ts';
import type { CallStatus, Language } from '../schemas/shopkeeper.ts';
import type { Repository } from '../db/repository.ts';
import { blocks, type Reply, textReply } from '../whatsapp/replies.ts';
import { reminderPhrasesFor } from './phrases.ts';

/** The score from a shopkeeper's entries (already read), his promises (judged in memory first)
 * and his call results. Used by "X score", "pending" and the lookup, so all three agree. */
export function scoreWithEntries(
  shopkeeperId: string,
  entries: readonly BookEntry[],
  ctx: BotContext,
): Promise<Score> {
  const reads = {
    listPromises: ctx.reminder.repo.listPromises,
    listCallStatuses: ctx.reminder.listCallStatuses,
  };
  return scoreFrom(reads, { shopkeeperId, entries, today: ctx.today });
}

/** What a score needs to read besides the entries (the dashboard passes its own, M6). */
export interface ScoreReads {
  readonly listPromises: Repository['listPromises'];
  readonly listCallStatuses: (shopkeeperId: string) => Promise<readonly CallStatus[]>;
}

export async function scoreFrom(
  reads: ScoreReads,
  input: { shopkeeperId: string; entries: readonly BookEntry[]; today: string },
): Promise<Score> {
  const { shopkeeperId, entries, today } = input;
  const [stored, callStatuses] = await Promise.all([
    reads.listPromises(shopkeeperId),
    reads.listCallStatuses(shopkeeperId),
  ]);
  const promises = applyPromiseChanges(stored, checkPromises(stored, entries, today));
  return computeScore({ entries, promises, callStatuses, today });
}

export async function scoreOf(shopkeeper: BookShopkeeper, ctx: BotContext): Promise<Score> {
  const entries = await ctx.book.listShopkeeperEntries(shopkeeper.id);
  return scoreWithEntries(shopkeeper.id, entries, ctx);
}

/** Scores for a few rows at once (the 10 "pending" shows), keyed by shopkeeper id. */
export async function scoresFor(
  rows: ReadonlyArray<
    { readonly shopkeeper: BookShopkeeper; readonly entries: readonly BookEntry[] }
  >,
  ctx: BotContext,
): Promise<ReadonlyMap<string, Score>> {
  const scores = await Promise.all(
    rows.map((row) => scoreWithEntries(row.shopkeeper.id, row.entries, ctx)),
  );
  return new Map(rows.map((row, index) => [row.shopkeeper.id, scores[index]!]));
}

/** "(nothing to judge yet, full marks)" instead of "0 of 0". */
function countsOr(text: string, total: number, language: Language): string {
  return total > 0
    ? text
    : `${text.replace(/ \(.*\)$/, '')} (${reminderPhrasesFor(language).nothingYet})`;
}

export function explainScore(name: string, score: Score, language: Language): string {
  const phrases = reminderPhrasesFor(language);
  const { parts, facts } = score;
  const promisesJudged = facts.promisesKept + facts.promisesBroken;
  const partLines = [
    countsOr(
      phrases.paidOnTime(parts.paidOnTime, facts.creditsOnTime, facts.creditsJudged),
      facts.creditsJudged,
      language,
    ),
    countsOr(
      phrases.promisesKept(parts.promisesKept, facts.promisesKept, promisesJudged),
      promisesJudged,
      language,
    ),
    phrases.currentOverdue(parts.currentOverdue, facts.daysOverdue),
    countsOr(
      phrases.answersCalls(parts.answersCalls, facts.callsAnswered, facts.callsMade),
      facts.callsMade,
      language,
    ),
  ];
  const title = phrases.scoreTitle(
    name,
    score.score,
    summaryPhrasesFor(language).bands[score.band],
  );
  return blocks(title, partLines, score.band === 'new' ? phrases.newBand : null);
}

export async function scoreReplies(
  shopkeeper: BookShopkeeper,
  ctx: BotContext,
  language: Language,
): Promise<readonly Reply[]> {
  return [textReply(explainScore(shopkeeper.name, await scoreOf(shopkeeper, ctx), language))];
}
