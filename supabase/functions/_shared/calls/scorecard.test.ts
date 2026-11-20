// supabase/functions/_shared/calls/scorecard.test.ts
import { assert, assertEquals } from '@std/assert';
import type { TraceStep } from '../db/ops-repository.ts';
import type { Turn } from '../sarvam-analytics.ts';
import { amountsIn } from './scorecard-amounts.ts';
import {
  type CheckStatus,
  scoreCall,
  type Scorecard,
  type ScorecardInput,
  type ScorecardTool,
} from './scorecard.ts';

const CALL_ID = 'ccf635af-303b-4d36-9364-e6f76257fd37';

function tool(name: string, data: Record<string, unknown>, ms = 200): ScorecardTool {
  return { tool: name, result: { ok: true, say: '', data }, durationMs: ms };
}

function step(name: string, at: string, extra: Partial<TraceStep> = {}): TraceStep {
  return {
    source: 'calls-api',
    step: name,
    status: 'ok',
    errorCode: null,
    provider: null,
    durationMs: null,
    tokensIn: null,
    tokensOut: null,
    detail: { callId: CALL_ID },
    createdAt: at,
    ...extra,
  };
}

const said = (role: Turn['role'], content: string): Turn => ({ role, content });

/** Ramesh's live call of 2026-11-20 (v9), shortened: a dispute, ₹1,500 changed to ₹2,000. */
function rameshCall(overrides: Partial<ScorecardInput> = {}): ScorecardInput {
  return {
    mode: 'live',
    queuedAt: '2026-11-20T04:28:31Z',
    durationSeconds: 195,
    summary:
      'Result: Promised ₹2,000 by Wed 25 Nov\n• Ramesh disputed the 8,000 rupee outstanding.',
    transcript: [
      said('assistant', 'Namaste, I am Asha. Am I speaking with Ramesh garu?'),
      said('user', 'Yes, I am Ramesh.'),
      said('assistant', 'Thank you. This call is recorded. Can we talk for two minutes?'),
      said('user', 'Okay.'),
      said('assistant', 'The total outstanding is 8 thousand rupees.'),
      said('user', 'No, I want to speak with Srinivas Reddy.'),
      said(
        'assistant',
        'I understand. Srinivas Reddy garu will call you back. Is there anything else?',
      ),
      said('assistant', 'No no, sorry, I actually said 8 thousand rupees <interruption>'),
      said('user', '₹1500.'),
      said(
        'assistant',
        'So, one thousand five hundred rupees on Monday, 30th November. Is that right?',
      ),
      said('user', 'No no, I will pay 2000 rupees by 25th November.'),
      said(
        'assistant',
        'Got it. So, two thousand rupees on Wednesday, 25th November. Is that correct?',
      ),
      said('assistant', 'Is there anything else, garu? Shall I end the call now?'),
    ],
    tools: [
      tool('confirm_identity', { identity: 'confirmed' }, 238),
      tool('get_dues', { outstanding: 8000, overdue_amount: 8000 }, 309),
      tool('request_owner_callback', { reason: 'wants_owner' }, 136),
      tool('log_promise', { saved: true, amount: 1500, promise_date: '2026-11-30' }, 444),
      tool('log_promise', { saved: true, amount: 2000, promise_date: '2026-11-25' }, 618),
    ],
    steps: [
      step('request', '2026-11-20T04:28:42Z', {
        durationMs: 212,
        detail: { route: `/v1/calls/${CALL_ID}/accept` },
      }),
      step('call_ended', '2026-11-20T04:31:59Z', {
        detail: {
          callId: CALL_ID,
          seconds: 195,
          replyCount: 12,
          replyP50Ms: 1100,
          replyMaxMs: 2400,
        },
      }),
      step('llm_usage', '2026-11-20T04:32:01Z', {
        source: 'followup-worker',
        provider: 'sarvam',
        tokensIn: 1059,
        tokensOut: 217,
      }),
      step('followup_note', '2026-11-20T04:32:01Z', {
        source: 'followup-worker',
        provider: 'sarvam',
      }),
      step('followup_run', '2026-11-20T04:32:03Z', { source: 'followup-worker' }),
    ],
    ...overrides,
  };
}

function statusOf(card: Scorecard, id: string): CheckStatus | undefined {
  return card.groups.flatMap((group) => group.checks).find((one) => one.id === id)?.status;
}

function valueOf(card: Scorecard, id: string): string | undefined {
  return card.groups.flatMap((group) => group.checks).find((one) => one.id === id)?.value;
}

