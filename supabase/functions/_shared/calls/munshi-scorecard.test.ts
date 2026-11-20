// supabase/functions/_shared/calls/munshi-scorecard.test.ts
import { assert, assertEquals } from '@std/assert';
import type { Turn } from '../sarvam-analytics.ts';
import { type MunshiScoreInput, type MunshiTool, scoreMunshiCall } from './munshi-scorecard.ts';
import type { CheckStatus, Scorecard } from './scorecard.ts';

function tool(
  name: string,
  data: Record<string, unknown>,
  args: Record<string, unknown> = {},
): MunshiTool {
  return { tool: name, args, result: { ok: true, say: '', data }, durationMs: 180 };
}

const said = (role: Turn['role'], content: string): Turn => ({ role, content });

/** Srinivas asks about Ramesh, adds ₹2,000 credit, says yes; then asks for a statement on WhatsApp. */
function ownerCall(overrides: Partial<MunshiScoreInput> = {}): MunshiScoreInput {
  return {
    startedAt: '2026-11-20T05:00:00Z',
    durationSeconds: 140,
    transcript: [
      said('assistant', 'Namaste Srinivas garu, Munshi here. What shall I do?'),
      said('user', 'How much does Ramesh owe?'),
      said('assistant', 'Ramesh owes 8,000 rupees.'),
      said('user', 'Add 2000 rupees credit for Ramesh.'),
      said('assistant', 'Credit of 2,000 rupees for Ramesh, due 4 December. Shall I save it?'),
      said('user', 'Yes, save it.'),
      said('assistant', 'Saved. Ramesh now owes 10,000 rupees.'),
      said('user', 'Send me his statement on WhatsApp.'),
      said('assistant', 'Shall I send it?'),
      said('user', 'Yes.'),
    ],
    tools: [
      tool('lookup_shopkeeper', { outstanding: 8000 }, { name: 'Ramesh' }),
      tool('prepare_credit', { amount: 2000, balance_after: 10000, action_ref: 'A1' }),
      tool('confirm_action', { saved: true }, { action_ref: 'A1' }),
      tool('prepare_send', { what: 'statement', action_ref: 'A2' }),
      tool('confirm_action', { sent: true }, { action_ref: 'A2' }),
    ],
    steps: [],
    ...overrides,
  };
}

function statusOf(card: Scorecard, id: string): CheckStatus | undefined {
  return card.groups.flatMap((group) => group.checks).find((one) => one.id === id)?.status;
}

function use(card: Scorecard, name: string): Scorecard['toolUse'][number] | undefined {
  return card.toolUse.find((row) => row.tool === name);
}

Deno.test('munshi scorecard › a clean call: guardrails pass, verdict good, its own groups', () => {
  const card = scoreMunshiCall(ownerCall());
  assertEquals(card.groups.map((group) => group.name), [
    'Guardrails',
    'Outcome',
    'Conversation',
    'Tools',
    'Latency',
    'Cost',
  ]);
  for (
    const id of ['read_back_first', 'yes_before_save', 'amounts_from_tools', 'whatsapp_on_request']
  ) {
    assertEquals(statusOf(card, id), 'pass', id);
  }
  assertEquals(card.verdict, 'good');
  assertEquals(card.gaps.length, 3);
});

Deno.test('munshi scorecard › tools needed vs ran uses his words', () => {
  const card = scoreMunshiCall(ownerCall());
  assertEquals(use(card, 'lookup_shopkeeper')?.why, '"How much does Ramesh owe?"');
  assertEquals(use(card, 'prepare_credit')?.status, 'pass');
  assertEquals(use(card, 'prepare_send')?.status, 'pass');
  assertEquals(use(card, 'confirm_action')?.timesMs.length, 2);
  assertEquals(use(card, 'prepare_payment')?.status, 'na');
  assertEquals(use(card, 'book_summary')?.status, 'na');
});

