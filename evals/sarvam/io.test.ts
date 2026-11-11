// evals/sarvam/io.test.ts
// The parts of the Sarvam evals that talk to something else, over a fake network: the Sarvam
// Tests client, the eval database access, and the runner that ties them together.
import { describe, expect, it } from 'vitest';
import { ASHA_CASES } from './asha-cases.ts';
import {
  createSarvamTests,
  MAX_RATE_LIMIT_RETRIES,
  retryAfterSeconds,
  type SarvamTests,
  SarvamTestsError,
} from './client.ts';
import { createEvalDb, type EvalDb, EvalDbError } from './eval-db.ts';
import { buildEvalRows } from './eval-data.ts';
import { CALL_TOKEN, EvalRunError, resumeRun, type RunPlan, runSuite } from './runner.ts';
import type { CallEvidence } from './types.ts';

interface Sent {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

/** A fetch that answers from a queue and records what was sent. */
function fakeFetch(replies: readonly Response[]): { fetchImpl: typeof fetch; sent: Sent[] } {
  const queue = [...replies];
  const sent: Sent[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    sent.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: init?.headers as Record<string, string>,
      body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
    });
    return Promise.resolve(queue.shift() ?? new Response('{}', { status: 500 }));
  };
  return { fetchImpl, sent };
}

const AGENT = { appId: 'Asha-app', appVersion: 6 };
const BASE = 'https://apps.sarvam.ai/api/evals/v1/org-1/ws-1/test-suites';

function client(replies: readonly Response[]): {
  api: SarvamTests;
  sent: Sent[];
  waits: number[];
} {
  const { fetchImpl, sent } = fakeFetch(replies);
  const waits: number[] = [];
  const api = createSarvamTests({
    apiKey: 'key',
    orgId: 'org-1',
    workspaceId: 'ws-1',
    fetchImpl,
    sleep: () => Promise.resolve(),
    onWait: (seconds) => waits.push(seconds),
  });
  return { api, sent, waits };
}

