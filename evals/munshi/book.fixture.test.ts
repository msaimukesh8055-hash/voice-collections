// evals/munshi/book.fixture.test.ts
// The eval book has what the 15 scenarios rely on (M8 C1 plan): 12 shopkeepers, Ramesh with
// history, two Sureshes, open claims, two equal credits; and each scenario gets its own copy.
import { describe, expect, it } from 'vitest';
import { computeDues } from '../../supabase/functions/_shared/ledger/dues.ts';
import { runOwnerTool } from '../../supabase/functions/_shared/owner-tools/registry.ts';
import {
  createEvalBook,
  EVAL_ENTRIES,
  EVAL_PAST_CALLS,
  EVAL_SHOPKEEPERS,
  EVAL_START,
  EVAL_TODAY,
  RAMESH,
  RAMESH_NEW_5000_ID,
  RAMESH_OLD_5000_ID,
  RAMESH_OUTSTANDING,
} from './book.fixture.ts';

const LATER = new Date(EVAL_START.getTime() + 60_000);

describe('Munshi eval book', () => {
  it('has 12 shopkeepers, two of them called Suresh', () => {
    expect(EVAL_SHOPKEEPERS).toHaveLength(12);
    expect(EVAL_SHOPKEEPERS.filter((shop) => shop.name === 'Suresh')).toHaveLength(2);
  });

  it("states Ramesh's balance as computeDues does, with two equal credits and two claims open", () => {
    const rameshEntries = EVAL_ENTRIES.filter((entry) => entry.shopkeeperId === RAMESH.id);
    expect(computeDues(rameshEntries, EVAL_TODAY).outstanding).toBe(RAMESH_OUTSTANDING);
    const credits = [RAMESH_OLD_5000_ID, RAMESH_NEW_5000_ID].map(
      (id) => EVAL_ENTRIES.find((entry) => entry.id === id)?.amount,
    );
    expect(credits).toEqual([5000, 5000]);
    expect(EVAL_ENTRIES.filter((entry) => entry.status === 'claimed')).toHaveLength(2);
    expect(EVAL_PAST_CALLS.filter((call) => call.shopkeeperId === RAMESH.id)).toHaveLength(2);
  });

  it("answers through the real registry, with Asha's calls in Ramesh's lookup", async () => {
    const book = createEvalBook();
    const { result } = await runOwnerTool(
      'lookup_shopkeeper',
      { name: 'Ramesh' },
      book.contextAt(LATER),
    );
    expect(result.ok && result.data['past_calls']).toBe(2);
    expect(result.say).toContain('outstanding 9,000 rupees');
  });

  it('gives each scenario a fresh copy', async () => {
    const first = createEvalBook();
    const prepared = await runOwnerTool(
      'prepare_remind',
      { name: 'Ramesh' },
      first.contextAt(EVAL_START),
    );
    expect(prepared.result.ok).toBe(true);
    await runOwnerTool('confirm_action', { action_ref: 'r1' }, first.contextAt(LATER));
    expect(first.state.queued).toEqual([RAMESH.id]);
    expect(createEvalBook().state.queued).toEqual([]);
  });

  it('moves Start call back for the wrap-up scenario', () => {
    const accepted = createEvalBook({ acceptedAgoMs: 430_000 }).contextAt(EVAL_START).ownerCall
      .acceptedAt;
    expect(accepted).toBe(new Date(EVAL_START.getTime() - 430_000).toISOString());
  });
});
