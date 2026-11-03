// supabase/functions/_shared/ledger/score.ts
// Shopkeeper reliability score (SPEC §9, M5 Decision 9), worked out in code so every number can
// be explained. Four parts, each rounded to a whole number, and the score is their sum:
//   paid on time    40 × credits paid by their due date ÷ credits judged (due in the last 6 months)
//   promises kept   30 × kept ÷ (kept + broken), promises dated in the last 6 months
//   current overdue 20 at 0 days, falling in a straight line to 0 at 60+ days
//   answers calls   10 × answered ÷ made (completed vs completed + declined + missed)
// A part with nothing to judge yet gets full marks: no bad record. Band "new" when there are
// fewer than 3 credits or under 30 days of history.
import { DAY_MS } from '../clock.ts';
import type { LedgerEntry, PromiseStatus } from '../schemas/ledger.ts';
import type { CallStatus } from '../schemas/shopkeeper.ts';
import { clearedCredits } from './cleared.ts';
import { computeDues, dueDateOf } from './dues.ts';
import { isWithinHistory } from './history.ts';

export const SCORE_WEIGHTS = {
  paidOnTime: 40,
  promisesKept: 30,
  currentOverdue: 20,
  answersCalls: 10,
} as const;
/** Days overdue at which the "current overdue" part reaches zero. */
export const OVERDUE_ZERO_DAYS = 60;
export const BAND_EDGES = { reliable: 75, watch: 50 } as const;
export const NEW_SHOPKEEPER = { minCredits: 3, minHistoryDays: 30 } as const;

const ENDED_CALLS: readonly CallStatus[] = ['completed', 'declined', 'missed'];

export type ScoreBand = 'reliable' | 'watch' | 'risky' | 'new';

export interface ScorePromise {
  readonly promiseDate: string;
  readonly status: PromiseStatus;
}

export interface ScoreInputs {
  readonly entries: readonly LedgerEntry[];
  readonly promises: readonly ScorePromise[];
  readonly callStatuses: readonly CallStatus[];
  /** India date on the demo clock. */
  readonly today: string;
}

export interface ScoreParts {
  readonly paidOnTime: number;
  readonly promisesKept: number;
  readonly currentOverdue: number;
  readonly answersCalls: number;
}

/** The raw counts behind the parts, kept so the score can be explained ("why is Ramesh 42?"). */
export interface ScoreFacts {
  readonly creditsJudged: number;
  readonly creditsOnTime: number;
  readonly promisesKept: number;
  readonly promisesBroken: number;
  readonly daysOverdue: number;
  readonly callsMade: number;
  readonly callsAnswered: number;
}

export interface Score {
  readonly score: number;
  readonly band: ScoreBand;
  readonly parts: ScoreParts;
  readonly facts: ScoreFacts;
}

export interface BandHistory {
  readonly credits: number;
  readonly firstEntryDate: string | null;
  readonly today: string;
}

/** weight × share, rounded; full marks when there is nothing to judge. */
function share(weight: number, good: number, total: number): number {
  return total === 0 ? weight : Math.round((weight * good) / total);
}

function creditFacts(entries: readonly LedgerEntry[], today: string): Pick<
  ScoreFacts,
  'creditsJudged' | 'creditsOnTime'
> {
  const inWindow = (dueDate: string): boolean => isWithinHistory(dueDate, today) || dueDate > today;
  const cleared = clearedCredits(entries).filter((credit) => inWindow(credit.dueDate));
  const pastDue = (dueDate: string): boolean => inWindow(dueDate) && dueDate < today;
  const creditsPastDue = entries
    .filter((entry) => entry.kind === 'credit' && entry.status === 'confirmed')
    .filter((entry) => pastDue(dueDateOf(entry))).length;
  const clearedPastDue = cleared.filter((credit) => pastDue(credit.dueDate)).length;
  const unpaidLate = creditsPastDue - clearedPastDue;
  return {
    creditsJudged: cleared.length + unpaidLate,
    creditsOnTime: cleared.filter((credit) => credit.clearedOn <= credit.dueDate).length,
  };
}

function promiseFacts(
  promises: readonly ScorePromise[],
  today: string,
): Pick<ScoreFacts, 'promisesKept' | 'promisesBroken'> {
  const recent = promises.filter((promise) => isWithinHistory(promise.promiseDate, today));
  return {
    promisesKept: recent.filter((promise) => promise.status === 'kept').length,
    promisesBroken: recent.filter((promise) => promise.status === 'broken').length,
  };
}

function callFacts(
  statuses: readonly CallStatus[],
): Pick<ScoreFacts, 'callsMade' | 'callsAnswered'> {
  return {
    callsMade: statuses.filter((status) => ENDED_CALLS.includes(status)).length,
    callsAnswered: statuses.filter((status) => status === 'completed').length,
  };
}

function overduePart(daysOverdue: number): number {
  const left = Math.max(0, OVERDUE_ZERO_DAYS - daysOverdue);
  return Math.round((SCORE_WEIGHTS.currentOverdue * left) / OVERDUE_ZERO_DAYS);
}

function partsOf(facts: ScoreFacts): ScoreParts {
  return {
    paidOnTime: share(SCORE_WEIGHTS.paidOnTime, facts.creditsOnTime, facts.creditsJudged),
    promisesKept: share(
      SCORE_WEIGHTS.promisesKept,
      facts.promisesKept,
      facts.promisesKept + facts.promisesBroken,
    ),
    currentOverdue: overduePart(facts.daysOverdue),
    answersCalls: share(SCORE_WEIGHTS.answersCalls, facts.callsAnswered, facts.callsMade),
  };
}

export function bandFor(score: number, history: BandHistory): ScoreBand {
  const { firstEntryDate, today } = history;
  const historyDays = firstEntryDate === null
    ? 0
    : (Date.parse(today) - Date.parse(firstEntryDate)) / DAY_MS;
  if (history.credits < NEW_SHOPKEEPER.minCredits) return 'new';
  if (historyDays < NEW_SHOPKEEPER.minHistoryDays) return 'new';
  if (score >= BAND_EDGES.reliable) return 'reliable';
  return score >= BAND_EDGES.watch ? 'watch' : 'risky';
}

function bandHistoryOf(entries: readonly LedgerEntry[], today: string): BandHistory {
  const confirmed = entries.filter((entry) => entry.status === 'confirmed');
  const first = confirmed.map((entry) => entry.entryDate).sort()[0] ?? null;
  const credits = confirmed.filter((entry) => entry.kind === 'credit').length;
  return { credits, firstEntryDate: first, today };
}

export function computeScore(inputs: ScoreInputs): Score {
  const { entries, today } = inputs;
  const facts: ScoreFacts = {
    ...creditFacts(entries, today),
    ...promiseFacts(inputs.promises, today),
    daysOverdue: computeDues(entries, today).daysOverdue,
    ...callFacts(inputs.callStatuses),
  };
  const parts = partsOf(facts);
  const score = parts.paidOnTime + parts.promisesKept + parts.currentOverdue + parts.answersCalls;
  return { score, band: bandFor(score, bandHistoryOf(entries, today)), parts, facts };
}