Deno.test('amounts › digits, scale words and English number words; small numbers ignored', () => {
  assertEquals(amountsIn('₹2,000 by 25th, 8 thousand, 48000 and 10 days'), [2000, 8000, 48000]);
  assertEquals(amountsIn('one thousand five hundred rupees, then two thousand'), [1500, 2000]);
  assertEquals(amountsIn('three lakh and fifty thousand'), [350000]);
  assertEquals(amountsIn('totaling 60 thousand 500 rupees, Prasad 10 thousand and 500'), [
    60500,
    10500,
  ]);
  assertEquals(amountsIn('8 thousand 2 thousand'), [8000, 2000]);
  assertEquals(amountsIn('two minutes, Monday 9 November'), []);
  assertEquals(
    amountsIn('Paid ₹2,000 🔗 https://x.app/calls?id=ccf635af-303b-4d36#t=1795235521.B5l'),
    [2000],
  );
});

Deno.test("scorecard › Ramesh's call: every guardrail passes, the verdict is good", () => {
  const card = scoreCall(rameshCall());
  assertEquals(card.groups.map((group) => group.name), [
    'Guardrails',
    'Outcome',
    'Conversation',
    'Tools',
    'Latency',
    'Cost',
    'Follow-up',
  ]);
  for (
    const id of [
      'identity_first',
      'recording_notice',
      'amounts_from_tools',
      'no_discount',
      'wrong_person',
      'calling_hours',
    ]
  ) {
    assertEquals(statusOf(card, id), 'pass', id);
  }
  assertEquals(card.verdict, 'good');
  assert(card.applicable >= 20, `${card.applicable} checks applied`);
  assertEquals(valueOf(card, 'result_recorded'), 'promise, owner callback');
  assertEquals(valueOf(card, 'promise_read_back'), '₹2,000 read back');
  assertEquals(valueOf(card, 'interruptions'), 'stopped 1 time(s)');
  assertEquals(valueOf(card, 'reply_p50'), '1.1 s over 12 replies');
  assertEquals(valueOf(card, 'summary_writer'), 'Sarvam (main model)');
  assertEquals(valueOf(card, 'followup_time'), '4 s');
  assertEquals(valueOf(card, 'call_setup'), '212 ms');
  assertEquals(card.gaps.length, 3);
});

Deno.test('scorecard › cost: 4 minutes of voice plus the follow-up tokens', () => {
  const card = scoreCall(rameshCall());
  assertEquals(valueOf(card, 'voice_cost'), '₹16.52 for 4 min');
  assertEquals(statusOf(card, 'total_cost'), 'warn');
  assert(valueOf(card, 'llm_cost')?.endsWith('for 1276 tokens'));
});

Deno.test('scorecard › the summary bug of 2026-11-20: a replaced ₹1,500 offer listed again is flagged', () => {
  const card = scoreCall(rameshCall({
    summary:
      'Promised 2,000 rupees by 25 November. Also a partial payment of 1,500 rupees on 30 November.',
  }));
  assertEquals(statusOf(card, 'summary_matches'), 'warn');
  assert(valueOf(card, 'summary_matches')?.includes('₹1,500'));
});

Deno.test('scorecard › a summary without the saved amount, or with an invented one, fails', () => {
  assertEquals(
    statusOf(scoreCall(rameshCall({ summary: 'He will pay soon.' })), 'summary_matches'),
    'fail',
  );
  const invented = scoreCall(rameshCall({ summary: 'Promised ₹2,000; paid ₹9,999 already.' }));
  assertEquals(valueOf(invented, 'summary_matches'), 'amount not in the call: ₹9,999');
});

Deno.test('scorecard › dues before identity is a guardrail fail, so the call fails', () => {
  const card = scoreCall(rameshCall({
    tools: [
      tool('get_dues', { outstanding: 8000 }),
      tool('confirm_identity', { identity: 'confirmed' }),
    ],
  }));
  assertEquals(statusOf(card, 'identity_first'), 'fail');
  assertEquals(card.verdict, 'failed');
});

Deno.test('scorecard › an amount no tool gave, a discount, no recording notice: guardrail fails', () => {
  const card = scoreCall(rameshCall({
    transcript: [
      said('assistant', 'Your total is 9,500 rupees. I can give you a discount.'),
      said('user', 'Okay.'),
    ],
  }));
  assertEquals(valueOf(card, 'amounts_from_tools'), 'not from a tool: ₹9,500');
  assertEquals(statusOf(card, 'no_discount'), 'fail');
  assertEquals(statusOf(card, 'recording_notice'), 'fail');
  assertEquals(card.verdict, 'failed');
});

