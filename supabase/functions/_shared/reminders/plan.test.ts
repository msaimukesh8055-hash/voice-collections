// supabase/functions/_shared/reminders/plan.test.ts
// Remind all (M5 test list): count, recently-called skipped, paused and do-not-call skipped,
// at most 10 at a time, order kept. FAKE ids.
import { assertEquals } from '@std/assert';
import { MAX_REMIND_ALL, planRemindAll, RECENT_CALL_MS } from './plan.ts';

const NOW = new Date('2026-11-02T06:30:00.000Z');
const ids = Array.from({ length: 14 }, (_, n) => `s${n}`);

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

Deno.test('plan › everyone due is called when nothing blocks them', () => {
  const plan = planRemindAll({
    due: ['a', 'b', 'c'],
    recentCalls: [],
    paused: [],
    doNotCall: [],
    now: NOW,
  });
  assertEquals(plan, {
    toCall: ['a', 'b', 'c'],
    skippedRecent: 0,
    skippedPaused: 0,
    skippedDoNotCall: 0,
    notIncluded: 0,
  });
});

Deno.test('plan › a call within the last hour skips; one just over an hour ago does not', () => {
  const plan = planRemindAll({
    due: ['a', 'b', 'c'],
    recentCalls: [
      { shopkeeperId: 'a', queuedAt: ago(RECENT_CALL_MS) },
      { shopkeeperId: 'b', queuedAt: ago(RECENT_CALL_MS + 1) },
    ],
    paused: [],
    doNotCall: [],
    now: NOW,
  });
  assertEquals([plan.toCall, plan.skippedRecent], [['b', 'c'], 1]);
});

Deno.test('plan › paused and do-not-call are skipped; each person counted once', () => {
  const plan = planRemindAll({
    due: ['a', 'b', 'c', 'd'],
    recentCalls: [
      { shopkeeperId: 'a', queuedAt: ago(1000) },
      { shopkeeperId: 'c', queuedAt: ago(1000) },
    ],
    paused: ['b', 'c', 'd'],
    doNotCall: ['d'],
    now: NOW,
  });
  assertEquals(plan, {
    toCall: [],
    skippedRecent: 2,
    skippedPaused: 1,
    skippedDoNotCall: 1,
    notIncluded: 0,
  });
});

Deno.test('plan › at most 10 are called; the rest are counted as not included', () => {
  const plan = planRemindAll({
    due: ids,
    recentCalls: [{ shopkeeperId: 's0', queuedAt: ago(10) }],
    paused: [],
    doNotCall: [],
    now: NOW,
  });
  assertEquals(plan.toCall, ids.slice(1, 1 + MAX_REMIND_ALL));
  assertEquals([plan.notIncluded, plan.skippedRecent], [3, 1]);
});
