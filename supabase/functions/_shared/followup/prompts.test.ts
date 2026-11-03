// supabase/functions/_shared/followup/prompts.test.ts
import { assert, assertEquals } from '@std/assert';
import { CLAIM, facts, PROMISE } from './__fixtures__/facts.ts';
import {
  describeCallForLlm,
  FOLLOWUP_AGENT_PROMPT,
  FOLLOWUP_PROMPT_VERSION,
  MAX_PROMPT_TURNS,
  NOTE_PROMPT,
} from './prompts.ts';

Deno.test('prompts › are drafts that ask for one JSON object', () => {
  assertEquals(FOLLOWUP_PROMPT_VERSION, 'v1');
  for (const prompt of [FOLLOWUP_AGENT_PROMPT, NOTE_PROMPT]) {
    assert(prompt.includes('Reply with one JSON object only'));
    assert(
      prompt.includes('Never invent amounts or dates') || prompt.includes('Never add amounts'),
    );
  }
});

Deno.test('prompts › the agent may only pick from the three next steps', () => {
  for (const decision of ['remind_again', 'owner_should_call', 'pause_reminders']) {
    assert(FOLLOWUP_AGENT_PROMPT.includes(decision));
  }
  assert(FOLLOWUP_AGENT_PROMPT.includes('If you are unsure, choose owner_should_call.'));
});

Deno.test('call description › facts, recorded items and the transcript, in plain lines', () => {
  const text = describeCallForLlm(facts({
    promise: PROMISE,
    claim: CLAIM,
    callbacks: [{ reason: 'hardship', summary: 'Shop shut for a week.' }],
  }));
  assert(text.startsWith('Today: Monday, 2026-11-02\nShopkeeper: Ramesh (Ramesh Kirana)'));
  assert(text.includes('Days overdue: 12. Broken promises in the last 6 months: 1.'));
  assert(text.includes('Promise logged: 2,000 rupees by 2026-11-09'));
  assert(text.includes('Payment claim: 1,000 rupees paid on 2026-11-01 (cash), not confirmed'));
  assert(text.includes('Callback requests: hardship: Shop shut for a week.'));
  assert(
    text.includes('Asha: Namaste, I am Asha') && text.includes('Shopkeeper: Yes, Ramesh here.'),
  );
});

Deno.test('call description › nothing recorded and no transcript', () => {
  const text = describeCallForLlm(facts({ transcript: null }));
  assert(text.includes('Promise logged: none'));
  assert(text.includes('Payment claim: none'));
  assert(text.includes('Callback requests: none'));
  assert(text.endsWith('Transcript: not available.'));
});

Deno.test('call description › a long transcript keeps only the newest turns', () => {
  const turns = Array.from({ length: MAX_PROMPT_TURNS + 5 }, (_, index) => ({
    role: 'user' as const,
    content: `turn ${index}`,
  }));
  const text = describeCallForLlm(facts({ transcript: turns }));
  assertEquals(text.includes('turn 4\n'), false);
  assert(text.includes('turn 5\n') && text.endsWith(`turn ${MAX_PROMPT_TURNS + 4}`));
});
