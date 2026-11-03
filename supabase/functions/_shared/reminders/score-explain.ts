// supabase/functions/_shared/reminders/score-explain.ts
// "why is Ramesh 42?" / "Ramesh score" (SPEC §9, M5 Decision 9): the score worked out now, on
// the demo-clock date, with its four parts in one line each and the counts behind them. Plain
// code, no AI: every number can be traced to the book. Promises are judged in memory first (the
// same checker as get_dues), so the explanation matches what the next call would see.
import type { BotContext } from '../cards/context.ts';
import type { BookShopkeeper } from '../db/book-repository.ts';
import { summaryPhrasesFor } from '../followup/summary-phrases.ts';
import { applyPromiseChanges, checkPromises } from '../ledger/promise-check.ts';
import { computeScore, type Score } from '../ledger/score.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { type Reply, textReply } from '../whatsapp/replies.ts';
import { reminderPhrasesFor } from './phrases.ts';

export async function scoreOf(shopkeeper: BookShopkeeper, ctx: BotContext): Promise<Score> {
  const [entries, stored, callStatuses] = await Promise.all([
    ctx.book.listShopkeeperEntries(shopkeeper.id),
    ctx.reminder.repo.listPromises(shopkeeper.id),
    ctx.reminder.listCallStatuses(shopkeeper.id),
  ]);
  const promises = applyPromiseChanges(stored, checkPromises(stored, entries, ctx.today));
  return computeScore({ entries, promises, callStatuses, today: ctx.today });
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
  const lines = [
    phrases.scoreTitle(name, score.score, summaryPhrasesFor(language).bands[score.band]),
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
  return score.band === 'new' ? [...lines, phrases.newBand].join('\n') : lines.join('\n');
}

export async function scoreReplies(
  shopkeeper: BookShopkeeper,
  ctx: BotContext,
  language: Language,
): Promise<readonly Reply[]> {
  return [textReply(explainScore(shopkeeper.name, await scoreOf(shopkeeper, ctx), language))];
}
