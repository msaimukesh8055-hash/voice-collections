// supabase/functions/_shared/db/fake-exchange-reads.ts
// In-memory ExchangeReads for tests. FAKE DATA ONLY: one typed credit that showed a Save card.
import type { ExchangeReads, ExchangeRow } from './exchange-repository.ts';

export function fakeExchange(overrides: Partial<ExchangeRow> = {}): ExchangeRow {
  return {
    id: 'e0000000-0000-4000-8000-000000000001',
    createdAt: '2026-11-22T05:00:00Z',
    waMessageId: 'wamid.FAKE1',
    msgType: 'text',
    path: 'command',
    command: 'add_credit',
    inText: 'Ramesh 5000 due 15th',
    replyText: '🧾 Add credit\nRamesh · ₹5,000\n[Save] [Edit] [Cancel]',
    language: 'en',
    repliesSent: 1,
    repliesFailed: 0,
    voiceReply: false,
    cardActionId: 'a0000000-0000-4000-8000-000000000001',
    answersActionId: null,
    moneyWrites: 0,
    errorCode: null,
    handleMs: 900,
    isTest: false,
    card: { status: 'saved', expiresAt: '2026-11-22T06:00:00Z' },
    ...overrides,
  };
}

export function fakeExchangeReads(rows: readonly ExchangeRow[] = [fakeExchange()]): ExchangeReads {
  return { listExchanges: (limit) => Promise.resolve(rows.slice(0, limit)) };
}
