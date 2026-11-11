// supabase/functions/_shared/ops/watch.test.ts
// The failure alert (M9 Build A): what counts as one problem, one message per problem per
// 15-minute window, the wording, and that a refused alert never raises another alert.
import { assertEquals } from '@std/assert';
import {
  createFakeOpsRepository,
  EMPTY_OPS_SUMMARY,
  type FakeOpsState,
} from '../db/fake-ops-repository.ts';
import type { OpsError } from '../db/ops-repository.ts';
import type { LogFields, LogLevel } from '../log.ts';
import type { Reply } from '../whatsapp/replies.ts';
import {
  ALERT_WINDOW_MS,
  alertText,
  MAX_ALERT_LINES,
  type OpsWatchDeps,
  problemsOf,
  runOpsWatch,
  withoutErrors,
} from './watch.ts';

const NOW = new Date('2026-11-11T05:07:00.000Z');
const OPS_NUMBER = '919000000001';
const TRACE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRACE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TRACE_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function error(traceId: string, overrides: Partial<OpsError> = {}): OpsError {
  return {
    traceId,
    source: 'whatsapp-webhook',
    step: 'whatsapp_background_failed',
    errorCode: 'RepositoryError',
    createdAt: '2026-11-11T05:05:00.000Z',
    ...overrides,
  };
}

interface Setup {
  readonly deps: OpsWatchDeps;
  readonly sent: { to: string; reply: Reply }[];
  readonly logs: [LogLevel, string, LogFields | undefined][];
}

function setup(
  state: Partial<FakeOpsState>,
  options: { refused?: boolean; now?: Date; link?: string | null } = {},
): Setup {
  const sent: Setup['sent'] = [];
  const logs: Setup['logs'] = [];
  const deps: OpsWatchDeps = {
    ops: createFakeOpsRepository(state),
    whatsapp: {
      send: (to, reply) => {
        sent.push({ to, reply });
        return Promise.resolve(options.refused ? null : 'wamid.alert');
      },
    },
    alertNumber: OPS_NUMBER,
    traceLink: (traceId) =>
      Promise.resolve(options.link === undefined ? `https://app.test/ops?id=${traceId}` : null),
    clock: () => options.now ?? NOW,
    log: (level, event, fields) => {
      logs.push([level, event, fields]);
    },
  };
  return { deps, sent, logs };
}

function textOf(sent: Setup['sent']): string {
  const reply = sent[0]?.reply;
  return reply?.kind === 'text' ? reply.text : '';
}

Deno.test('ops watch › nothing wrong: no claim, no message', async () => {
  const { deps, sent } = setup({});
  assertEquals(await runOpsWatch(deps), { alerted: false, reason: 'nothing_wrong' });
  assertEquals(sent, []);
});

Deno.test('ops watch › a failed request is one problem, named by what went wrong', () => {
  const problems = problemsOf([
    error(TRACE_A, { step: 'request', errorCode: 'HTTP 500' }),
    error(TRACE_A),
  ]);
  assertEquals(problems, [{
    key: 'whatsapp-webhook|whatsapp_background_failed|RepositoryError',
    line: 'whatsapp-webhook · whatsapp_background_failed (RepositoryError)',
    count: 1,
    traceId: TRACE_A,
  }]);
});