describe('Sarvam Tests client', () => {
  it('creates a suite, then reads it back for each case id by name', async () => {
    const suite = {
      name: 's',
      description: 'd',
      variables: [],
      global_guardrails: ['g'],
      test_cases: [],
    };
    const { api, sent } = client([
      Response.json({ test_suite_id: 'suite-1' }, { status: 201 }),
      Response.json({ test_cases: [{ test_case_id: 'tc-1', name: 'asha-01' }] }),
    ]);
    const created = await api.createSuite(suite);
    expect(created.suiteId).toBe('suite-1');
    expect(created.caseIds.get('asha-01')).toBe('tc-1');
    expect(sent.map((request) => [request.method, request.url])).toEqual([
      ['POST', BASE],
      ['GET', `${BASE}/suite-1`],
    ]);
    expect(sent[0]?.body).toEqual(suite);
    expect(sent[0]?.headers['X-API-Key']).toBe('key');
  });

  it('maps each agent variable to the suite variable of the same name', async () => {
    const { api, sent } = client([Response.json({ map_id: 'm' }, { status: 201 })]);
    await api.mapVariables('suite-1', AGENT, ['call_token', 'today']);
    expect(sent[0]?.url).toBe(`${BASE}/suite-1/mappings`);
    expect(sent[0]?.body).toEqual({
      app_id: 'Asha-app',
      app_version: 6,
      variable_mapping: { call_token: 'call_token', today: 'today' },
    });
  });

  it('starts a run once per case and reads its progress', async () => {
    const { api, sent } = client([
      Response.json({ run_id: 'run-1', status: 'running' }, { status: 202 }),
      Response.json({ status: 'running', total_executions: 9, completed_executions: 4 }),
    ]);
    expect(await api.startRun('suite-1', AGENT, 'nightly')).toBe('run-1');
    expect(sent[0]?.body).toEqual({
      app_id: 'Asha-app',
      app_version: 6,
      frequency: 1,
      run_name: 'nightly',
      on_end_eval: true,
    });
    expect(await api.getRun('suite-1', 'run-1')).toEqual({
      status: 'running',
      total: 9,
      completed: 4,
    });
  });

  it('reads a case: transcript and one pass or fail per behaviour', async () => {
    const execution = {
      transcript: [
        { role: 'assistant', content: 'Namaste' },
        { role: 'user', content: null },
      ],
      evaluation_results: [
        { name: 'Polite close', verdict: 'Pass', reasoning: 'thanked' },
        { name: 'Guardrails', verdict: 'Fail', reasoning: null },
      ],
    };
    const { api, sent } = client([Response.json({ executions: [execution] })]);
    const results = await api.getCaseResults('suite-1', { runId: 'run-1', caseId: 'tc-1' });
    expect(sent[0]?.url).toBe(`${BASE}/suite-1/runs/run-1/test-cases/tc-1`);
    expect(results).toEqual([
      {
        transcript: [
          { role: 'assistant', content: 'Namaste' },
          { role: 'user', content: '' },
        ],
        verdicts: [
          { name: 'Polite close', passed: true, reasoning: 'thanked' },
          { name: 'Guardrails', passed: false, reasoning: '' },
        ],
      },
    ]);
  });

  it('an older run with only transcript text, or no verdicts, is still read', async () => {
    const { api } = client([Response.json({ executions: [{ transcript_text: 'A: hi' }] })]);
    const [execution] = await api.getCaseResults('s', { runId: 'r', caseId: 'c' });
    expect(execution).toEqual({
      transcript: [{ role: 'transcript', content: 'A: hi' }],
      verdicts: [],
    });
  });

  it('waits out a rate limit as long as Sarvam says, then carries on', async () => {
    const limited = new Response('{}', { status: 429, headers: { 'retry-after': '60' } });
    const { api, waits } = client([limited, Response.json({ run_id: 'run-1' }, { status: 202 })]);
    expect(await api.startRun('suite-1', AGENT, 'n')).toBe('run-1');
    expect(waits).toEqual([60]);
  });

  it('gives up after the allowed retries, and on any other error at once', async () => {
    const limited = (): Response => new Response('{}', { status: 429 });
    const always = client(Array.from({ length: MAX_RATE_LIMIT_RETRIES + 1 }, limited));
    await expect(always.api.getRun('s', 'r')).rejects.toThrow('read run failed (HTTP 429)');
    expect(always.waits).toHaveLength(MAX_RATE_LIMIT_RETRIES);
    const noCredits = client([new Response('{}', { status: 402 })]);
    await expect(noCredits.api.startRun('s', AGENT, 'n')).rejects.toBeInstanceOf(SarvamTestsError);
    expect(noCredits.waits).toEqual([]);
  });

  it('retry-after: used when sane, capped when huge, a default when missing or odd', () => {
    const after = (value: string | null): number =>
      retryAfterSeconds(
        new Response('', { headers: value === null ? {} : { 'retry-after': value } }),
      );
    expect([after('12.2'), after('9999'), after(null), after('soon'), after('0')]).toEqual([
      13, 150, 30, 30, 30,
    ]);
  });

  it('a reply in an unexpected shape fails loudly', async () => {
    const { api } = client([Response.json({ nope: true }, { status: 202 })]);
    await expect(api.startRun('s', AGENT, 'n')).rejects.toThrow();
  });
});

function database(replies: readonly Response[]): { db: EvalDb; sent: Sent[] } {
  const { fetchImpl, sent } = fakeFetch(replies);
  const db = createEvalDb({
    supabaseUrl: 'https://ref.supabase.co/',
    serviceRoleKey: 'service',
    fetchImpl,
  });
  return { db, sent };
}

const REST = 'https://ref.supabase.co/rest/v1/';
const EMPTY = (): Response => new Response('', { status: 201 });
const NOW = new Date('2026-11-11T16:00:00.000Z');

