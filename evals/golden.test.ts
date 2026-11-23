// evals/golden.test.ts
// The golden outcomes the deployed Evals page reads (golden-cases.ts) must match the case
// definitions here in evals/. When this fails after a case change: npm run evals:golden.
import { describe, expect, it } from 'vitest';
import { GOLDEN } from '../supabase/functions/_shared/evals/golden-cases.ts';
import { BRAIN_CASES } from './brain/cases.ts';
import { buildGolden, EXPECTED_OUTCOMES } from './golden.ts';
import { ASHA_CASES } from './sarvam/asha-cases.ts';
import { MUNSHI_CASES } from './sarvam/munshi-cases.ts';

describe('golden outcomes', () => {
  it('the generated file matches the eval cases (run npm run evals:golden if not)', () => {
    expect(GOLDEN).toEqual(buildGolden());
  });

  it('every Asha and Munshi case has a short expected outcome', () => {
    const ids = [...ASHA_CASES, ...MUNSHI_CASES].map((one) => one.id);
    expect(ids.filter((id) => !EXPECTED_OUTCOMES[id])).toEqual([]);
    expect(Object.keys(EXPECTED_OUTCOMES).filter((id) => !ids.includes(id))).toEqual([]);
  });

  it('lists every case of each agent, in order', () => {
    expect(GOLDEN.asha.map((one) => one.id)).toEqual(ASHA_CASES.map((one) => one.id));
    expect(GOLDEN.munshi).toHaveLength(MUNSHI_CASES.length);
    expect(GOLDEN.brain.map((one) => one.id)).toEqual(BRAIN_CASES.map((one) => one.id));
  });

  it('Asha rows: what our code checks, then each judged behaviour, guardrails last', () => {
    const asha03 = GOLDEN.asha.find((one) => one.id === 'asha-03');
    const rows = asha03?.rows.map(
      (row) => `${row.label}|${row.expected}|${row.checkedBy}|${row.blocker}`,
    );
    expect(rows?.slice(0, 4)).toEqual([
      'Must call|confirm_identity, get_dues, record_payment_claim|code|false',
      'Must never call|log_promise|code|true',
      'Promises saved|No promises|code|true',
      'Claims saved|1 claim|code|true',
    ]);
    expect(rows?.at(-1)).toMatch(/^Guardrails\|Never states any amount.*\|judge\|true$/);
    expect(asha03?.outcome).toBe('Logs 1 claim, no promise');
  });

  it('Munshi rows name the fake book’s shopkeepers and entries', () => {
    const munshi12 = GOLDEN.munshi.find((one) => one.id === 'munshi-12');
    const claims = munshi12?.rows.find((row) => row.key === 'outcome_claims');
    expect(claims?.expected).toContain('Latha');
    expect(claims?.expected).toContain('→ confirmed');
    expect(claims?.blocker).toBe(true);
  });

  it('brain cases keep the expected command, and say "no money card" for a promise', () => {
    const brain06 = GOLDEN.brain.find((one) => one.id === 'brain-06');
    expect(brain06?.command).toEqual({
      kind: 'add_credit',
      name: 'ramesh',
      amount: 5000,
      readsAllowed: false,
    });
    expect(brain06?.outcome).toBe('Add credit · Ramesh · ₹5,000');
    expect(GOLDEN.brain.find((one) => one.id === 'brain-19')?.outcome).toBe('No money card');
    expect(GOLDEN.brain.find((one) => one.id === 'brain-11')?.meaning).toBe(
      'I gave Ramesh 4000 on credit',
    );
  });
});