Deno.test('ops watch › the same failure on three requests is one line with ×3; biggest first', () => {
  const problems = problemsOf([
    error(TRACE_C, { source: 'sarvam-tools', step: 'request', errorCode: 'HTTP 500' }),
    error(TRACE_A),
    error(TRACE_B),
    error('dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  ]);
  assertEquals(problems.map((problem) => problem.line), [
    'whatsapp-webhook · whatsapp_background_failed (RepositoryError) ×3',
    'sarvam-tools · request (HTTP 500)',
  ]);
});

Deno.test('ops watch › an error step without a code still reads cleanly', () => {
  const [problem] = problemsOf([error(TRACE_A, { errorCode: null })]);
  assertEquals(problem?.line, 'whatsapp-webhook · whatsapp_background_failed');
  assertEquals(problem?.key, 'whatsapp-webhook|whatsapp_background_failed|-');
});

Deno.test('ops watch › new errors → one message to the ops number, with the trace link', async () => {
  const { deps, sent, logs } = setup({ errors: [error(TRACE_A), error(TRACE_B)] });
  assertEquals(await runOpsWatch(deps), { alerted: true, problems: 1, delivered: true });
  assertEquals(sent.length, 1);
  assertEquals(sent[0]?.to, OPS_NUMBER);
  assertEquals(
    textOf(sent),
    [
      '⚠️ Easy Recovery AI: something failed',
      '',
      '• whatsapp-webhook · whatsapp_background_failed (RepositoryError) ×2',
      '',
      'Seen in the last 15 minutes.',
      '',
      'Open the trace:',
      `https://app.test/ops?id=${TRACE_A}`,
    ].join('\n'),
  );
  assertEquals(logs, [['info', 'ops_alert', { problems: 1, delivered: true }]]);
});

Deno.test('ops watch › the same problem in the same 15 minutes is alerted once', async () => {
  const state: Partial<FakeOpsState> = { errors: [error(TRACE_A)] };
  const first = setup(state);
  const ops = first.deps.ops;
  assertEquals((await runOpsWatch(first.deps)).alerted, true);
  const again = setup(state, { now: new Date(NOW.getTime() + 5 * 60 * 1000) });
  const outcome = await runOpsWatch({ ...again.deps, ops });
  assertEquals(outcome, { alerted: false, reason: 'already_alerted' });
  assertEquals(again.sent, []);
});

Deno.test('ops watch › still failing in the next window → alerted again', async () => {
  const first = setup({ errors: [error(TRACE_A)] });
  await runOpsWatch(first.deps);
  const later = new Date(NOW.getTime() + ALERT_WINDOW_MS);
  const fresh = error(TRACE_B, { createdAt: new Date(later.getTime() - 1000).toISOString() });
  const next = setup({ errors: [fresh] }, { now: later });
  assertEquals((await runOpsWatch(next.deps)).alerted, true);
});

Deno.test('ops watch › errors older than 15 minutes are not alerted', async () => {
  const old = error(TRACE_A, { createdAt: '2026-11-11T04:40:00.000Z' });
  const { deps, sent } = setup({ errors: [old] });
  assertEquals(await runOpsWatch(deps), { alerted: false, reason: 'nothing_wrong' });
  assertEquals(sent, []);
});

Deno.test('ops watch › a stuck follow-up queue is a problem of its own, with no trace link', async () => {
  const summary = { ...EMPTY_OPS_SUMMARY, followups: { waiting: 3, stuck: 2, failedWeek: 0 } };
  const { deps, sent } = setup({ summary });
  assertEquals(await runOpsWatch(deps), { alerted: true, problems: 1, delivered: true });
  assertEquals(
    textOf(sent),
    [
      '⚠️ Easy Recovery AI: something failed',
      '',
      '• 2 follow-ups stuck for over 10 minutes',
      '',
      'Seen in the last 15 minutes.',
    ].join('\n'),
  );
  const one = { ...EMPTY_OPS_SUMMARY, followups: { waiting: 1, stuck: 1, failedWeek: 0 } };
  const single = setup({ summary: one });
  await runOpsWatch(single.deps);
  assertEquals(textOf(single.sent).includes('• 1 follow-up stuck for over 10 minutes'), true);
});

Deno.test('ops watch › at most five lines in one message', async () => {
  const many = Array.from(
    { length: MAX_ALERT_LINES + 3 },
    (_unused, index) =>
      error(`${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`, {
        step: `step_${index}`,
      }),
  );
  const { deps, sent } = setup({ errors: many });
  assertEquals(await runOpsWatch(deps), {
    alerted: true,
    problems: MAX_ALERT_LINES,
    delivered: true,
  });
  assertEquals(textOf(sent).split('\n').filter((line) => line.startsWith('• ')).length, 5);
});

Deno.test('ops watch › no dashboard set up → the message goes out without a link', async () => {
  const { deps, sent } = setup({ errors: [error(TRACE_A)] }, { link: null });
  await runOpsWatch(deps);
  assertEquals(textOf(sent).includes('Open the trace'), false);
});

Deno.test('ops watch › a refused alert is a warning, never an error (no alert about the alert)', async () => {
  const { deps, logs } = setup({ errors: [error(TRACE_A)] }, { refused: true });
  assertEquals(await runOpsWatch(deps), { alerted: true, problems: 1, delivered: false });
  assertEquals(logs, [['warn', 'ops_alert', { problems: 1, delivered: false }]]);
});

Deno.test('ops watch › the alert sender logs its own failures as warnings', () => {
  const lines: [LogLevel, string][] = [];
  const quiet = withoutErrors((level, event) => {
    lines.push([level, event]);
  });
  quiet('error', 'whatsapp_send_failed', { kind: 'text' });
  quiet('info', 'sent');
  assertEquals(lines, [['warn', 'whatsapp_send_failed'], ['info', 'sent']]);
});

Deno.test('ops watch › the message holds function names, steps and codes only', () => {
  const text = alertText(problemsOf([error(TRACE_A)]), null);
  assertEquals(/\d{10}/.test(text), false);
  assertEquals(text.includes('₹'), false);
});
