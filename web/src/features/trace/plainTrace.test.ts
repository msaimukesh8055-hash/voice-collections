// web/src/features/trace/plainTrace.test.ts
// The readable timeline from recorded steps, shaped like real calls (fake data): an Asha call with
// a double request_owner_callback, a Munshi read-back and yes, a WhatsApp message's time split,
// tools that did not run, slow and failed tools, and token counts folded into the AI step.
import { describe, expect, it } from 'vitest';
import type { TraceStep } from '../../lib/opsSchemas.ts';
import { buildPlainTrace, msText, offsetText, type ToolEventLike } from './plainTrace.ts';

const T0 = Date.parse('2026-11-23T04:41:55.000Z');

function at(seconds: number): string {
  return new Date(T0 + seconds * 1000).toISOString();
}

function step(
  name: string,
  seconds: number,
  extra: Partial<TraceStep> & { detail?: Record<string, unknown> } = {},
): TraceStep {
  return {
    source: 'calls-api',
    step: name,
    status: 'ok',
    errorCode: null,
    provider: null,
    durationMs: null,
    tokensIn: null,
    tokensOut: null,
    detail: {},
    createdAt: at(seconds),
    traceId: 'trace-a',
    ...extra,
  };
}

function tool(name: string, seconds: number, ms: number): TraceStep {
  return step('tool_call', seconds, {
    source: 'sarvam-tools',
    durationMs: ms,
    detail: { tool: name, ms, ok: true },
  });
}

function failedTool(name: string, seconds: number): TraceStep {
  return { ...tool(name, seconds, 90), status: 'error', detail: { tool: name, ms: 90, ok: false } };
}

const ENDED = step('call_ended', 87, {
  detail: { seconds: 87, replyCount: 6, replyP50Ms: 514, replyMaxMs: 2144, sigMicPeak: 0.191 },
});

const ASHA_STEPS: readonly TraceStep[] = [
  step('call_accepted', 0),
  step('request', 0, { durationMs: 480, detail: { route: '/accept', http_status: 200 } }),
  tool('confirm_identity', 15, 80),
  tool('get_dues', 24, 113),
  tool('request_owner_callback', 51, 395),
  tool('request_owner_callback', 52, 174),
  ENDED,
  step('llm_usage', 88, {
    source: 'followup-worker',
    provider: 'sarvam',
    detail: { model: 'sarvam-105b', tokens_in: 761, tokens_out: 86 },
  }),
  step('followup_agent', 88.1, {
    source: 'followup-worker',
    provider: 'sarvam',
    durationMs: 448,
    langfuseUrl: 'https://lf.test/t/1',
  }),
  step('followup_run', 89, { source: 'followup-worker', detail: { outcome: 'done' } }),
];

const ASHA_EVENTS: readonly ToolEventLike[] = [
  {
    tool: 'confirm_identity',
    args: { answer: 'confirmed' },
    result: { ok: true, say: 'Identity confirmed.', data: { identity: 'confirmed' } },
    durationMs: 80,
    createdAt: at(15),
  },
  {
    tool: 'get_dues',
    args: {},
    result: { ok: true, say: 'Total outstanding: 5,500 rupees. Overdue: 5,500 rupees.' },
    durationMs: 113,
    createdAt: at(24),
  },
];

const TOOL_USE = [
  { tool: 'log_promise', needed: false, timesMs: [], why: 'no promise offered' },
  { tool: 'record_payment_claim', needed: true, timesMs: [], why: '"I paid yesterday"' },
  { tool: 'get_dues', needed: true, timesMs: [113], why: 'always' },
];

describe('buildPlainTrace › an Asha call', () => {
  const trace = buildPlainTrace({
    steps: ASHA_STEPS,
    events: ASHA_EVENTS,
    toolUse: TOOL_USE,
    agent: 'Asha',
  });

  it('sums the call up in one line', () => {
    expect(trace.summary).toEqual([
      '87 s call',
      '4 tool calls: 1 duplicate',
      'Asha replied in 514 ms typically, 2.1 s at worst',
      'follow-up done 2.0 s after hang-up',
    ]);
  });

  it('names each step in plain English with its time in the call, hiding requests and tokens', () => {
    expect(trace.items.map((item) => [offsetText(item.atMs), item.title])).toEqual([
      ['+0.0 s', 'Call connected'],
      ['+15 s', 'Checked who answered: the shopkeeper'],
      ['+24 s', 'Looked up the dues'],
      ['+51 s', 'Asked the owner to call back'],
      ['+52 s', 'Asked the owner to call back'],
      ['+1 min 27 s', 'Call ended'],
      ['+1 min 28 s', 'AI decided the follow-up'],
      ['+1 min 29 s', 'Follow-up done'],
    ]);
  });

  it('flags the second callback within 5 s as a duplicate, and keeps what each tool sent', () => {
    const callbacks = trace.items.filter((item) => item.tool === 'request_owner_callback');
    expect(callbacks.map((item) => item.flags)).toEqual([[], ['duplicate']]);
    const dues = trace.items.find((item) => item.tool === 'get_dues');
    expect(dues?.note).toBe('Total outstanding: 5,500 rupees.');
    expect(dues?.sentGot?.sent).toEqual({});
  });

  it('folds the token count into the AI step and keeps its Langfuse link', () => {
    const ai = trace.items.find((item) => item.name === 'followup_agent')?.ai;
    expect(ai).toEqual({
      provider: 'Sarvam',
      model: 'sarvam-105b',
      tokensIn: 761,
      tokensOut: 86,
      url: 'https://lf.test/t/1',
    });
  });

  it('lists tools that did not run; a needed one is a miss', () => {
    expect(trace.notRun).toEqual([
      { tool: 'log_promise', missed: false, text: 'not needed, no promise offered' },
      {
        tool: 'record_payment_claim',
        missed: true,
        text: 'needed but never ran: "I paid yesterday"',
      },
    ]);
  });

  it('puts the mic signals in the technical fold', () => {
    expect(trace.technical).toContainEqual(['Mic peak level (0 to 1)', '0.191']);
    expect(trace.technical).toContainEqual(['Agent replies', '6']);
  });
});

