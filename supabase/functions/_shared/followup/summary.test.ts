// supabase/functions/_shared/followup/summary.test.ts
// Summary (M5 test list, reshaped by dry-run fixes 7 and 8): Result / Summary / Next / Score /
// Transcript link, no tone line, "simulated" label; claim buttons only when a claim exists; [Try
// again] only when the next step is "try again"; Telugu and Hindi summaries carry no English
// sentence, and their English twin is the same template rendered in English.
import { assert, assertEquals } from '@std/assert';
import { parseTap } from '../cards/ids.ts';
import type { Score } from '../ledger/score.ts';
import { SUPPORTED_LANGUAGES } from '../schemas/shopkeeper.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { type Reply, replyText } from '../whatsapp/replies.ts';
import { CLAIM, FACT_CLAIM_ID, facts, PROMISE } from './__fixtures__/facts.ts';
import type { NextStep } from './rules.ts';
import { buildSummary, type SaidSummary, type SummaryInput } from './summary.ts';

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
const LINK = 'https://dashboard.example/calls?id=ca1#t=TOKEN';
const SAID_TE: SaidSummary = {
  en: ['Will pay ₹2,000 by Monday.', 'Calm; travelling till Friday.'],
  owner: ['సోమవారం లోపు ₹2,000 కడతానన్నారు.', 'ప్రశాంతంగా ఉన్నారు; శుక్రవారం వరకు ఊరిలో లేరు.'],
};
const SAID_EN: SaidSummary = { en: SAID_TE.en, owner: SAID_TE.en };

function summary(overrides: Partial<SummaryInput> = {}): Reply {
  return buildSummary({
    facts: facts(),
    step: CHECK,
    score: null,
    language: 'en',
    said: null,
    transcriptLink: null,
    ...overrides,
  });
}

function textOf(reply: Reply): string {
  return replyText([reply]);
}

Deno.test('summary › new shape: result, summary, next, score and the transcript link', () => {
  const reply = summary({
    facts: facts({ promise: PROMISE }),
    score: SCORE,
    said: SAID_EN,
    transcriptLink: LINK,
  });
  assertEquals(reply, {
    kind: 'text',
    text: '📞 *Asha called Ramesh* (Ramesh Kirana)\n\n' +
      'Result: Promised ₹2,000 by Mon 9 Nov\n' +
      'Summary:\n' +
      '• Will pay ₹2,000 by Monday.\n' +
      '• Calm; travelling till Friday.\n\n' +
      'Next: Check on Mon 9 Nov\n' +
      'Score: 46 (Risky)\n' +
      `🔗 Transcript: ${LINK}`,
  });
});

Deno.test('summary › no tone line on WhatsApp any more (the dashboard keeps it)', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const text = textOf(summary({ language, said: SAID_TE, score: SCORE }));
    assert(!text.includes('Tone') && !text.includes('తీరు') && !text.includes('लहजा'), language);
  }
});

Deno.test('summary › Telugu: agent lines in Telugu, no English sentence; English twin rendered', () => {
  const step: NextStep = {
    kind: 'remind_again',
    date: '2026-11-06',
    reason: 'Willing to pay after the weekend.',
    ownerReason: 'వారాంతం తర్వాత కడతారు.',
  };
  const reply = summary({
    facts: facts({ promise: PROMISE }),
    step,
    score: SCORE,
    language: 'te',
    said: SAID_TE,
    transcriptLink: LINK,
  });
  assert(reply.kind === 'text');
  assertEquals(reply.text.split('\n'), [
    '📞 *Asha Ramesh కి కాల్ చేసింది* (Ramesh Kirana)',
    '',
    'ఫలితం: Mon 9 Nov లోపు ₹2,000 కడతామని మాట ఇచ్చారు',
    'సారాంశం:',
    '• సోమవారం లోపు ₹2,000 కడతానన్నారు.',
    '• ప్రశాంతంగా ఉన్నారు; శుక్రవారం వరకు ఊరిలో లేరు.',
    '',
    'తర్వాత: Fri 6 Nov న మళ్ళీ గుర్తు చేయండి. వారాంతం తర్వాత కడతారు.',
    'స్కోరు: 46 (రిస్క్)',
    `🔗 సంభాషణ: ${LINK}`,
  ]);
  assert(!reply.text.includes('Willing'));
  assertEquals(reply.english?.split('\n'), [
    '📞 *Asha called Ramesh* (Ramesh Kirana)',
    '',
    'Result: Promised ₹2,000 by Mon 9 Nov',
    'Summary:',
    '• Will pay ₹2,000 by Monday.',
    '• Calm; travelling till Friday.',
    '',
    'Next: Remind again on Fri 6 Nov. Willing to pay after the weekend.',
    'Score: 46 (Risky)',
    `🔗 Transcript: ${LINK}`,
  ]);
});

