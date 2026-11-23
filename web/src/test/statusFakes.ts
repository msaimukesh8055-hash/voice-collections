// web/src/test/statusFakes.ts
// Fake data for the ops page's status section and the Evals page's model choice table
// (2026-11-23), kept apart from dashboardFakes.ts so neither file grows past the size limit.
import type { Evals } from '../lib/evalsSchemas.ts';
import type { OpsSummary } from '../lib/opsSchemas.ts';

export const TRACE_ID = '55555555-5555-4555-8555-555555555555';

/** Ops redesign: probes since 23 Nov, two targets met, one missed, one with no data. */
export const OPS_STATUS: NonNullable<OpsSummary['status']> = {
  measuredSince: '2026-11-23T10:52:03.000Z',
  now: {
    state: 'up',
    checkedAt: '2026-11-23T12:02:03.000Z',
    durationMs: 140,
    version: 'abc1234',
  },
  uptime: {
    day: { percent: 93.33, ok: 14, expected: 15 },
    week: { percent: 93.33, ok: 14, expected: 15 },
    all: { percent: 93.33, ok: 14, expected: 15 },
  },
  targets: [
    {
      id: 'uptime',
      name: 'App API up',
      goal: '99.5% of probes, 7 days',
      now: '93.33% (14 of 15)',
      met: false,
      how: 'Health probes that got a 200, out of every 5-minute slot.',
    },
    {
      id: 'requests',
      name: 'Requests that worked',
      goal: '99%, 7 days',
      now: '99.50% (995 of 1000)',
      met: true,
      how: 'Requests whose trace has no error step.',
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp message handled',
      goal: 'p95 under 5 s, 7 days',
      now: 'No messages',
      met: null,
      how: 'Time from the message reaching us to the reply.',
    },
  ],
  services: [
    {
      name: 'Sarvam voice agents',
      use: 'Asha and Munshi browser calls',
      calls: 18,
      failed: 2,
      lastFailedAt: '2026-11-22T06:42:25.000Z',
      state: 'recovered',
      how: 'Each call starts with our API asking Sarvam for a call link.',
    },
    {
      name: 'Gemini',
      use: 'Fallback when Sarvam fails',
      calls: 0,
      failed: 0,
      lastFailedAt: null,
      state: 'idle',
      how: 'Our fallback calls to Gemini in 7 days.',
    },
  ],
  jobs: [
    {
      name: 'followup-sweep',
      what: 'Due follow-ups and queued simulated calls',
      when: 'Every minute',
      lastRunAt: '2026-11-23T12:01:00.000Z',
      dayRuns: 1440,
      dayReached: 1440,
      state: 'ok',
      note: '1440 of 1440 runs reached the worker.',
    },
    {
      name: 'health-probe',
      what: 'Health check of the app API and database',
      when: 'Every 5 minutes',
      lastRunAt: null,
      dayRuns: 0,
      dayReached: 0,
      state: 'not_run',
      note: '0 of 0 runs reached the worker.',
    },
  ],
  errorGroups: [
    {
      source: 'followup-worker',
      step: 'worker_job_failed',
      errorCode: 'TimeoutError',
      count: 10,
      lastAt: '2026-11-21T04:15:07.000Z',
      traceId: TRACE_ID,
    },
  ],
};

/** Two models of a brain bake-off: one passes, one makes a money mistake. */
export const MODEL_RUNS: Evals['modelChoice'] = [
  {
    id: 'model-run-1',
    createdAt: '2026-11-23T10:00:00.000Z',
    metrics: {
      model: 'sarvam-105b',
      provider: 'sarvam',
      cases: 23,
      casesPassed: 22,
      moneyCases: 12,
      moneyFailures: 0,
      indicCases: 9,
      indicPassed: 9,
      failedCalls: 0,
      p50Ms: 2400,
      maxMs: 6100,
      avgTokensIn: 900,
      avgTokensOut: 120,
      costPer1000Inr: 14.16,
      priceNote: 'Sarvam list price, introductory.',
      passed: true,
      reasons: [],
    },
  },
  {
    id: 'model-run-2',
    createdAt: '2026-11-23T10:20:00.000Z',
    metrics: {
      model: 'gemini-2.5-flash',
      provider: 'gemini',
      cases: 23,
      casesPassed: 20,
      moneyCases: 12,
      moneyFailures: 2,
      indicCases: 9,
      indicPassed: 7,
      failedCalls: 1,
      p50Ms: 1800,
      maxMs: 4200,
      avgTokensIn: 950,
      avgTokensOut: 100,
      costPer1000Inr: 0,
      priceNote: 'Gemini free tier.',
      passed: false,
      reasons: ['2 money cases wrong'],
    },
  },
];
