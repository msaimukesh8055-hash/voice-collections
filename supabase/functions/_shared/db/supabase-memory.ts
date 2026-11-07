// supabase/functions/_shared/db/supabase-memory.ts
// The Repository methods behind Asha's memory and tone level (M5 Decision 2): promises, the last
// follow-up note, the promise check's status change and the call's tone level, plus the past
// calls behind her call history (M7 B1). Split from supabase-repository.ts to keep each file small.
import { z } from 'zod';
import { ENDED_CALL_STATUSES, MAX_PAST_CALLS, type PastCallRow } from '../calls/call-history.ts';
import { MIXED_SIGNALS, type MixedSignal } from '../followup/rules.ts';
import { LEDGER_STATUSES, PAYMENT_MODES, PROMISE_STATUSES } from '../schemas/ledger.ts';
import { IDENTITY_STATUSES } from '../schemas/shopkeeper.ts';
import type { PostgrestClient } from './postgrest.ts';
import type { Repository } from './repository.ts';
import { firstRow, IdRow } from './supabase-rows.ts';
import type { PromiseRecord } from '../ledger/promise-check.ts';

/** Ramesh has ~2 promises a month; this is a safety cap, not a page. */
export const PROMISE_LIMIT = 100;

const id = encodeURIComponent;

const PromiseRecordRow = z.object({
  id: z.uuid(),
  amount: z.coerce.number(),
  promise_date: z.iso.date(),
  status: z.enum(PROMISE_STATUSES),
  created_at: z.string(),
}).transform((row): PromiseRecord => ({
  id: row.id,
  amount: row.amount,
  promiseDate: row.promise_date,
  status: row.status,
  createdAt: row.created_at,
}));

const NoteRow = z.object({ note: z.string() });

function isMixedSignal(value: unknown): value is MixedSignal {
  return (MIXED_SIGNALS as readonly unknown[]).includes(value);
}

/** Only the fixed signal list is read from a follow-up run; anything else in `actions` (and
 * the run's free-text reasoning, which is not even selected) never leaves the database. */
const RunSignals = z.object({
  actions: z.object({ signals: z.array(z.unknown()) })
    .transform((actions) => actions.signals.filter(isMixedSignal))
    .catch([]),
});

const PastCallDbRow = z.object({
  id: z.uuid(),
  queued_at: z.string(),
  mode: z.enum(['live', 'simulated']),
  status: z.enum(ENDED_CALL_STATUSES),
  identity_status: z.enum(IDENTITY_STATUSES),
  promises: z.array(PromiseRecordRow),
  ledger_entries: z.array(z.object({
    amount: z.coerce.number(),
    entry_date: z.iso.date(),
    status: z.enum(LEDGER_STATUSES),
    payment_mode: z.enum(PAYMENT_MODES).nullable(),
  })),
  followups: z.array(z.object({
    kind: z.string(),
    reason: z.string(),
    summary: z.string().nullable(),
  })),
  followup_runs: z.array(RunSignals),
}).transform((row): PastCallRow => ({
  id: row.id,
  queuedAt: row.queued_at,
  mode: row.mode,
  status: row.status,
  identityStatus: row.identity_status,
  promises: row.promises,
  claims: row.ledger_entries.map((entry) => ({
    amount: entry.amount,
    paidDate: entry.entry_date,
    mode: entry.payment_mode,
    status: entry.status,
  })),
  followups: row.followups,
  signals: row.followup_runs.flatMap((run) => run.actions),
}));

/** One request with the linked rows embedded (M7 B1 Decision 2): no extra round trip. Each
 * embedded table has exactly one foreign key to calls, so PostgREST's embed is unambiguous. */
const PAST_CALL_SELECT = 'id,queued_at,mode,status,identity_status,' +
  'promises(id,amount,promise_date,status,created_at),' +
  'ledger_entries(amount,entry_date,status,payment_mode),' +
  'followups(kind,reason,summary),' +
  'followup_runs(actions)';

function pastCallsPath(shopkeeperId: string, excludeCallId: string, since: Date): string {
  return `calls?select=${PAST_CALL_SELECT}` +
    '&ledger_entries.kind=eq.payment&followups.kind=eq.owner_callback' +
    `&shopkeeper_id=eq.${id(shopkeeperId)}&id=neq.${id(excludeCallId)}` +
    `&status=in.(${ENDED_CALL_STATUSES.join(',')})&queued_at=gte.${id(since.toISOString())}` +
    `&order=queued_at.desc&limit=${MAX_PAST_CALLS}`;
}

export type MemoryMethods = Pick<
  Repository,
  'listPromises' | 'getLastNote' | 'setPromiseStatus' | 'setCallToneLevel' | 'listPastCalls'
>;

export function memoryQueries(query: PostgrestClient): MemoryMethods {
  return {
    async listPromises(shopkeeperId): Promise<readonly PromiseRecord[]> {
      const path = 'promises?select=id,amount,promise_date,status,created_at' +
        `&shopkeeper_id=eq.${id(shopkeeperId)}&order=created_at.desc&limit=${PROMISE_LIMIT}`;
      return z.array(PromiseRecordRow).parse((await query('listPromises', path)).rows);
    },
    async getLastNote(shopkeeperId): Promise<string | null> {
      const path = `shopkeeper_notes?select=note&shopkeeper_id=eq.${id(shopkeeperId)}` +
        '&order=created_at.desc&limit=1';
      return firstRow(NoteRow, (await query('getLastNote', path)).rows)?.note ?? null;
    },
    async listPastCalls(shopkeeperId, excludeCallId, since): Promise<readonly PastCallRow[]> {
      const path = pastCallsPath(shopkeeperId, excludeCallId, since);
      return z.array(PastCallDbRow).parse((await query('listPastCalls', path)).rows);
    },
    async setPromiseStatus(promiseId, status): Promise<boolean> {
      const path = `promises?id=eq.${id(promiseId)}&status=eq.open&select=id`;
      const request = {
        method: 'PATCH',
        body: { status },
        prefer: 'return=representation',
      } as const;
      const rows = (await query('setPromiseStatus', path, request)).rows;
      return z.array(IdRow).parse(rows).length === 1;
    },
    async setCallToneLevel(callId, level): Promise<void> {
      const path = `calls?id=eq.${id(callId)}`;
      const request = {
        method: 'PATCH',
        body: { tone_level: level },
        prefer: 'return=minimal',
      } as const;
      await query('setCallToneLevel', path, request);
    },
  };
}
