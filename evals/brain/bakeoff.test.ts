// evals/brain/bakeoff.test.ts
// The model bake-off's pure part: a model's answer through the production guards and checker,
// and one model's answers summed up. No network.
import { describe, expect, it } from 'vitest';
import {
  BAKEOFF_MODELS,
  type BakeoffResult,
  costPerThousand,
  judgeReply,
  median,
  summariseModel,
} from './bakeoff.ts';
import { BRAIN_CASES, type BrainCase } from './cases.ts';

function theCase(id: string): BrainCase {
  const found = BRAIN_CASES.find((one) => one.id === id);
  if (!found) throw new Error(id);
  return found;
}

const SARVAM = BAKEOFF_MODELS[0];
const META = { today: '2026-11-23', model: 'sarvam-105b' };
const PAID_SURESH = '{"intent":"mark_paid","name":"Suresh","amount":3000}';

function reply(content: string | null, ms = 500): Parameters<typeof judgeReply>[1] {
  return { content, ms, tokensIn: 1000, tokensOut: 20 };
}

describe('judgeReply', () => {
  it('a right answer passes; the name and amount it gave are kept', () => {
    const result = judgeReply(theCase('brain-07'), reply(PAID_SURESH), META);
    expect(result).toMatchObject({ passed: true, gotName: 'Suresh', gotAmount: 3000, ms: 500 });
  });

  it('applies the production guards: a promise never becomes a money card', () => {
    const promise = '{"intent":"mark_paid","name":"Ramesh","amount":5000}';
    expect(judgeReply(theCase('brain-19'), reply(promise), META).passed).toBe(true);
  });

  it('a failed call is a miss, not a crash', () => {
    const result = judgeReply(theCase('brain-07'), reply(null, 0), META);
    expect(result).toMatchObject({ passed: false, callFailed: true, got: 'none' });
  });

  it('no answer is never a pass, even where no command was the right result', () => {
    const result = judgeReply(theCase('brain-23'), reply(null, 0), META);
    expect(result).toMatchObject({ passed: false, detail: 'no answer (the call failed)' });
  });
});

describe('a call with no answer', () => {
  it('is a failed call, not a money mistake, and stays out of the times and tokens', () => {
    if (!SARVAM) throw new Error('needs a Sarvam model');
    const cases = [theCase('brain-07'), theCase('brain-06')];
    const results = [
      judgeReply(cases[0] as BrainCase, reply(PAID_SURESH, 400), META),
      judgeReply(cases[1] as BrainCase, reply(null, 0), META),
    ];
    const summary = summariseModel(SARVAM, cases, results);
    expect(summary).toMatchObject({
      casesPassed: 1,
      moneyFailures: 0,
      failedCalls: 1,
      p50Ms: 400,
      avgTokensIn: 1000,
      passed: false,
    });
    expect(summary.costPer1000Inr).toBe(costPerThousand(SARVAM, results.slice(0, 1)));
  });
});

describe('summing up one model', () => {
  it('typical time is the middle value', () => {
    expect(median([900, 100, 500])).toBe(500);
    expect(median([100, 200, 300, 400])).toBe(250);
    expect(median([])).toBe(0);
  });

  it('cost per 1,000 messages uses average tokens, the price and GST', () => {
    if (!SARVAM) throw new Error('needs a Sarvam model');
    const one = judgeReply(theCase('brain-07'), reply(PAID_SURESH), META);
    // 1000 × ₹10/1M + 20 × ₹25/1M = ₹0.0105 a message → ₹10.5 per 1,000 → ₹12.39 with GST.
    expect(costPerThousand(SARVAM, [one])).toBe(12.39);
    expect(costPerThousand(SARVAM, [])).toBe(0);
  });

  it('counts money mistakes, Telugu/Hindi passes, failed calls and the gate', () => {
    if (!SARVAM) throw new Error('needs a Sarvam model');
    const cases = [theCase('brain-07'), theCase('brain-11'), theCase('brain-01')];
    const results: BakeoffResult[] = [
      judgeReply(cases[0] as BrainCase, reply(PAID_SURESH, 400), META),
      judgeReply(cases[1] as BrainCase, reply('{"intent":"none"}', 800), META),
      judgeReply(cases[2] as BrainCase, reply(null, 0), META),
    ];
    const summary = summariseModel(SARVAM, cases, results);
    expect(summary).toMatchObject({
      cases: 3,
      casesPassed: 1,
      moneyCases: 2,
      moneyFailures: 1,
      indicCases: 1,
      indicPassed: 0,
      failedCalls: 1,
      p50Ms: 600,
      maxMs: 800,
      passed: false,
    });
  });
});