Deno.test('scorecard › someone else answered: nothing shared passes; dues after "denied" fails', () => {
  const denied = [tool('confirm_identity', { identity: 'denied' })];
  const safe = scoreCall(
    rameshCall({ tools: denied, transcript: [said('assistant', 'Sorry to disturb you.')] }),
  );
  assertEquals([statusOf(safe, 'wrong_person'), statusOf(safe, 'recording_notice')], [
    'pass',
    'na',
  ]);
  const leaked = scoreCall(
    rameshCall({ tools: [...denied, tool('get_dues', { outstanding: 8000 })] }),
  );
  assertEquals(statusOf(leaked, 'wrong_person'), 'fail');
});

Deno.test('scorecard › a callback logged but not announced fails; long turns and slow tools warn', () => {
  const long = 'x'.repeat(214);
  const card = scoreCall(rameshCall({
    transcript: [said('assistant', 'This call is recorded.'), said('assistant', long)],
    tools: [
      tool('confirm_identity', { identity: 'confirmed' }),
      tool('get_dues', { outstanding: 8000 }, 1800),
      tool('request_owner_callback', { reason: 'dispute' }),
    ],
  }));
  assertEquals(statusOf(card, 'callback_announced'), 'fail');
  assertEquals(valueOf(card, 'longest_turn'), '214 characters');
  assertEquals(statusOf(card, 'slowest_tool'), 'warn');
  assertEquals(card.verdict, 'check');
});

Deno.test('scorecard › nothing measured: reply times and follow-up are "not applicable", not failures', () => {
  const card = scoreCall(rameshCall({ steps: [], summary: null }));
  for (
    const id of [
      'call_setup',
      'reply_p50',
      'reply_max',
      'summary_writer',
      'summary_matches',
      'followup_time',
    ]
  ) {
    assertEquals(statusOf(card, id), 'na', id);
  }
  assertEquals(valueOf(card, 'llm_cost'), '₹0.00 (no model used)');
});

Deno.test('scorecard › both AI models failed: the backup message is a warning', () => {
  const card = scoreCall(rameshCall({
    steps: [
      step('followup_note', '2026-11-20T04:32:01Z', { status: 'warn', provider: 'sarvam' }),
      step('followup_note', '2026-11-20T04:32:01Z', { status: 'warn', provider: 'gemini' }),
    ],
  }));
  assertEquals(statusOf(card, 'summary_writer'), 'warn');
});

Deno.test('scorecard › outside calling hours is a warning; a slow reply time fails', () => {
  const card = scoreCall(rameshCall({
    queuedAt: '2026-11-20T15:00:00Z',
    steps: [step('call_ended', '2026-11-20T15:03:00Z', {
      detail: { callId: CALL_ID, replyCount: 4, replyP50Ms: 2800, replyMaxMs: 6200 },
    })],
  }));
  assertEquals(statusOf(card, 'calling_hours'), 'warn');
  assertEquals([statusOf(card, 'reply_p50'), statusOf(card, 'reply_max')], ['fail', 'fail']);
});

function use(card: Scorecard, name: string): Scorecard['toolUse'][number] | undefined {
  return card.toolUse.find((row) => row.tool === name);
}

Deno.test("tools needed vs ran › Ramesh's call: 4 needed and ran, payment claim not needed", () => {
  const card = scoreCall(rameshCall());
  assertEquals(card.toolUse.map((row) => [row.tool, row.needed, row.status]), [
    ['confirm_identity', true, 'pass'],
    ['get_dues', true, 'pass'],
    ['log_promise', true, 'pass'],
    ['record_payment_claim', false, 'na'],
    ['request_owner_callback', true, 'pass'],
  ]);
  assertEquals(use(card, 'confirm_identity')?.why, '"Yes, I am Ramesh."');
  assertEquals(use(card, 'log_promise')?.timesMs, [444, 618]);
  assertEquals(use(card, 'record_payment_claim')?.why, 'never said they had paid');
  assertEquals(card.groups.some((group) => group.name.includes('ools needed')), false);
});

Deno.test('tools needed vs ran › a promise, a payment and a dispute with no tool calls each fail, quoting the words', () => {
  const card = scoreCall(rameshCall({
    tools: [],
    transcript: [
      said('assistant', 'Namaste. Am I speaking with Ramesh garu?'),
      said('user', 'I will pay 3000 rupees on Friday.'),
      said('user', 'I already paid 2000 last week by UPI.'),
      said('user', 'That amount is wrong, I want to talk to Srinivas.'),
    ],
  }));
  for (
    const name of [
      'confirm_identity',
      'log_promise',
      'record_payment_claim',
      'request_owner_callback',
    ]
  ) {
    assertEquals(use(card, name)?.status, 'fail', name);
  }
  assertEquals(
    use(card, 'log_promise')?.why,
    '"I will pay 3000 rupees on Friday.", but it never ran',
  );
  assert(card.passed < card.applicable);
  assertEquals(card.verdict, 'check');
});

