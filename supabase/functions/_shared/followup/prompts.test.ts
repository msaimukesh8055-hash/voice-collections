// supabase/functions/_shared/followup/prompts.test.ts
import { assert, assertEquals } from '@std/assert';
import { CLAIM, facts, PROMISE } from './__fixtures__/facts.ts';
import {
  describeCallForLlm,
  FOLLOWUP_AGENT_PROMPT,
  FOLLOWUP_PROMPT_VERSION,
  MAX_PROMPT_TURNS,
  NOTE_PROMPT,
  ONE_PROMISE_RULE,
  PROMISE_LABEL,
} from './prompts.ts';

Deno.test('prompts › are drafts that ask for one JSON object', () => {
  assertEquals(FOLLOWUP_PROMPT_VERSION, 'v3');
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
  assert(
    text.includes(
      'Promise logged (final terms, after any changes in the call): 2,000 rupees by 2026-11-09',
    ),
  );
  assert(text.includes('Payment claim: 1,000 rupees paid on 2026-11-01 (cash), not confirmed'));
  assert(text.includes('Callback requests: hardship: Shop shut for a week.'));
  assert(
    text.includes('Asha: Namaste, I am Asha') && text.includes('Shopkeeper: Yes, Ramesh here.'),
  );
});

Deno.test('call description › nothing recorded and no transcript', () => {
  const text = describeCallForLlm(facts({ transcript: null }));
  assert(text.includes('Promise logged (final terms, after any changes in the call): none'));
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

Deno.test('prompts v3 › a promise changed mid-call is one promise, in the note and the summary', () => {
  assert(ONE_PROMISE_RULE.includes("report only the final terms from 'Promise logged'"));
  assert(ONE_PROMISE_RULE.includes('never list an earlier offer as a separate promise or payment'));
  const summaryStart = NOTE_PROMPT.indexOf('Also write a summary');
  assert(NOTE_PROMPT.slice(0, summaryStart).includes(ONE_PROMISE_RULE));
  assert(NOTE_PROMPT.slice(summaryStart).includes(ONE_PROMISE_RULE));
  assert(PROMISE_LABEL.startsWith('Promise logged'));
});

Deno.test('call description v3 › an offer changed mid-call: only the final terms are marked final', () => {
  const text = describeCallForLlm(facts({
    promise: { ...PROMISE, amount: 2000, promiseDate: '2026-11-25' },
    transcript: [
      { role: 'user', content: '₹1500.' },
      {
        role: 'assistant',
        content: 'So, one thousand five hundred rupees on Monday, 30th November. Is that right?',
      },
      { role: 'user', content: 'No no, I will pay 2000 rupees by 25th November.' },
      {
        role: 'assistant',
        content: 'Got it. So, two thousand rupees on Wednesday, 25th November. Is that correct?',
      },
    ],
  }));
  assert(text.includes(`${PROMISE_LABEL}: 2,000 rupees by 2026-11-25`));
  assertEquals(text.includes(`${PROMISE_LABEL}: 1,500`), false);
});
