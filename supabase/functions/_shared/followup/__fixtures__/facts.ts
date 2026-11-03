// supabase/functions/_shared/followup/__fixtures__/facts.ts
// Call facts for follow-up tests. FAKE DATA ONLY: Ramesh's live call on Mon 2 Nov, identity
// confirmed, nothing recorded yet. Tests add a promise, claim, callback or transcript.
import type { CallFacts } from '../facts.ts';

export const FACT_CALL_ID = 'ca000000-0000-4000-8000-0000000000aa';
export const FACT_CLAIM_ID = 'e1000000-0000-4000-8000-000000000001';

export function facts(overrides: Partial<CallFacts> = {}): CallFacts {
  return {
    callId: FACT_CALL_ID,
    shopkeeperId: '5e000000-0000-4000-8000-000000000001',
    shopkeeperName: 'Ramesh',
    shopName: 'Ramesh Kirana',
    mode: 'live',
    connected: true,
    declined: false,
    identity: 'confirmed',
    promise: null,
    claim: null,
    callbacks: [],
    toneLevel: 2,
    daysOverdue: 12,
    brokenPromises: 1,
    today: '2026-11-02',
    transcript: [
      { role: 'assistant', content: 'Namaste, I am Asha from Sri Lakshmi Traders.' },
      { role: 'user', content: 'Yes, Ramesh here.' },
    ],
    transcriptMissing: false,
    ...overrides,
  };
}

export const PROMISE = { amount: 2000, promiseDate: '2026-11-09' } as const;
export const CLAIM = {
  entryId: FACT_CLAIM_ID,
  amount: 1000,
  paidDate: '2026-11-01',
  mode: 'cash',
} as const;
