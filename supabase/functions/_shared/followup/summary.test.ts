// supabase/functions/_shared/followup/summary.test.ts
// Summary (M5 test list): outcome, promise/claim, tone level, next step, "simulated" label;
// claim buttons only when a claim exists; [Try again] only when the next step is "try again".
import { assert, assertEquals } from '@std/assert';
import { parseTap } from '../cards/ids.ts';
import type { Score } from '../ledger/score.ts';
import { SUPPORTED_LANGUAGES } from '../schemas/shopkeeper.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { replyText } from '../whatsapp/replies.ts';
import { CLAIM, FACT_CLAIM_ID, facts, PROMISE } from './__fixtures__/facts.ts';
import type { NextStep } from './rules.ts';
import { buildSummary } from './summary.ts';

const SCORE: Score = {
  score: 46,
  band: 'risky',
  parts: { paidOnTime: 13, promisesKept: 15, currentOverdue: 13, answersCalls: 5 },
  facts: {
    creditsJudged: 3,
    creditsOnTime: 1,
    promisesKept: 1,
    promisesBroken: 1,
    daysOverdue: 20,
    callsMade: 2,
    callsAnswered: 1,
  },
};

const CHECK: NextStep = { kind: 'check_promise', date: '2026-11-09' };

Deno.test('summary › promise call: outcome, promise, tone level, next step, score', () => {
  const reply = buildSummary({
    facts: facts({ promise: PROMISE }),
    step: CHECK,
    score: SCORE,
    language: 'en',
  });
  assertEquals(reply, {
    kind: 'text',
    text: '📞 *Asha called Ramesh* (Ramesh Kirana)\n' +
      'Promised to pay\n' +
      'Promise: ₹2,000 by Mon 9 Nov\n' +
      'Tone: level 2 (firm)\n' +
      'Next: Check on Mon 9 Nov\n' +
      'Score: 46 (Risky)',
  });
});

Deno.test('summary › a claim carries [Confirm received] [Not received] for the claimed entry', () => {
  const reply = buildSummary({
    facts: facts({ claim: CLAIM }),
    step: { kind: 'confirm_claim' },
    score: null,
    language: 'en',
  });
  assert(reply.kind === 'buttons');
  assert(reply.text.includes('Says paid ₹1,000 on Sun 1 Nov (cash). Did you receive it?'));
  assert(reply.text.includes('Next: Tap Confirm received or Not received'));
  assertEquals(reply.buttons.map((button) => button.title), ['Confirm received', 'Not received']);
  assertEquals(parseTap(reply.buttons[0]?.id ?? ''), {
    kind: 'claim',
    entryId: FACT_CLAIM_ID,
    confirm: true,
    language: 'en',
  });
  assertEquals(parseTap(reply.buttons[1]?.id ?? '')?.kind, 'claim');
});

Deno.test('summary › no claim → no buttons', () => {
  const reply = buildSummary({ facts: facts(), step: CHECK, score: null, language: 'en' });
  assertEquals(reply.kind, 'text');
});

Deno.test('summary › simulated calls are labelled; a missing transcript is said', () => {
  const text = replyText([
    buildSummary({
      facts: facts({ mode: 'simulated', promise: PROMISE, transcriptMissing: true }),
      step: CHECK,
      score: null,
      language: 'en',
    }),
  ]);
  assert(text.includes('🧪 Simulated call'));
  assert(text.endsWith('Transcript not available; summary from what the call recorded.'));
});

Deno.test('summary › "Didn\'t answer" carries a [Try again] button that reminds him again', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const reply = buildSummary({
      facts: facts({ connected: false }),
      step: { kind: 'try_again' },
      score: null,
      language,
    });
    assert(reply.kind === 'buttons', language);
    assertEquals(reply.buttons.length, 1);
    assertEquals(reply.buttons[0]?.title, phrasesFor(language).tryAgain);
    assertEquals(parseTap(reply.buttons[0]?.id ?? ''), {
      kind: 'remind',
      shopkeeperId: facts().shopkeeperId,
      language,
    });
  }
  assert(
    replyText([buildSummary({
      facts: facts({ connected: false }),
      step: { kind: 'try_again' },
      score: null,
      language: 'en',
    })]).includes('Did not answer'),
  );
});

Deno.test('summary › no tone line when nobody confirmed identity', () => {
  for (const input of [facts({ connected: false }), facts({ identity: 'denied' })]) {
    const text = replyText([
      buildSummary({ facts: input, step: { kind: 'try_again' }, score: null, language: 'en' }),
    ]);
    assertEquals(text.includes('Tone'), false);
  }
});

Deno.test('summary › every next step has a line', () => {
  const steps: readonly [NextStep, string][] = [
    [
      { kind: 'owner_callback', reason: 'Disputes a bill.' },
      'Please call Ramesh: Disputes a bill.',
    ],
    [{ kind: 'try_again' }, 'Try again later'],
    [{ kind: 'nothing_shared' }, 'Nothing to do'],
    [
      { kind: 'remind_again', date: '2026-11-06', reason: 'Willing.' },
      'Remind again on Fri 6 Nov. Willing.',
    ],
    [{ kind: 'owner_should_call', reason: 'Angry.' }, 'Please call Ramesh. Angry.'],
    [{ kind: 'pause_reminders', reason: 'Illness.' }, 'Pause reminders for now. Illness.'],
  ];
  for (const [step, line] of steps) {
    const text = replyText([buildSummary({ facts: facts(), step, score: null, language: 'en' })]);
    assert(text.includes(`Next: ${line}`), line);
  }
});

Deno.test('summary › Hindi and Telugu summaries have every line, figures in digits', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const reply = buildSummary({
      facts: facts({ promise: PROMISE, claim: CLAIM, mode: 'simulated', transcriptMissing: true }),
      step: { kind: 'confirm_claim' },
      score: SCORE,
      language,
    });
    const text = replyText([reply]);
    assert(text.includes('₹2,000') && text.includes('₹1,000') && text.includes('46'));
    assert(text.includes('Ramesh'));
    assertEquals(text.split('\n').length >= 9, true);
  }
});

Deno.test('summary › every next step and outcome renders in every language', () => {
  const steps: readonly NextStep[] = [
    CHECK,
    { kind: 'confirm_claim' },
    { kind: 'owner_callback', reason: 'R1.' },
    { kind: 'try_again' },
    { kind: 'nothing_shared' },
    { kind: 'remind_again', date: '2026-11-06', reason: 'R2.' },
    { kind: 'owner_should_call', reason: 'R3.' },
    { kind: 'pause_reminders', reason: 'R4.' },
  ];
  const inputs = [
    facts({ connected: false, declined: true }),
    facts({ connected: false }),
    facts({ identity: 'denied' }),
    facts({ identity: 'unknown' }),
    facts({ callbacks: [{ reason: 'wants_owner', summary: 'x' }] }),
    facts(),
  ];
  for (const language of SUPPORTED_LANGUAGES) {
    for (const [index, step] of steps.entries()) {
      const input = inputs[index % inputs.length] ?? facts();
      const text = replyText([buildSummary({ facts: input, step, score: null, language })]);
      assert(!text.includes('undefined'), `${language} ${step.kind}`);
      if ('reason' in step) assert(text.includes(step.reason));
    }
  }
});
