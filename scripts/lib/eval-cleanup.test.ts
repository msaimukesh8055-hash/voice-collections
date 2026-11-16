// scripts/lib/eval-cleanup.test.ts
import { describe, expect, it } from 'vitest';
import { CleanupRefused, type EvalOwnerRow, planCleanup } from './eval-cleanup.ts';

function owner(id: string, fields: Partial<EvalOwnerRow> = {}): EvalOwnerRow {
  return {
    id,
    isEval: true,
    evalAgent: 'asha',
    evalRun: id,
    createdAt: '2026-11-11T10:00:00Z',
    ...fields,
  };
}

describe('planCleanup', () => {
  it('keeps the newest run per agent and deletes the older ones', () => {
    const plan = planCleanup([
      owner('a1', { createdAt: '2026-11-11T10:00:00Z' }),
      owner('a2', { createdAt: '2026-11-12T10:00:00Z' }),
      owner('m1', { evalAgent: 'munshi', evalRun: 'run-1', createdAt: '2026-11-14T10:00:00Z' }),
      owner('m2', { evalAgent: 'munshi', evalRun: 'run-2', createdAt: '2026-11-15T10:00:00Z' }),
      owner('m3', { evalAgent: 'munshi', evalRun: 'run-2', createdAt: '2026-11-15T10:00:01Z' }),
    ]);
    expect([...plan.kept]).toEqual([
      ['asha', 'a2'],
      ['munshi', 'run-2'],
    ]);
    expect(plan.keepIds).toEqual(['a2', 'm2', 'm3']);
    expect(plan.deleteIds).toEqual(['a1', 'm1']);
  });

  it('a single run per agent deletes nothing', () => {
    expect(planCleanup([owner('a1')]).deleteIds).toEqual([]);
  });

  it('refuses the whole clean-up when any owner is not flagged as eval data', () => {
    expect(() => planCleanup([owner('a1'), owner('real', { isEval: false })])).toThrow(
      CleanupRefused,
    );
  });
});
