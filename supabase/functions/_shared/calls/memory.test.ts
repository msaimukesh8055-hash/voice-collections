// supabase/functions/_shared/calls/memory.test.ts
// Memory (SPEC §7.3, M5 Decision 2): last promise (kept/broken, what was paid) and a recently
// rejected payment claim, all from the records. The LLM-written call note is not part of it
// (CP2 M2). Nothing known → nothing said.
import { assert, assertEquals } from '@std/assert';
import type { PromiseRecord } from '../ledger/promise-check.ts';
import type { LedgerEntry } from '../schemas/ledger.ts';
import {
  buildMemory,
  cleanNote,
  describeMemory,
  EMPTY_MEMORY,
  type Memory,
  memoryData,
} from './memory.ts';

const TODAY = '2026-11-02';

const BROKEN: PromiseRecord = {
  id: 'p2',
  amount: 3000,
  promiseDate: '2026-10-30',
  status: 'broken',
  createdAt: '2026-10-23T05:00:00Z',
};
const KEPT: PromiseRecord = {
  id: 'p1',
  amount: 2500,
  promiseDate: '2026-08-14',
  status: 'kept',
  createdAt: '2026-08-06T05:00:00Z',
};

function payment(amount: number, entryDate: string, status: LedgerEntry['status']): LedgerEntry {
  return { kind: 'payment', amount, entryDate, dueDate: null, status };
}

function memoryOf(
  promises: readonly PromiseRecord[],
  entries: readonly LedgerEntry[] = [],
): Memory {
  return buildMemory({ promises, entries, today: TODAY });
}

Deno.test('memory › nothing known gives empty memory and says nothing', () => {
  const memory = memoryOf([]);
  assertEquals(memory, EMPTY_MEMORY);
  assertEquals(describeMemory(memory), '');
});

Deno.test('memory › the newest promise is the last one; a replaced one is skipped', () => {
  const replaced: PromiseRecord = {
    ...BROKEN,
    id: 'p3',
    status: 'replaced',
    createdAt: '2026-10-25T00:00:00Z',
  };
  const memory = memoryOf([KEPT, replaced, BROKEN], [payment(1000, '2026-10-24', 'confirmed')]);
  assertEquals(memory.lastPromise, {
    amount: 3000,
    promiseDate: '2026-10-30',
    status: 'broken',
    paid: 1000,
  });
});

Deno.test('memory › only replaced promises means no last promise', () => {
  assertEquals(memoryOf([{ ...BROKEN, status: 'replaced' }]).lastPromise, null);
});

Deno.test('memory › a broken promise is described with what was paid', () => {
  assertEquals(
    describeMemory(memoryOf([BROKEN])),
    'Last promise: 3,000 rupees by Friday, 30 October 2026. Broken: 0 rupees of it was paid.',
  );
});

Deno.test('memory › a kept or open promise is described as such', () => {
  assert(describeMemory(memoryOf([KEPT])).endsWith('Kept.'));
  const open: PromiseRecord = { ...BROKEN, status: 'open', promiseDate: '2026-11-05' };
  assert(describeMemory(memoryOf([open])).endsWith('Still open.'));
});

Deno.test('memory › a stored note is cleaned to one capped line (for the owner and dashboard)', () => {
  const note = '  Said the shop was shut\nfor a wedding.  '.padEnd(400, 'x');
  const line = cleanNote(note);
  assertEquals(line?.length, 240);
  assert(line?.startsWith('Said the shop was shut for a wedding.'));
});

Deno.test('memory › a blank note counts as no note', () => {
  assertEquals(cleanNote('   '), null);
  assertEquals(cleanNote(null), null);
});

Deno.test('memory › holds no free text: only figures and dates from the records (CP2 M2)', () => {
  const memory = memoryOf([BROKEN], [payment(1000, '2026-10-28', 'rejected')]);
  assertEquals(Object.keys(memory).sort(), ['lastPromise', 'rejectedClaim']);
  assertEquals(describeMemory(memory).includes('note'), false);
  assertEquals(Object.keys(memoryData(memory)).some((key) => key.includes('note')), false);
});

Deno.test('memory › the newest rejected claim of the last 30 days is remembered', () => {
  const entries = [
    payment(500, '2026-09-01', 'rejected'),
    payment(1000, '2026-10-28', 'rejected'),
    payment(800, '2026-10-20', 'rejected'),
    payment(900, '2026-10-30', 'claimed'),
  ];
  const memory = memoryOf([], entries);
  assertEquals(memory.rejectedClaim, { amount: 1000, paidDate: '2026-10-28' });
  assertEquals(
    describeMemory(memory),
    'The owner did not receive a payment of 1,000 rupees they said was made on ' +
      'Wednesday, 28 October 2026.',
  );
});

Deno.test('memory › a rejected claim older than 30 days is forgotten', () => {
  assertEquals(memoryOf([], [payment(500, '2026-10-02', 'rejected')]).rejectedClaim, null);
});

Deno.test('memory › tool data is flat, with nulls when nothing is known', () => {
  assertEquals(memoryData(EMPTY_MEMORY), {
    last_promise_amount: null,
    last_promise_date: null,
    last_promise_status: null,
    last_promise_paid: null,
    rejected_claim_amount: null,
    rejected_claim_date: null,
  });
  const memory = buildMemory({
    promises: [BROKEN],
    entries: [payment(1000, '2026-10-28', 'rejected')],
    today: TODAY,
  });
  assertEquals(memoryData(memory), {
    last_promise_amount: 3000,
    last_promise_date: '2026-10-30',
    last_promise_status: 'broken',
    last_promise_paid: 0,
    rejected_claim_amount: 1000,
    rejected_claim_date: '2026-10-28',
  });
});