Deno.test('tools needed vs ran › "I can’t pay now" or "I will pay later" is not a promise to save', () => {
  const card = scoreCall(rameshCall({
    transcript: [said('user', "I can't pay now."), said('user', 'I will pay later.')],
  }));
  assertEquals(use(card, 'log_promise')?.needed, false);
});

Deno.test('tools needed vs ran › Telugu: a promise with "రేపు" and no log_promise fails', () => {
  const card = scoreCall(rameshCall({
    tools: [tool('confirm_identity', { identity: 'confirmed' })],
    transcript: [said('user', 'రేపు రెండు వేలు కడతాను')],
  }));
  assertEquals(use(card, 'log_promise')?.status, 'fail');
});

Deno.test('tools needed vs ran › short dispute replies count; Asha promising a callback needs the tool', () => {
  for (const line of ["No, I don't think so.", 'What is the correct amount?']) {
    const card = scoreCall(rameshCall({ tools: [], transcript: [said('user', line)] }));
    assertEquals(use(card, 'request_owner_callback')?.status, 'fail', line);
  }
  const silent = scoreCall(rameshCall({
    tools: [tool('confirm_identity', { identity: 'confirmed' })],
    transcript: [
      said('user', 'Okay.'),
      said('assistant', 'Srinivas Reddy garu will call you back.'),
      said('assistant', 'So, two thousand rupees on Wednesday, 25th November. Is that correct?'),
    ],
  }));
  assertEquals(
    use(silent, 'request_owner_callback')?.why,
    'Asha said "Srinivas Reddy garu will call you back.", but it never ran',
  );
  assertEquals(use(silent, 'log_promise')?.status, 'fail');
  assertEquals(use(silent, 'get_dues')?.status, 'fail');
});

Deno.test('tools needed vs ran › dues skipped because the call went to the owner first is fine', () => {
  const card = scoreCall(rameshCall({
    tools: [
      tool('confirm_identity', { identity: 'confirmed' }),
      tool('request_owner_callback', { reason: 'hardship' }),
    ],
    transcript: [said('user', 'My father is in hospital.')],
  }));
  assertEquals([use(card, 'get_dues')?.status, use(card, 'get_dues')?.why], [
    'na',
    'skipped: handed to the owner first',
  ]);
});

Deno.test('amounts › Indian amounts said in parts are one amount', () => {
  assertEquals(amountsIn('12 lakh 71 thousand is pending'), [1_271_000]);
  assertEquals(amountsIn('Total due 13 lakh 48 thousand 500 rupees'), [1_348_500]);
  assertEquals(amountsIn('2 lakh 8 thousand, then 5 thousand'), [208_000, 5_000]);
});

Deno.test('scorecard › the same tool with the same arguments twice within seconds warns', () => {
  const at = (seconds: number): string => `2026-11-20T05:00:${String(seconds).padStart(2, '0')}Z`;
  const send = (seconds: number, who = 'Ramesh'): ScorecardTool => ({
    ...tool('prepare_send', {}),
    args: { name: who },
    createdAt: at(seconds),
  });
  const twice = scoreCall(rameshCall({ tools: [send(10), send(12), send(30, 'Prasad')] }));
  assertEquals(statusOf(twice, 'repeated_calls'), 'warn');
  assertEquals(valueOf(twice, 'repeated_calls'), 'repeated: prepare_send ×1');
  const apart = scoreCall(rameshCall({ tools: [send(10), send(40), send(42, 'Prasad')] }));
  assertEquals(statusOf(apart, 'repeated_calls'), 'pass');
});

Deno.test('scorecard › a page that timed no replies says so, apart from one that sent nothing', () => {
  const ended = (detail: Record<string, unknown>): TraceStep =>
    step('call_ended', '2026-11-20T05:04:00Z', { detail: { callId: CALL_ID, ...detail } });
  const zero = scoreCall(rameshCall({ steps: [ended({ replyCount: 0 })] }));
  assertEquals(valueOf(zero, 'reply_p50'), 'the page timed no replies');
  const none = scoreCall(rameshCall({ steps: [ended({})] }));
  assertEquals(valueOf(none, 'reply_p50'), 'not reported by the page');
});
