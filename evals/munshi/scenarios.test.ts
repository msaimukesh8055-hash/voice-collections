// evals/munshi/scenarios.test.ts
// The 15 scenarios of the M8 test list: unique ids in order, all three languages, every
// scenario with a line to say, and the outcomes the plan names.
import { describe, expect, it } from 'vitest';
import { checksFor } from './checks.ts';
import { MUNSHI_SCENARIOS, WRAP_UP_ACCEPTED_AGO_MS } from './scenarios.ts';

function scenario(id: string): (typeof MUNSHI_SCENARIOS)[number] {
  const found = MUNSHI_SCENARIOS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no scenario ${id}`);
  return found;
}

describe('Munshi eval scenarios', () => {
  it('15 of them, 01 to 15, each with goals and at least one line', () => {
    expect(MUNSHI_SCENARIOS.map((candidate) => candidate.id)).toEqual(
      Array.from({ length: 15 }, (_, n) => String(n + 1).padStart(2, '0')),
    );
    expect(
      MUNSHI_SCENARIOS.every(
        (candidate) => candidate.owner.goals.length > 0 && candidate.owner.scriptedLines.length > 0,
      ),
    ).toBe(true);
  });

  it('cover Telugu, Hindi and English', () => {
    const count = (language: string): number =>
      MUNSHI_SCENARIOS.filter((candidate) => candidate.language === language).length;
    expect([count('te'), count('hi'), count('en')]).toEqual([4, 3, 8]);
  });

  it('expect the plan outcomes: one entry, two claims settled, a send, a reminder', () => {
    expect(scenario('06').outcome?.entries?.map((entry) => entry.amount)).toEqual([3000]);
    expect(Object.values(scenario('12').outcome?.claims ?? {})).toEqual(['confirmed', 'rejected']);
    expect(scenario('13').outcome?.sends).toEqual(['pending']);
    expect(scenario('11').outcome?.reminders).toHaveLength(1);
    expect(scenario('05').outcome).toBeUndefined();
  });

  it('scenario 15 starts 7 min 10 s into the call; every scenario gets the common checks', () => {
    expect(scenario('15').acceptedAgoMs).toBe(WRAP_UP_ACCEPTED_AGO_MS);
    expect(WRAP_UP_ACCEPTED_AGO_MS).toBe(430_000);
    expect(checksFor(scenario('01')).map((check) => check.id)).toContain('confirm_after_owner_yes');
  });
});
