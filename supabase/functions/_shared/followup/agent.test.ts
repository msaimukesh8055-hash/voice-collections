// supabase/functions/_shared/followup/agent.test.ts
// The agent for judgement calls (M5 Decision 4): checked JSON, Gemini fallback, safe default.
import { assert, assertEquals } from '@std/assert';
import { facts, PROMISE } from './__fixtures__/facts.ts';
import { fakeLlm } from './__fixtures__/fake-llm.ts';
import {
  AGENT_EVENT,
  DEFAULT_AGENT_REASON,
  parseAgentDecision,
  runFollowupAgent,
} from './agent.ts';
import { FOLLOWUP_AGENT_PROMPT } from './prompts.ts';

const TODAY = '2026-11-02';
const REMIND =
  '{"decision":"remind_again","remind_on":"2026-11-06","reason":"Willing, paid after Diwali before."}';
const PAUSE =
  '{"decision":"pause_reminders","remind_on":null,"reason":"Shop closed, illness in the family."}';

Deno.test('agent › a valid Sarvam answer becomes the next step', async () => {
  const { llm, calls } = fakeLlm({ [AGENT_EVENT]: [REMIND] });
  const result = await runFollowupAgent(llm, facts());
  assertEquals(result, {
    step: {
      kind: 'remind_again',
      date: '2026-11-06',
      reason: 'Willing, paid after Diwali before.',
    },
    llmPath: 'sarvam',
  });
  assertEquals(calls[0]?.system, FOLLOWUP_AGENT_PROMPT);
  assert(calls[0]?.message.includes('Shopkeeper: Ramesh (Ramesh Kirana)'));
});

Deno.test('agent › pause and owner-should-call decisions', async () => {
  const pause = await runFollowupAgent(fakeLlm({ [AGENT_EVENT]: [PAUSE] }).llm, facts());
  assertEquals(pause.step, {
    kind: 'pause_reminders',
    reason: 'Shop closed, illness in the family.',
  });
  const owner = '{"decision":"owner_should_call","reason":"Disputes the amount."}';
  const call = await runFollowupAgent(fakeLlm({ [AGENT_EVENT]: [owner] }).llm, facts());
  assertEquals(call.step, { kind: 'owner_should_call', reason: 'Disputes the amount.' });
});

Deno.test("agent › bad JSON from Sarvam → Gemini's answer is used", async () => {
  const { llm } = fakeLlm({ [AGENT_EVENT]: ['I think remind him.', PAUSE] });
  assertEquals((await runFollowupAgent(llm, facts())).llmPath, 'gemini');
});

Deno.test('agent › both bad → safe default "owner should call"', async () => {
  const { llm } = fakeLlm({ [AGENT_EVENT]: ['nope', '{"decision":"sue"}'] });
  assertEquals(await runFollowupAgent(llm, facts({ promise: PROMISE })), {
    step: { kind: 'owner_should_call', reason: DEFAULT_AGENT_REASON },
    llmPath: 'default',
  });
});

Deno.test('agent output › remind_again needs a date from tomorrow up to 14 days ahead', () => {
  const answer = (remindOn: string | null): string =>
    JSON.stringify({ decision: 'remind_again', remind_on: remindOn, reason: 'Willing.' });
  assertEquals(parseAgentDecision(answer(null), TODAY), null);
  assertEquals(parseAgentDecision(answer('2026-11-02'), TODAY), null);
  assertEquals(parseAgentDecision(answer('2026-11-17'), TODAY), null);
  assertEquals(parseAgentDecision(answer('2026-11-16'), TODAY)?.kind, 'remind_again');
  assertEquals(parseAgentDecision(answer('2026-11-03'), TODAY)?.kind, 'remind_again');
});

Deno.test('agent output › reason must be present and short; unknown decisions fail', () => {
  const long = JSON.stringify({ decision: 'owner_should_call', reason: 'x'.repeat(201) });
  assertEquals(parseAgentDecision(long, TODAY), null);
  assertEquals(parseAgentDecision('{"decision":"owner_should_call","reason":"  "}', TODAY), null);
  assertEquals(parseAgentDecision('{"decision":"call_family","reason":"x"}', TODAY), null);
  assertEquals(parseAgentDecision('not json', TODAY), null);
});

Deno.test('agent output › reason is one line', () => {
  const step = parseAgentDecision(
    '{"decision":"owner_should_call","reason":"Disputes\\n the   amount."}',
    TODAY,
  );
  assertEquals(step, { kind: 'owner_should_call', reason: 'Disputes the amount.' });
});
