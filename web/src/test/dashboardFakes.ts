// web/src/test/dashboardFakes.ts
// A fake dashboard client for page tests (M6): fixed fake figures, a switch to act as "no link",
// and a record of what the page asked for.
import {
  type CallDetail,
  type CallRow,
  type DashboardApi,
  NeedsLinkError,
  type Overview,
  type ShopkeeperDetail,
  type ShopkeeperList,
} from '../lib/dashboardApi.ts';
import type { OpsSummary, Trace } from '../lib/opsSchemas.ts';

export const RAMESH = {
  id: 'b0000000-0000-4000-8000-000000000001',
  name: 'Ramesh',
  shopName: 'Ramesh Kirana',
  area: 'Old Town',
  language: 'te' as const,
};

export const CALL_ROW: CallRow = {
  id: 'c0000000-0000-4000-8000-000000000001',
  shopkeeperId: RAMESH.id,
  mode: 'live',
  status: 'completed',
  language: 'te',
  toneLevel: 2,
  queuedAt: '2026-11-04T05:00:00Z',
  endedAt: '2026-11-04T05:03:00Z',
  durationSeconds: 170,
  summary: '📞 Asha called Ramesh\n\nPromised to pay',
  shopkeeperName: 'Ramesh',
  shopName: 'Ramesh Kirana',
  cost: { inr: 12.39, estimate: false },
};

export const OVERVIEW: Overview = {
  owner: { name: 'Srinivas Reddy', businessName: 'Sri Lakshmi Traders' },
  settings: { englishUnderTelugu: true },
  insights: {
    today: '2026-11-18',
    split: { month: '2026-11', collected: 30000, notYetDue: 40000, overdue: 30000, total: 100000 },
    percentCollected: 30,
    weekChange: 6,
    outstanding: 184000,
    top: [{ shopkeeper: RAMESH, overdueAmount: 5000, daysOverdue: 12, score: 42, band: 'risky' }],
  },
  calls: [CALL_ROW, { ...CALL_ROW, id: 'c2', mode: 'simulated', cost: { inr: 1, estimate: true } }],
};

export const SHOPKEEPERS: ShopkeeperList = {
  today: '2026-11-18',
  shopkeepers: [
    { ...RAMESH, outstanding: 8500, overdueAmount: 5000, daysOverdue: 12 },
    {
      id: 'b2',
      name: 'Latha',
      shopName: 'Latha General Stores',
      area: 'Clock Tower',
      language: 'te',
      outstanding: 2000,
      overdueAmount: 0,
      daysOverdue: 0,
    },
  ],
};

export const SHOPKEEPER: ShopkeeperDetail = {
  today: '2026-11-18',
  shopkeeper: RAMESH,
  dues: {
    outstanding: 8500,
    overdueAmount: 5000,
    daysOverdue: 12,
    nextDueDate: '2026-11-21',
    nextDueAmount: 3500,
  },
  score: {
    score: 42,
    band: 'risky',
    parts: { paidOnTime: 20, promisesKept: 15, currentOverdue: 2, answersCalls: 5 },
  },
  entries: [
    {
      id: 'e1',
      kind: 'credit',
      amount: 5000,
      entryDate: '2026-10-06',
      dueDate: '2026-10-21',
      status: 'confirmed',
    },
  ],
  promises: [{ amount: 3000, promiseDate: '2026-10-30', status: 'broken', createdAt: 'p1' }],
  notes: [{ note: 'Busy shop; promised Monday.', createdAt: '2026-11-04T05:04:00Z' }],
  calls: [CALL_ROW],
};

export const CALL: CallDetail = {
  ...CALL_ROW,
  transcript: [
    { role: 'assistant', content: 'Namaste, I am Asha.' },
    { role: 'user', content: 'Monday I will pay.' },
    { role: 'user', content: 'సోమవారం ఇస్తాను.' },
  ],
  transcriptEnglish: [null, null, 'I will give on Monday.'],
  toolEvents: [
    { tool: 'get_dues', args: {}, result: { ok: true }, durationMs: 120, createdAt: 't1' },
  ],
  followup: { path: 'rule', decision: 'check_promise', reasoning: 'Promise logged' },
};

export const TRACE_ID = '55555555-5555-4555-8555-555555555555';