describe('eval database access', () => {
  it('reads the demo clock, or null when it is not set', async () => {
    const set = database([Response.json([{ demo_clock: '2026-11-02T06:30:00+00:00' }])]);
    expect(await set.db.getDemoClock()).toBe('2026-11-02T06:30:00+00:00');
    expect(await database([Response.json([])]).db.getDemoClock()).toBeNull();
  });

  it('inserts parents before children and skips empty tables', async () => {
    const rows = buildEvalRows([ASHA_CASES[0] as (typeof ASHA_CASES)[number]], {
      today: '2026-11-11',
      now: NOW,
      newId: () => crypto.randomUUID(),
      owner: { name: 'S', businessName: 'B' },
    });
    const { db, sent } = database([EMPTY(), EMPTY(), EMPTY(), EMPTY()]);
    await db.insertRows(rows);
    expect(sent.map((request) => request.url.replace(REST, ''))).toEqual([
      'owners',
      'shopkeepers',
      'ledger_entries',
      'calls',
    ]);
    expect(sent.every((request) => request.method === 'POST')).toBe(true);
    expect(sent[0]?.headers['Authorization']).toBe('Bearer service');
  });

  it('reads what one call left: tools in order, promises, claims and the balance', async () => {
    const { db, sent } = database([
      Response.json([
        { tool: 'confirm_identity', result: { ok: true, say: 'x' } },
        { tool: 'get_dues', result: { ok: false, code: 'X', say: 'y' } },
      ]),
      Response.json([{ id: 'p1' }]),
      Response.json([]),
      Response.json([{ outstanding: '8500.00' }]),
    ]);
    const evidence = await db.readEvidence({ shopkeeperId: 'shop-1', callId: 'call-1' }, 8500);
    expect(evidence).toEqual<CallEvidence>({
      tools: [
        { tool: 'confirm_identity', ok: true },
        { tool: 'get_dues', ok: false },
      ],
      promises: 1,
      claims: 0,
      outstandingBefore: 8500,
      outstandingAfter: 8500,
    });
    expect(sent.map((request) => request.url.replace(REST, '').split('?')[0])).toEqual([
      'tool_events',
      'promises',
      'ledger_entries',
      'balances',
    ]);
    expect(sent[2]?.url).toContain('call_id=eq.call-1&status=eq.claimed');
  });

  it('a missing balance row reads as not-a-number, which the checks fail', async () => {
    const { db } = database([
      Response.json([]),
      Response.json([]),
      Response.json([]),
      Response.json([]),
    ]);
    const evidence = await db.readEvidence({ shopkeeperId: 's', callId: 'c' }, 1);
    expect(Number.isNaN(evidence.outstandingAfter)).toBe(true);
  });

  it('closes only the calls it was given, and only while they are still open', async () => {
    const { db, sent } = database([EMPTY()]);
    await db.closeCalls(['call-1', 'call-2'], NOW);
    expect(sent[0]?.method).toBe('PATCH');
    expect(sent[0]?.url).toBe(
      `${REST}calls?id=in.(call-1,call-2)&status=in.(accepted,in_progress)`,
    );
    expect(sent[0]?.body).toEqual({ status: 'completed', ended_at: NOW.toISOString() });
    const none = database([]);
    await none.db.closeCalls([], NOW);
    expect(none.sent).toEqual([]);
  });

  it('stores a run, then its case results under the new run id', async () => {
    const { db, sent } = database([Response.json([{ id: 'run-9' }], { status: 201 }), EMPTY()]);
    const id = await db.saveRun({
      target: 'asha',
      promptHash: 'abc',
      metrics: { passed: true },
      results: [{ scenarioId: 'asha-01', scores: { a: 1 }, transcript: 't', pass: true }],
    });
    expect(id).toBe('run-9');
    expect(sent[0]?.body).toEqual({
      target: 'asha',
      prompt_hash: 'abc',
      metrics: { passed: true },
    });
    expect(sent[1]?.body).toEqual([
      { run_id: 'run-9', scenario_id: 'asha-01', scores: { a: 1 }, transcript: 't', pass: true },
    ]);
  });

  it('a database error names the operation and status only; no id back is an error too', async () => {
    const down = database([new Response('{"message":"secret detail"}', { status: 503 })]);
    await expect(down.db.getDemoClock()).rejects.toThrow('read settings failed (HTTP 503)');
    const noId = database([Response.json([], { status: 201 })]);
    const run = { target: 'asha', promptHash: 'a', metrics: {}, results: [] };
    await expect(noId.db.saveRun(run)).rejects.toBeInstanceOf(EvalDbError);
  });
});

const CASES = ASHA_CASES.filter((evalCase) => ['asha-01', 'asha-07'].includes(evalCase.id));

function plan(): RunPlan {
  let next = 0;
  return {
    agent: AGENT,
    suiteName: 'asha-evals-test',
    cases: CASES,
    guardrails: ['g'],
    sharedVariables: [{ name: 'today', value: '2026-11-11' }],
    data: {
      today: '2026-11-11',
      now: NOW,
      newId: () => `id-${(next += 1)}`,
      owner: { name: 'S', businessName: 'B' },
    },
  };
}

