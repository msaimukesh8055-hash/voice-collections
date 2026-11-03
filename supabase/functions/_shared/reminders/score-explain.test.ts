// supabase/functions/_shared/reminders/score-explain.test.ts
// Score explain (M5 test list): the four parts, one line each, with the counts behind them; "full
// marks" when there is nothing to judge; the "New" note; every language. FAKE figures.
import { assertEquals, assertStringIncludes } from '@std/assert';
import type { Score } from '../ledger/score.ts';
import { SUPPORTED_LANGUAGES } from '../schemas/shopkeeper.ts';
import { explainScore } from './score-explain.ts';

const SCORE: Score = {
  score: 42,
  band: 'risky',
  parts: { paidOnTime: 20, promisesKept: 15, currentOverdue: 2, answersCalls: 5 },
  facts: {
    creditsJudged: 6,
    creditsOnTime: 3,
    promisesKept: 1,
    promisesBroken: 1,
    daysOverdue: 54,
    callsMade: 2,
    callsAnswered: 1,
  },
};

Deno.test('score explain › title and four lines with their counts', () => {
  const lines = explainScore('Ramesh', SCORE, 'en').split('\n');
  assertEquals(lines, [
    '📊 *Ramesh: 42/100* (Risky)',
    'Paid on time: 20/40 (3 of 6 credits paid by the due date)',
    'Promises kept: 15/30 (1 of 2 promises kept)',
    'Current overdue: 2/20 (54 days overdue now)',
    'Answers calls: 5/10 (1 of 2 calls answered)',
  ]);
});

Deno.test('score explain › nothing to judge → full marks said plainly; "New" is explained', () => {
  const fresh: Score = {
    score: 100,
    band: 'new',
    parts: { paidOnTime: 40, promisesKept: 30, currentOverdue: 20, answersCalls: 10 },
    facts: {
      creditsJudged: 0,
      creditsOnTime: 0,
      promisesKept: 0,
      promisesBroken: 0,
      daysOverdue: 0,
      callsMade: 0,
      callsAnswered: 0,
    },
  };
  const text = explainScore('Latha', fresh, 'en');
  assertStringIncludes(text, 'Paid on time: 40/40 (nothing to judge yet, full marks)');
  assertStringIncludes(text, 'Answers calls: 10/10 (nothing to judge yet, full marks)');
  assertStringIncludes(text, '"New"');
});

Deno.test('score explain › every language keeps the figures', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const text = explainScore('Ramesh', SCORE, language);
    assertStringIncludes(text, '42/100');
    assertStringIncludes(text, '20/40');
    assertEquals(text.split('\n').length, 5);
  }
});
