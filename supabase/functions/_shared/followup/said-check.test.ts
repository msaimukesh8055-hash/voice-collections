// supabase/functions/_shared/followup/said-check.test.ts
// CP3 B-H2: an LLM-written "Summary" line reaches WhatsApp only when every figure in it is the
// call's own (saved promise, claim, today, or said on the call); otherwise just that line is
// dropped. Fake data only.
import { assertEquals, assertStringIncludes } from '@std/assert';
import { replyText } from '../whatsapp/replies.ts';
import { CLAIM, facts, PROMISE } from './__fixtures__/facts.ts';
import { checkedSaidLines } from './said-check.ts';
import { buildSummary } from './summary.ts';

Deno.test('said check › figures from the saved promise or claim are kept', () => {
  const lines = ['Will pay ₹2,000 by 9 Nov.', 'Calm and polite.'];
  assertEquals(checkedSaidLines(lines, facts({ promise: PROMISE })), lines);
  const claimLine = `Says he paid ₹${CLAIM.amount.toLocaleString('en-IN')}.`;
  assertEquals(checkedSaidLines([claimLine], facts({ claim: CLAIM })), [claimLine]);
});

Deno.test('said check › a figure said on the call is kept, even if nothing was saved', () => {
  const call = facts({
    transcript: [
      { role: 'assistant', content: 'May I know when you can pay?' },
      { role: 'user', content: 'I can give 1,500 after the 20th.' },
    ],
  });
  assertEquals(checkedSaidLines(['Offered ₹1,500 after the 20th.'], call), [
    'Offered ₹1,500 after the 20th.',
  ]);
});

Deno.test('said check › only the line with an invented figure is dropped', () => {
  const lines = ['Will pay ₹5,000 by 9 Nov.', 'Calm; travelling till Friday.'];
  assertEquals(checkedSaidLines(lines, facts({ promise: PROMISE })), [
    'Calm; travelling till Friday.',
  ]);
});

Deno.test('said check › a wrong date and a figure in words are dropped', () => {
  const call = facts({ promise: PROMISE });
  assertEquals(checkedSaidLines(['Will pay ₹2,000 by 19 Nov.'], call), []);
  assertEquals(checkedSaidLines(['Will pay 2 thousand soon.'], call), []);
  assertEquals(checkedSaidLines(['సోమవారం లోపు ₹౫,౦౦౦ కడతానన్నారు.'], call), []);
});

Deno.test('said check › the WhatsApp summary leaves out only the unchecked line', () => {
  const reply = buildSummary({
    facts: facts({ promise: PROMISE }),
    step: { kind: 'check_promise', date: '2026-11-09' },
    score: null,
    language: 'en',
    said: {
      en: ['Will pay ₹9,999 by Monday.', 'Calm; travelling till Friday.'],
      owner: ['Will pay ₹9,999 by Monday.', 'Calm; travelling till Friday.'],
    },
    transcriptLink: null,
  });
  const text = replyText([reply]);
  assertStringIncludes(text, 'Summary:\n• Calm; travelling till Friday.');
  assertEquals(text.includes('9,999'), false);
  assertStringIncludes(text, 'Result: Promised ₹2,000 by Mon 9 Nov');
});