interface Harness {
  readonly sarvam: SarvamTests;
  readonly db: EvalDb;
  readonly closed: string[][];
  readonly suites: Parameters<SarvamTests['createSuite']>[0][];
  readonly mapped: string[][];
}

function harness(options: { statuses?: string[]; evidence?: Partial<CallEvidence> } = {}): Harness {
  const statuses = [...(options.statuses ?? ['running', 'completed'])];
  const closed: string[][] = [];
  const suites: Harness['suites'] = [];
  const mapped: string[][] = [];
  const sarvam: SarvamTests = {
    createSuite: (suite) => {
      suites.push(suite);
      const caseIds = new Map(suite.test_cases.map((item) => [item.name, `tc-${item.name}`]));
      return Promise.resolve({ suiteId: 'suite-1', caseIds });
    },
    mapVariables: (_suiteId, _agent, names) => {
      mapped.push([...names]);
      return Promise.resolve();
    },
    listCases: () =>
      Promise.resolve(
        (suites[0]?.test_cases ?? []).map((item) => ({
          caseId: `tc-${item.name}`,
          name: item.name,
          variables: new Map(item.variable_overrides.map((pair) => [pair.name, pair.value])),
        })),
      ),
    startRun: () => Promise.resolve('run-1'),
    getRun: () => {
      const status = (statuses.shift() ?? 'running') as 'running' | 'completed' | 'failed';
      return Promise.resolve({ status, total: 2, completed: status === 'completed' ? 2 : 0 });
    },
    getCaseResults: () =>
      Promise.resolve([
        {
          transcript: [{ role: 'assistant', content: 'Namaste' }],
          verdicts: [{ name: 'Polite close', passed: true, reasoning: '' }],
        },
      ]),
  };
  const db: EvalDb = {
    getDemoClock: () => Promise.resolve(null),
    insertRows: () => Promise.resolve(),
    readEvidence: (_ids, outstandingBefore) =>
      Promise.resolve({
        tools: [{ tool: 'confirm_identity', ok: true }],
        promises: 0,
        claims: 0,
        outstandingBefore,
        outstandingAfter: outstandingBefore,
        ...options.evidence,
      }),
    findShopkeeper: (callId) => Promise.resolve(callId === 'unknown' ? null : `shop-of-${callId}`),
    closeCalls: (callIds) => {
      closed.push([...callIds]);
      return Promise.resolve();
    },
    saveRun: () => Promise.resolve('stored'),
  };
  return { sarvam, db, closed, suites, mapped };
}

function deps(h: Harness, clock: () => Date = () => NOW): Parameters<typeof runSuite>[1] {
  return { sarvam: h.sarvam, db: h.db, sleep: () => Promise.resolve(), now: clock };
}

