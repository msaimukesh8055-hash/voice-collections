// supabase/functions/_shared/db/supabase-memory.ts
// The Repository methods behind Asha's memory and tone level (M5 Decision 2): promises, the last
// follow-up note, the promise check's status change and the call's tone level. Split from
// supabase-repository.ts to keep each file small.
import { z } from 'zod';
import { PROMISE_STATUSES } from '../schemas/ledger.ts';
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

export type MemoryMethods = Pick<
  Repository,
  'listPromises' | 'getLastNote' | 'setPromiseStatus' | 'setCallToneLevel'
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
