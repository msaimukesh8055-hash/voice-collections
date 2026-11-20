// supabase/functions/_shared/calls/agent-health.test.ts
// Agent health's maths: verdict counts, the checks that go wrong most, guardrail fails, reply
// time, cost, tone, the version live at each call and the 14-day trend.
import { assertEquals } from '@std/assert';
import {
  agentHealth,
  type CallScore,
  type Publish,
  type ScoredCheck,
  toCallScore,
  versionAt,
} from './agent-health.ts';
import { scoreMunshiCall } from './munshi-scorecard.ts';

function check(id: string, status: ScoredCheck['status'], group = 'Tools'): ScoredCheck {
  return { id, label: id.replaceAll('_', ' '), group, status };
}

function score(fields: Partial<CallScore> & Pick<CallScore, 'callId' | 'startedAt'>): CallScore {
  return {
    agent: 'asha',
    verdict: 'good',
    passed: 10,
    applicable: 10,
    checks: [],
    tone: {},
    costInr: 10,
    replyP50Ms: 1000,
    ...fields,
  };
}

const PUBLISHES: readonly Publish[] = [
  { agent: 'asha', version: 6, publishedAt: '2026-11-12T04:49:20Z' },
  { agent: 'asha', version: 7, publishedAt: '2026-11-20T04:27:28Z' },
  { agent: 'munshi', version: 1, publishedAt: '2026-11-08T03:03:06Z' },
];

const SCORES: readonly CallScore[] = [
  score({
    callId: 'c3',
    startedAt: '2026-11-20T06:00:00Z',
    verdict: 'failed',
    checks: [check('identity_first', 'fail', 'Guardrails'), check('repeated_calls', 'warn')],
    tone: { clear: 3 },
    costInr: 20,
    replyP50Ms: 1400,
  }),
  score({
    callId: 'c2',
    startedAt: '2026-11-19T06:00:00Z',
    verdict: 'check',
    checks: [check('repeated_calls', 'warn'), check('tone_clear', 'pass', 'Tone')],
    tone: { clear: 5 },
  }),
  score({ callId: 'c1', startedAt: '2026-11-13T06:00:00Z', replyP50Ms: 900 }),
  score({ callId: 'm1', agent: 'munshi', startedAt: '2026-11-20T08:00:00Z' }),
];

Deno.test('agent health › verdicts, guardrail fails, reply time and cost for one agent', () => {
  const health = agentHealth('asha', { scores: SCORES, publishes: PUBLISHES, today: '2026-11-20' });
  assertEquals(health.calls, 3);
  assertEquals(health.verdicts, { good: 1, check: 1, failed: 1 });
  assertEquals(health.guardrailFails, 1);
  assertEquals(health.replyP50Ms, 1000);
  assertEquals(health.averageCostInr, 13.33);
});

Deno.test('agent health › problems: fails first, then warnings, with the calls behind them', () => {
  const { problems } = agentHealth('asha', {
    scores: SCORES,
    publishes: PUBLISHES,
    today: '2026-11-20',
  });
  assertEquals(problems.map((one) => [one.id, one.fails, one.warns]), [
    ['identity_first', 1, 0],
    ['repeated_calls', 0, 2],
  ]);
  assertEquals(problems[1]?.callIds, ['c3', 'c2']);
});

Deno.test('agent health › tone averages and the version live at each call', () => {
  const health = agentHealth('asha', { scores: SCORES, publishes: PUBLISHES, today: '2026-11-20' });
  assertEquals(health.tone, [{ id: 'clear', label: 'tone clear', average: 4, calls: 2 }]);
  assertEquals(health.versions.map((one) => [one.version, one.calls, one.good]), [
    [7, 1, 0],
    [6, 2, 1],
  ]);
  assertEquals(versionAt(PUBLISHES, 'asha', '2026-11-01T00:00:00Z'), null);
  assertEquals(versionAt(PUBLISHES, 'munshi', '2026-11-20T00:00:00Z'), 1);
});

Deno.test('agent health › a 14-day trend ending today, by IST date', () => {
  const { trend } = agentHealth('asha', {
    scores: SCORES,
    publishes: PUBLISHES,
    today: '2026-11-20',
  });
  assertEquals(trend.length, 14);
  assertEquals(trend[0]?.date, '2026-11-07');
  assertEquals(trend.at(-1), { date: '2026-11-20', good: 0, check: 0, failed: 1 });
  assertEquals(trend.at(-2), { date: '2026-11-19', good: 0, check: 1, failed: 0 });
});

Deno.test('agent health › no calls: zeros and nulls, not errors', () => {
  const health = agentHealth('munshi', { scores: [], publishes: [], today: '2026-11-20' });
  assertEquals(health.calls, 0);
  assertEquals(health.replyP50Ms, null);
  assertEquals(health.averageCostInr, null);
  assertEquals(health.problems, []);
});

Deno.test('agent health › a scorecard becomes a kept score with its groups and tool rows', () => {
  const card = scoreMunshiCall({
    startedAt: '2026-11-20T05:00:00Z',
    durationSeconds: 60,
    transcript: [{ role: 'user', content: 'How much does Ramesh owe?' }],
    tools: [],
    steps: [],
  });
  const kept = toCallScore({
    agent: 'munshi',
    callId: 'm9',
    startedAt: '2026-11-20T05:00:00Z',
    tone: {},
    costInr: 4.13,
    replyP50Ms: null,
  }, card);
  assertEquals(kept.verdict, card.verdict);
  const missed = kept.checks.find((one) => one.id === 'tool_use_lookup_shopkeeper');
  assertEquals(missed?.status, 'fail');
  assertEquals(missed?.group, 'Tools needed');
});