describe('runner', () => {
  it('points each case at its own call token and maps every variable to the agent', async () => {
    const h = harness();
    await runSuite(plan(), deps(h));
    const suite = h.suites[0];
    const tokens = suite?.test_cases.map(
      (item) => item.variable_overrides.find((variable) => variable.name === CALL_TOKEN)?.value,
    );
    expect(tokens).toEqual(['id-3', 'id-5']);
    expect(suite?.test_cases.map((item) => item.name)).toEqual(['asha-01', 'asha-07']);
    expect(h.mapped[0]).toEqual(['today', CALL_TOKEN, 'shopkeeper_name', 'shop_name']);
  });

  it('combines the judge and our checks: the wrong-person case passes, the promise case does not', async () => {
    const h = harness();
    const outcome = await runSuite(plan(), deps(h));
    expect(outcome.results.map((result) => [result.id, result.passed])).toEqual([
      ['asha-01', false],
      ['asha-07', true],
    ]);
    const failed = outcome.results[0]?.checks.filter((check) => !check.passed);
    expect(failed?.map((check) => check.id)).toEqual(['promises_saved', 'must_call']);
    expect([outcome.suiteId, outcome.runId]).toEqual(['suite-1', 'run-1']);
  });

  it('always closes the eval calls: after a good run, a failed run and a run that never ends', async () => {
    const good = harness();
    await runSuite(plan(), deps(good));
    expect(good.closed).toEqual([['id-3', 'id-5']]);

    const failed = harness({ statuses: ['failed'] });
    await expect(runSuite(plan(), deps(failed))).rejects.toBeInstanceOf(EvalRunError);
    expect(failed.closed).toHaveLength(1);

    let minutes = 0;
    const stuck = harness({ statuses: [] });
    const clock = (): Date => new Date(NOW.getTime() + (minutes += 3) * 60_000);
    await expect(runSuite(plan(), deps(stuck, clock))).rejects.toThrow('did not finish in time');
    expect(stuck.closed).toHaveLength(1);
  });

  it('a case Sarvam returned nothing for is a failure, never a pass', async () => {
    const h = harness();
    const silent: SarvamTests = { ...h.sarvam, getCaseResults: () => Promise.resolve([]) };
    const outcome = await runSuite(plan(), { ...deps(h), sarvam: silent });
    expect(outcome.results.map((result) => result.passed)).toEqual([false, false]);
    expect(outcome.results[1]?.transcript).toEqual([]);
  });

  it('picks up a started run from the suite in Sarvam and our own call rows, without a new run', async () => {
    const h = harness();
    await runSuite(plan(), deps(h));
    let started = 0;
    const sarvam: SarvamTests = {
      ...h.sarvam,
      startRun: () => {
        started += 1;
        return Promise.resolve('never');
      },
      getRun: () => Promise.resolve({ status: 'completed', total: 2, completed: 2 }),
    };
    const outcome = await resumeRun(
      CASES,
      { suiteId: 'suite-1', runId: 'run-1' },
      {
        ...deps(h),
        sarvam,
      },
    );
    expect(started).toBe(0);
    expect(outcome.results.map((result) => result.id)).toEqual(['asha-01', 'asha-07']);
    expect(h.closed.at(-1)).toEqual(['id-3', 'id-5']);
  });

  it('refuses to resume a suite none of whose cases has an eval call', async () => {
    const h = harness();
    const sarvam: SarvamTests = { ...h.sarvam, listCases: () => Promise.resolve([]) };
    const run = resumeRun(CASES, { suiteId: 's', runId: 'r' }, { ...deps(h), sarvam });
    await expect(run).rejects.toThrow('none of the suite cases match an eval call');
  });
});

describe('network blips', () => {
  it('the Sarvam client waits and retries when there is no reply at all', async () => {
    let calls = 0;
    const waits: number[] = [];
    const api = createSarvamTests({
      apiKey: 'key',
      orgId: 'org-1',
      workspaceId: 'ws-1',
      fetchImpl: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new TypeError('fetch failed'))
          : Promise.resolve(Response.json({ run_id: 'run-1' }, { status: 202 }));
      },
      sleep: () => Promise.resolve(),
      onWait: (seconds) => waits.push(seconds),
    });
    expect(await api.startRun('s', AGENT, 'n')).toBe('run-1');
    expect(waits).toEqual([30]);
  });

  it('the eval database retries a missing reply, but not an answer that says no', async () => {
    let calls = 0;
    const db = createEvalDb({
      supabaseUrl: 'https://ref.supabase.co',
      serviceRoleKey: 'service',
      fetchImpl: () => {
        calls += 1;
        return calls < 3
          ? Promise.reject(new TypeError('fetch failed'))
          : Promise.resolve(Response.json([{ shopkeeper_id: 'shop-1' }]));
      },
      sleep: () => Promise.resolve(),
    });
    expect(await db.findShopkeeper('call-1')).toBe('shop-1');
    expect(calls).toBe(3);
    const down = createEvalDb({
      supabaseUrl: 'https://ref.supabase.co',
      serviceRoleKey: 'service',
      fetchImpl: () => Promise.reject(new TypeError('fetch failed')),
      sleep: () => Promise.resolve(),
    });
    await expect(down.findShopkeeper('call-1')).rejects.toThrow('find call failed (HTTP 0)');
    expect(
      await createEvalDb({
        supabaseUrl: 'https://ref.supabase.co',
        serviceRoleKey: 'service',
        fetchImpl: () => Promise.resolve(Response.json([])),
      }).findShopkeeper('nobody'),
    ).toBeNull();
  });
});