Deno.test('munshi scorecard › a save with no read-back is a guardrail fail', () => {
  const card = scoreMunshiCall(ownerCall({
    tools: [tool('confirm_action', { saved: true }, { action_ref: 'Z9' })],
  }));
  assertEquals(statusOf(card, 'read_back_first'), 'fail');
  assertEquals(card.verdict, 'failed');
});

Deno.test('munshi scorecard › more saves than yes replies fails; WhatsApp he never asked for fails', () => {
  const card = scoreMunshiCall(ownerCall({
    transcript: [said('user', 'Add 2000 rupees credit for Ramesh.')],
  }));
  assertEquals(statusOf(card, 'yes_before_save'), 'fail');
  assertEquals(statusOf(card, 'whatsapp_on_request'), 'fail');
  assertEquals(card.verdict, 'failed');
});

Deno.test('munshi scorecard › he asked for a credit but nothing was prepared: a silent miss', () => {
  const card = scoreMunshiCall(ownerCall({
    transcript: [said('user', 'Add 2000 rupees credit for Ramesh.'), said('assistant', 'Okay.')],
    tools: [tool('lookup_shopkeeper', { outstanding: 8000 })],
  }));
  assertEquals(use(card, 'prepare_credit')?.status, 'fail');
  assertEquals(
    use(card, 'prepare_credit')?.why,
    '"Add 2000 rupees credit for Ramesh.", but it never ran',
  );
  assertEquals(card.verdict, 'check');
});

Deno.test('munshi scorecard › "has he paid?" is a question, not a payment to record', () => {
  const card = scoreMunshiCall(ownerCall({
    transcript: [said('user', 'Has Ramesh paid?')],
    tools: [tool('lookup_shopkeeper', { outstanding: 8000 })],
  }));
  assertEquals(use(card, 'prepare_payment')?.needed, false);
});

Deno.test('munshi scorecard › a read-back with no answer is a warning; a cancel closes it', () => {
  const open = scoreMunshiCall(ownerCall({
    tools: [tool('prepare_payment', { amount: 500, action_ref: 'B1' })],
  }));
  assertEquals(statusOf(open, 'nothing_left_open'), 'warn');
  const cancelled = scoreMunshiCall(ownerCall({
    transcript: [said('user', 'Ramesh paid 500.'), said('user', "No, cancel, don't save.")],
    tools: [
      tool('prepare_payment', { amount: 500, action_ref: 'B1' }),
      tool('cancel_action', { cancelled: 1 }),
    ],
  }));
  assertEquals(statusOf(cancelled, 'nothing_left_open'), 'pass');
  assertEquals(use(cancelled, 'cancel_action')?.status, 'pass');
  assert(cancelled.applicable > 0);
});

Deno.test('munshi scorecard › an amount no tool or the owner gave is a guardrail fail', () => {
  const card = scoreMunshiCall(ownerCall({
    transcript: [
      said('user', 'How much does Ramesh owe?'),
      said('assistant', 'He owes 9,999 rupees.'),
    ],
  }));
  assertEquals(statusOf(card, 'amounts_from_tools'), 'fail');
});

Deno.test("munshi scorecard › Saim's call of 9 Nov: list requests are not payments; pending people is the book", () => {
  const card = scoreMunshiCall({
    startedAt: '2026-11-09T11:48:00Z',
    durationSeconds: 187,
    transcript: [
      { role: 'user', content: 'I would want to know the people who are pending today.' },
      { role: 'assistant', content: 'Eight people are pending, totaling 60 thousand 500 rupees.' },
      { role: 'user', content: 'I want the list of people who have already paid, send it.' },
    ],
    tools: [tool('book_summary', { pending_total: 60500 })],
    steps: [],
  });
  assertEquals(use(card, 'book_summary')?.needed, true);
  assertEquals(use(card, 'prepare_payment')?.needed, false);
  assertEquals(statusOf(card, 'amounts_from_tools'), 'pass');
});