export const OPS: OpsSummary = {
  day: { requests: 40, failed: 1 },
  week: { requests: 300, failed: 30 },
  sources: [{ source: 'sarvam-tools', requests: 12, failed: 0, p95Ms: 180 }],
  tools: [
    { agent: 'asha', tool: 'get_dues', calls: 9, p50Ms: 120, p95Ms: 310 },
    { agent: 'munshi', tool: 'book_summary', calls: 4, p50Ms: 300, p95Ms: 640 },
  ],
  llm: [{ provider: 'sarvam', answers: 20, rejected: 3, failed: 1 }],
  tokens: [
    {
      provider: 'sarvam',
      today: { input: 100, output: 10 },
      month: { input: 1000, output: 90 },
    },
  ],
  paths: { command: 14, button: 1, sarvam: 4, gemini: 1 },
  followups: { waiting: 2, stuck: 0, failedWeek: 1 },
  voice: {
    today: { liveMinutes: 2, simulatedCalls: 3 },
    month: { liveMinutes: 10, simulatedCalls: 12 },
  },
  recentErrors: [
    {
      traceId: TRACE_ID,
      source: 'whatsapp-webhook',
      step: 'whatsapp_background_failed',
      errorCode: 'RepositoryError',
      createdAt: '2026-11-11T05:00:00.000Z',
    },
  ],
  toolTargetMs: 500,
  spend: {
    capInr: 1000,
    today: { voiceInr: 8.26, llmInr: 4.32, totalInr: 12.58 },
    month: { voiceInr: 41.3, llmInr: 43.19, totalInr: 84.49 },
  },
  generatedAt: '2026-11-11T05:30:00.000Z',
};

export const TRACE: Trace = {
  traceId: TRACE_ID,
  steps: [
    {
      source: 'whatsapp-webhook',
      step: 'brain_llm',
      status: 'warn',
      errorCode: 'bad_json',
      provider: 'sarvam',
      durationMs: 412,
      tokensIn: null,
      tokensOut: null,
      detail: { provider: 'sarvam', outcome: 'bad_json', ms: 412 },
      createdAt: '2026-11-11T05:00:00.000Z',
    },
    {
      source: 'whatsapp-webhook',
      step: 'llm_usage',
      status: 'ok',
      errorCode: null,
      provider: 'gemini',
      durationMs: null,
      tokensIn: 812,
      tokensOut: 44,
      detail: { provider: 'gemini', model: 'gemini-2.5-flash', tokens_in: 812, tokens_out: 44 },
      createdAt: '2026-11-11T05:00:01.250Z',
    },
    {
      source: 'whatsapp-webhook',
      step: 'whatsapp_background_failed',
      status: 'error',
      errorCode: 'RepositoryError',
      provider: null,
      durationMs: null,
      tokensIn: null,
      tokensOut: null,
      detail: { error: 'RepositoryError' },
      createdAt: '2026-11-11T05:00:01.590Z',
    },
  ],
};

export interface FakeDashboard {
  readonly dashboard: DashboardApi;
  readonly requests: string[];
  needsLink: boolean;
  english: boolean;
  /** What the ops page gets; tests swap it to show other states. */
  ops: OpsSummary;
}

export function fakeDashboard(): FakeDashboard {
  const fake: FakeDashboard = {
    requests: [],
    needsLink: false,
    english: true,
    ops: OPS,
    dashboard: {
      hasToken: () => !fake.needsLink,
      localDemo: () => Promise.resolve(false),
      overview: () => answer('overview', OVERVIEW),
      shopkeepers: () => answer('shopkeepers', SHOPKEEPERS),
      shopkeeper: (id) => answer(`shopkeeper:${id}`, SHOPKEEPER),
      calls: () => answer('calls', [CALL_ROW]),
      call: (id) => answer(`call:${id}`, CALL),
      ops: () => answer('ops', fake.ops),
      trace: (id) => answer(`trace:${id}`, TRACE),
      setEnglishUnderTelugu: (on) => {
        fake.english = on;
        return answer(`english:${String(on)}`, on);
      },
    },
  };
  function answer<T>(request: string, value: T): Promise<T> {
    fake.requests.push(request);
    return fake.needsLink ? Promise.reject(new NeedsLinkError('no link')) : Promise.resolve(value);
  }
  return fake;
}
