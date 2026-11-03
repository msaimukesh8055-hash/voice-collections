// supabase/functions/_shared/followup/decide.test.ts
// The agent is asked only on mixed signals; every run is recorded with its path.
import { assertEquals } from '@std/assert';
import { CLAIM, FACT_CALL_ID, facts, PROMISE } from './__fixtures__/facts.ts';
import { fakeLlm } from './__fixtures__/fake-llm.ts';
import { AGENT_EVENT } from './agent.ts';
import { decideFollowup, followupRowFor, type RunContext, runRecord } from './decide.ts';
import type { NextStep } from './rules.ts';

const SHOPKEEPER_ID = '5e000000-0000-4000-8000-000000000001';
const PAUSE = '{"decision":"pause_reminders","reason":"Shop closed, illness."}';

function context(step: NextStep, path: 'rule' | 'agent' = 'rule'): RunContext {
  return {
    facts: facts(),
    decision: { path, step, signals: [], agentPath: path === 'agent' ? 'sarvam' : null },
    noteSource: 'code',
    transcript: 'ready',
  };
}

Deno.test('decide › clear case: rules only, no LLM call', async () => {
  const { llm, calls } = fakeLlm({ [AGENT_EVENT]: [PAUSE] });
  assertEquals(await decideFollowup(facts({ promise: PROMISE }), llm), {
    path: 'rule',
    step: { kind: 'check_promise', date: '2026-11-09' },
    signals: [],
    agentPath: null,
  });
  assertEquals(calls.length, 0);
});

Deno.test('decide › mixed signals: the agent decides', async () => {
  const { llm, calls } = fakeLlm({ [AGENT_EVENT]: [PAUSE] });
  const hardship = facts({ callbacks: [{ reason: 'hardship', summary: 'Illness.' }] });
  assertEquals(await decideFollowup(hardship, llm), {
    path: 'agent',
    step: { kind: 'pause_reminders', reason: 'Shop closed, illness.' },
    signals: ['hardship'],
    agentPath: 'sarvam',
  });
  assertEquals(calls.length, 1);
});

Deno.test('run record › path, decision, reasoning and audit fields', () => {
  assertEquals(runRecord(context({ kind: 'check_promise', date: '2026-11-09' })), {
    callId: FACT_CALL_ID,
    shopkeeperId: SHOPKEEPER_ID,
    path: 'rule',
    decision: 'check_promise',
    reasoning: 'Promise logged: check it on the promise date.',
    actions: {
      outcome: 'no_promise',
      signals: [],
      agent_path: null,
      note_source: 'code',
      transcript: 'ready',
      simulated: false,
    },
  });
  const agent = runRecord(context({ kind: 'owner_should_call', reason: 'Angry.' }, 'agent'));
  assertEquals([agent.path, agent.reasoning], ['agent', 'Angry.']);
});

Deno.test('follow-up rows › one per step that needs a later action', () => {
  const rows: readonly [NextStep, string | null, string | null][] = [
    [{ kind: 'check_promise', date: '2026-11-09' }, 'promise_check', '2026-11-09T09:00:00+05:30'],
    [{ kind: 'confirm_claim' }, 'claim_confirm', null],
    [{ kind: 'try_again' }, 'remind_again', null],
    [
      { kind: 'remind_again', date: '2026-11-06', reason: 'x' },
      'remind_again',
      '2026-11-06T09:00:00+05:30',
    ],
    [{ kind: 'owner_should_call', reason: 'x' }, 'owner_callback', null],
    [{ kind: 'pause_reminders', reason: 'x' }, 'pause_reminders', null],
  ];
  for (const [step, kind, scheduledFor] of rows) {
    const row = followupRowFor(context(step));
    assertEquals([row?.kind, row?.scheduledFor], [kind, scheduledFor]);
  }
});

Deno.test("follow-up rows › none for Asha's own callback or a wrong person", () => {
  assertEquals(followupRowFor(context({ kind: 'owner_callback', reason: 'x' })), null);
  assertEquals(followupRowFor(context({ kind: 'nothing_shared' })), null);
});

Deno.test('follow-up rows › a claim with a promise still gets the claim row', async () => {
  const decision = await decideFollowup(facts({ claim: CLAIM, promise: PROMISE }), fakeLlm().llm);
  const row = followupRowFor({ ...context(decision.step), decision });
  assertEquals(row?.kind, 'claim_confirm');
});
