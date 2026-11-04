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

export interface FakeDashboard {
  readonly dashboard: DashboardApi;
  readonly requests: string[];
  needsLink: boolean;
  english: boolean;
}

export function fakeDashboard(): FakeDashboard {
  const fake: FakeDashboard = {
    requests: [],
    needsLink: false,
    english: true,
    dashboard: {
      hasToken: () => !fake.needsLink,
      localDemo: () => Promise.resolve(false),
      overview: () => answer('overview', OVERVIEW),
      shopkeepers: () => answer('shopkeepers', SHOPKEEPERS),
      shopkeeper: (id) => answer(`shopkeeper:${id}`, SHOPKEEPER),
      calls: () => answer('calls', [CALL_ROW]),
      call: (id) => answer(`call:${id}`, CALL),
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
