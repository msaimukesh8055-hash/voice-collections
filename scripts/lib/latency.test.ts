// scripts/lib/latency.test.ts
// Latency run maths (M8 test list "Latency lib: p50/p95 maths, fail threshold").
import { describe, expect, it } from 'vitest';
import {
  formatLatencyTable,
  LATENCY_BUDGET_MS,
  latencyProblems,
  percentile,
  RUNS_PER_TOOL,
  statsByTool,
} from './latency.ts';

const ONE_TO_TWENTY = Array.from({ length: 20 }, (_, n) => n + 1);

describe('percentile (nearest rank)', () => {
  it('p50 and p95 of 1..20 are the 10th and 19th values; order does not matter', () => {
    const shuffled = [...ONE_TO_TWENTY].reverse();
    expect([percentile(shuffled, 50), percentile(shuffled, 95)]).toEqual([10, 19]);
  });

  it('one sample is every percentile; none is 0', () => {
    expect([percentile([42], 5), percentile([42], 95), percentile([], 95)]).toEqual([42, 42, 0]);
  });
});

describe('statsByTool', () => {
  it('groups samples per tool in the order given, max included, missing tools count 0', () => {
    const samples = [
      ...ONE_TO_TWENTY.map((ms) => ({ tool: 'book_summary', ms })),
      { tool: 'cancel_action', ms: 7 },
    ];
    expect(statsByTool(samples, ['book_summary', 'cancel_action', 'prepare_send'])).toEqual([
      { tool: 'book_summary', count: 20, p50: 10, p95: 19, max: 20 },
      { tool: 'cancel_action', count: 1, p50: 7, p95: 7, max: 7 },
      { tool: 'prepare_send', count: 0, p50: 0, p95: 0, max: 0 },
    ]);
  });
});

describe('latencyProblems', () => {
  const fast = { tool: 'book_summary', count: RUNS_PER_TOOL, p50: 120, p95: 499, max: 900 };

  it('passes at p95 499 ms with all samples and no refusals (max is not gated)', () => {
    expect(latencyProblems([fast], [])).toEqual([]);
  });

  it(`fails at p95 ${LATENCY_BUDGET_MS} ms, on missing samples and on refusals`, () => {
    const slow = { ...fast, tool: 'prepare_delete', p95: LATENCY_BUDGET_MS };
    const short = { ...fast, tool: 'cancel_action', count: 19 };
    expect(latencyProblems([slow, short], ['CALL_NOT_AUTHORISED'])).toEqual([
      'prepare_delete p95 500 ms ≥ 500 ms',
      'cancel_action: 19 of 20 samples',
      'refused: CALL_NOT_AUTHORISED',
    ]);
  });
});

describe('formatLatencyTable', () => {
  it('server figures, round trip beside them, SLOW on a tool over budget', () => {
    const server = [
      { tool: 'book_summary', count: 20, p50: 120, p95: 210, max: 300 },
      { tool: 'prepare_delete', count: 20, p50: 300, p95: 610, max: 700 },
    ];
    const trip = [{ tool: 'book_summary', count: 20, p50: 250, p95: 380, max: 400 }];
    const lines = formatLatencyTable(server, trip).split('\n');
    expect(lines[0]).toContain('server p50');
    expect(lines[1]).toMatch(/^book_summary\s+20\s+120\s+210\s+300\s+250\s+380\s+400$/);
    expect(lines[2]).toMatch(/prepare_delete.*610.*-\s+-\s+-\s+SLOW$/);
  });
});
