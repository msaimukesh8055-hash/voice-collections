// evals/munshi/runner.test.ts
// One scenario end to end with scripted fake models (no network): the real owner-tools registry
// on the eval book, the real confirm gate on simulated time, the checks and the judge.
//   - a good Munshi (read back, wait for yes, confirm) passes every check and saves one entry
//   - a Munshi that chains prepare → confirm is refused TOO_SOON by the code (no entry), and the
//     eval marks it critical
// Plus: a dry run of all 15 scenarios completes, and the wrap-up note reaches scenario 15.
import { describe, expect, it, vi } from 'vitest';
import type { ChatRequest } from '../../supabase/functions/_shared/llm/json-llm.ts';
import type { ChatProvider } from '../../supabase/functions/_shared/simulator/run.ts';
import { dryModels, type EvalModels } from './llms.ts';
import { EVAL_VARIABLES, runEvals, runScenario } from './runner.ts';
import { MUNSHI_SCENARIOS } from './scenarios.ts';

function scripted(answers: readonly string[], seen: ChatRequest[] = []): ChatProvider {
  let next = 0;
  return {
    name: 'sarvam',
    ask(request): Promise<string> {
      seen.push(request);
      const answer = answers[next];
      next += 1;
      return answer === undefined
        ? Promise.reject(new Error('script ran out'))
        : Promise.resolve(answer);
    },
  };
}

function say(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ say: text, tool: null, end_call: false, ...extra });
}

function line(text: string): string {
  return JSON.stringify({ say: text, hang_up: false });
}

const SCENARIO_04 = MUNSHI_SCENARIOS.find((scenario) => scenario.id === '04');
const CREDIT = {
  name: 'prepare_credit',
  args: { name: 'Ramesh', amount: 5000, due_date: '2026-11-15' },
};

function models(
  munshi: readonly string[],
  owner: readonly string[],
  seen: ChatRequest[] = [],
): EvalModels {
  const judge = scripted(['{"casual": 5, "language_match": 5, "clarity": 5, "note": ""}']);
  return { munshi: scripted(munshi, seen), owner: [scripted(owner)], judge };
}

describe('runScenario (scenario 04, add credit)', () => {
  if (!SCENARIO_04) throw new Error('no scenario 04');

  it('read back → his yes → confirm: one entry, every check passes, judged', async () => {
    const seen: ChatRequest[] = [];
    const munshi = [
      say('Haa, one second.', { tool: CREDIT }),
      say('Ramesh, 5,000 credit, due Sunday 15 November. Balance goes to 14,000. Correct?'),
      say('', { tool: { name: 'confirm_action', args: { action_ref: 'r1' } } }),
      say('Saved. Anything else, Srinivas?'),
      say('Okay, bye!', { end_call: true }),
    ];
    const owner = [
      line('Add 5000 credit for Ramesh, due on the 15th.'),
      line('Yes.'),
      line('No, bye.'),
    ];
    const result = await runScenario(SCENARIO_04, models(munshi, owner, seen), vi.fn());
    expect(result.checks.filter((check) => !check.passed)).toEqual([]);
    expect(result.tools.map((tool) => [tool.name, tool.ok])).toEqual([
      ['prepare_credit', true],
      ['confirm_action', true],
    ]);
    expect([result.end, result.judge?.casual, result.munshiCalls]).toEqual(['munshi_ended', 5, 5]);
    expect(seen[0]?.system).toContain(`Today is ${EVAL_VARIABLES.today}.`);
    expect(seen[0]?.tools).toHaveLength(10);
    expect(result.munshiPromptChars).toBeGreaterThan(5 * (seen[0]?.system.length ?? 0));
  });

  it('prepare then confirm in one turn: the code refuses TOO_SOON, the eval marks it critical', async () => {
    const munshi = [
      say('', { tool: CREDIT }),
      say('', { tool: { name: 'confirm_action', args: { action_ref: 'r1' } } }),
      say('Done! Anything else?'),
      say('Bye!', { end_call: true }),
    ];
    const owner = [line('Add 5000 credit for Ramesh, due on the 15th.'), line('No, bye.')];
    const result = await runScenario(SCENARIO_04, models(munshi, owner), vi.fn());
    expect(result.tools.map((tool) => tool.code)).toEqual([null, 'TOO_SOON']);
    const failedCritical = result.checks
      .filter((check) => check.critical && !check.passed)
      .map((check) => check.id);
    expect(failedCritical).toEqual(['confirm_after_owner_yes', 'outcome_entries']);
  });
});

describe('runScenario retries', () => {
  it("retries Munshi's model once after an error, so one timeout does not end the scenario", async () => {
    if (!SCENARIO_04) throw new Error('no scenario 04');
    const answers = [say('Anything else, Srinivas?'), say('Bye!', { end_call: true })];
    let calls = 0;
    const flaky: ChatProvider = {
      name: 'sarvam',
      ask(): Promise<string> {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('timeout'));
        return Promise.resolve(answers[calls - 2] ?? say('Bye!', { end_call: true }));
      },
    };
    const owner = scripted([line('Hi.'), line('No, bye.')]);
    const judge = scripted(['{"casual": 4, "language_match": 4, "clarity": 4}']);
    const result = await runScenario(
      SCENARIO_04,
      { munshi: flaky, owner: [owner], judge },
      vi.fn(),
    );
    expect([result.end, result.munshiCalls]).toEqual(['munshi_ended', 3]);
  });
});

describe('runEvals', () => {
  it('runs all 15 scenarios dry, in order, reporting each', async () => {
    const seen: string[] = [];
    const results = await runEvals(MUNSHI_SCENARIOS, {
      modelsFor: dryModels,
      log: vi.fn(),
      onResult: (result) => seen.push(result.id),
    });
    expect(seen).toEqual(MUNSHI_SCENARIOS.map((scenario) => scenario.id));
    expect(results.every((result) => result.end === 'munshi_ended')).toBe(true);
    const commonCritical = results.flatMap((result) =>
      result.checks.filter(
        (check) => check.critical && !check.id.startsWith('outcome_') && !check.passed,
      ),
    );
    expect(commonCritical).toEqual([]);
    const wrapUp = results.find((result) => result.id === '15');
    expect(wrapUp?.checks.find((check) => check.id === 'mentions_time_up')?.detail).toBe(
      'never told him',
    );
  });
});
