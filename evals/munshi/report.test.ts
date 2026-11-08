// evals/munshi/report.test.ts
// The eval pass rule (M8 test list): all critical checks in every scenario, other checks in all
// but one, every scenario judged, casual average ≥ 4.0; the table and the results file name.
import { describe, expect, it } from 'vitest';
import { formatTable, MIN_CASUAL_AVERAGE, resultFileName, summarise } from './report.ts';
import type { ScenarioResult } from './runner.ts';

function result(id: string, overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    id,
    title: `Scenario ${id}`,
    language: 'en',
    end: 'munshi_ended',
    checks: [
      { id: 'confirm_after_owner_yes', critical: true, passed: true, detail: null },
      { id: 'short_turns', critical: false, passed: true, detail: null },
    ],
    judge: { casual: 4, language_match: 5, clarity: 4, note: '' },
    transcript: [],
    tools: [],
    munshiCalls: 4,
    munshiPromptChars: 40_000,
    ...overrides,
  };
}

const CRITICAL_FAIL = [
  { id: 'confirm_after_owner_yes', critical: true, passed: false, detail: 'x' },
];
const OTHER_FAIL = [{ id: 'short_turns', critical: false, passed: false, detail: 'y' }];

describe('summarise', () => {
  it('passes 15 clean, judged scenarios at casual 4.0', () => {
    const summary = summarise(Array.from({ length: 15 }, (_, n) => result(String(n + 1))));
    expect(summary).toMatchObject({
      passed: true,
      judged: 15,
      casualAverage: MIN_CASUAL_AVERAGE,
      languageAverage: 5,
    });
    expect([summary.munshiCalls, summary.munshiPromptChars]).toEqual([60, 600_000]);
  });

  it('one non-critical miss is allowed; one critical miss is not', () => {
    expect(summarise([result('1', { checks: OTHER_FAIL }), result('2')]).passed).toBe(true);
    const critical = summarise([result('1', { checks: CRITICAL_FAIL }), result('2')]);
    expect(critical.reasons).toEqual(['critical check failed in 1']);
  });

  it('fails on two non-critical misses, a missing judge score and a low casual average', () => {
    const summary = summarise([
      result('1', { checks: OTHER_FAIL, judge: null }),
      result('2', {
        checks: OTHER_FAIL,
        judge: { casual: 3, language_match: 3, clarity: 3, note: '' },
      }),
    ]);
    expect(summary.reasons).toEqual([
      'other checks failed in 2 scenarios (max 1)',
      'judged 1 of 2',
      'casual average 3 < 4',
    ]);
  });

  it('no judge scores at all → no averages, not passed', () => {
    const summary = summarise([result('1', { judge: null })]);
    expect([summary.casualAverage, summary.passed]).toEqual([null, false]);
    expect(summary.reasons).toContain('casual average - < 4');
  });
});

describe('formatTable', () => {
  it('one row per scenario, critical failures marked with !, then the verdict', () => {
    const results = [
      result('01', { checks: [...CRITICAL_FAIL, ...OTHER_FAIL] }),
      result('02', { judge: null }),
    ];
    const table = formatTable(results, summarise(results));
    expect(table).toContain('!confirm_after_owner_yes, short_turns');
    expect(table).toContain('- - -');
    expect(table).toContain('FAIL: critical check failed in 01');
    expect(table.split('\n')[0]).toContain('failed checks');
  });

  it('says PASS and cuts long titles', () => {
    const results = [result('01', { title: 'x'.repeat(60) })];
    const table = formatTable(results, summarise(results));
    expect(table).toContain('PASS');
    expect(table).not.toContain('x'.repeat(44));
  });
});

describe('resultFileName', () => {
  it('uses the date, then -2, -3 … when taken', () => {
    expect(resultFileName('2026-11-08', () => false)).toBe('2026-11-08.json');
    const taken = new Set(['2026-11-08.json', '2026-11-08-2.json']);
    expect(resultFileName('2026-11-08', (name) => taken.has(name))).toBe('2026-11-08-3.json');
  });
});