describe('buildPlainTrace › tool flags', () => {
  it('marks a tool over 1 s as slow and a failed one in red', () => {
    const trace = buildPlainTrace({
      steps: [step('call_accepted', 0), tool('get_dues', 5, 1400), failedTool('log_promise', 30)],
      agent: 'Asha',
    });
    expect(trace.items[1]?.flags).toEqual(['slow']);
    expect(trace.items[2]).toMatchObject({ tone: 'bad', flags: ['failed'] });
    expect(trace.summary).toContain('2 tool calls: 1 failed, 1 over 1 s');
  });
});

function munshiEvent(
  name: string,
  seconds: number,
  result: Record<string, unknown>,
): ToolEventLike {
  return { tool: name, args: { name: 'Ramesh' }, result, durationMs: 200, createdAt: at(seconds) };
}

describe('buildPlainTrace › a Munshi call', () => {
  const readBackSay =
    'Read this back to him and ask "correct?": add a payment of 2,000 rupees from Ramesh. ' +
    'Balance goes from 9,000 rupees to 7,000 rupees. Then stop and wait for his answer.';
  const events = [
    munshiEvent('prepare_payment', 10, { ok: true, say: readBackSay }),
    munshiEvent('confirm_action', 14, { ok: true, say: 'Done: payment saved. Tell him that.' }),
    munshiEvent('confirm_action', 30, { ok: false, code: 'REPLACED_NOT_SAVED', say: 'x' }),
  ];

  it('reads back, saves on a yes, and says when a newer read-back replaced the change', () => {
    const trace = buildPlainTrace({ steps: [], events, agent: 'Munshi' });
    expect(trace.items.map((item) => item.title)).toEqual([
      'Read back to owner: add a payment of 2,000 rupees from Ramesh. Balance goes from 9,000 rupees to 7,000 rupees.',
      'Owner said yes, saved',
      'Replaced by a newer read-back, nothing saved',
    ]);
    expect(trace.items[2]).toMatchObject({ tone: 'warn', flags: ['refused'] });
  });
});

describe('buildPlainTrace › a WhatsApp message', () => {
  const steps: readonly TraceStep[] = [
    step('request', 0, { source: 'whatsapp-webhook', detail: { route: '/', http_status: 200 } }),
    step('llm_usage', 1.2, { provider: 'sarvam', tokensIn: 599, tokensOut: 14 }),
    step('brain_llm', 1.2, { provider: 'sarvam', durationMs: 1184 }),
    step('whatsapp_message', 10.1, {
      source: 'whatsapp-webhook',
      durationMs: 10079,
      detail: { path: 'sarvam', command: 'due_alert', replies: 3 },
    }),
  ];

  it('splits the time into AI and building and sending replies', () => {
    const trace = buildPlainTrace({ steps });
    expect(trace.summary).toEqual(['Took 10.1 s: AI 1.2 s', 'building and sending replies 8.9 s']);
    expect(trace.items.map((item) => item.title)).toEqual([
      'Message received',
      'AI read the message',
      '3 replies sent',
    ]);
    expect(trace.items[1]?.ai?.tokensIn).toBe(599);
    expect(trace.items[2]?.note).toBe('Understood as: due alert (read by AI)');
  });

  it('says when no AI was used', () => {
    const trace = buildPlainTrace({ steps: [steps[0] as TraceStep, steps[3] as TraceStep] });
    expect(trace.summary).toEqual(['Took 10.1 s, all in code (no AI)']);
  });
});

describe('time words', () => {
  it('reads as ms under a second and seconds above', () => {
    expect([msText(80), msText(2144), offsetText(-5), offsetText(400)]).toEqual([
      '80 ms',
      '2.1 s',
      'before',
      '+0.4 s',
    ]);
  });
});