Deno.test('summary › an English-only reason is never pasted into a Hindi or Telugu summary', () => {
  for (const language of ['hi', 'te'] as const) {
    const steps: readonly NextStep[] = [
      { kind: 'owner_should_call', reason: 'Disputes the amount.' },
      { kind: 'owner_callback', reason: 'Wants to talk about a bill.' },
    ];
    for (const step of steps) {
      const reply = summary({ step, language });
      assert(reply.kind === 'text');
      assert(!reply.text.includes('Disputes') && !reply.text.includes('Wants'), language);
      assert(reply.english?.includes(step.kind === 'owner_callback' ? 'Wants' : 'Disputes'));
    }
  }
});

Deno.test('summary › no LLM summary or link → those lines are left out', () => {
  const text = textOf(summary());
  assert(!text.includes('Summary') && !text.includes('🔗'));
  const teluguOnlyEnglish = summary({ language: 'te', said: { en: ['x'], owner: [] } });
  assert(teluguOnlyEnglish.kind === 'text' && !teluguOnlyEnglish.text.includes('సారాంశం'));
  assert(teluguOnlyEnglish.english?.includes('Summary:\n• x'));
});

Deno.test('summary › a claim carries [Confirm received] [Not received] for the claimed entry', () => {
  const reply = summary({ facts: facts({ claim: CLAIM }), step: { kind: 'confirm_claim' } });
  assert(reply.kind === 'buttons');
  assert(reply.text.includes('Result: Says paid ₹1,000 on Sun 1 Nov (cash). Did you receive it?'));
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
  assertEquals(summary().kind, 'text');
});

Deno.test('summary › simulated calls are labelled; a missing transcript is said', () => {
  const text = textOf(summary({
    facts: facts({ mode: 'simulated', promise: PROMISE, transcriptMissing: true }),
  }));
  assert(text.includes('🧪 Simulated call'));
  assert(text.endsWith('Transcript not available; summary from what the call recorded.'));
});

Deno.test('summary › "Didn\'t answer" carries a [Try again] button that reminds him again', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const reply = summary({
      facts: facts({ connected: false }),
      step: { kind: 'try_again' },
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
  const text = textOf(summary({ facts: facts({ connected: false }), step: { kind: 'try_again' } }));
  assert(text.includes('Result: Did not answer'));
});

Deno.test('summary › every next step has a line (English)', () => {
  const steps: readonly [NextStep, string][] = [
    [
      { kind: 'owner_callback', reason: 'Disputes a bill.' },
      'Please call Ramesh. Disputes a bill.',
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
    assert(textOf(summary({ step })).includes(`Next: ${line}`), line);
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
      const reply = summary({ facts: input, step, score: SCORE, language, transcriptLink: LINK });
      const text = textOf(reply);
      assert(!text.includes('undefined'), `${language} ${step.kind}`);
      assert(text.includes(LINK) && text.includes('46'));
      if ('reason' in step) assertEquals(text.includes(step.reason), language === 'en');
    }
  }
});
