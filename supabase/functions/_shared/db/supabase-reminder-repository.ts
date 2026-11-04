// supabase/functions/_shared/db/supabase-reminder-repository.ts
// ReminderRepository over the database HTTP API (service role). The 4-at-once limit for
// simulated calls is enforced by a database function (claim_simulated_call, which takes a lock),
// so two workers can never both start the fifth call. Finishing a simulated call is a
// compare-and-set from in_progress, so a stale-call sweep and a late finish cannot both win.
import { z } from 'zod';
import type { AlertPromise } from '../ledger/due-alert.ts';
import { PROMISE_STATUSES } from '../schemas/ledger.ts';
import { createRowInserter, type PostgrestClient } from './postgrest.ts';
import type { CreatedCall, RecentCall, ReminderRepository } from './reminder-repository.ts';
import { firstRow, IdRow } from './supabase-rows.ts';

/** Safety caps, not pages: the demo book has 100 shopkeepers and a few calls each a week. */
const PROMISE_LIMIT = 1000;
const CALL_LIMIT = 1000;
const SHOPKEEPER_LIMIT = 1000;

const id = encodeURIComponent;

const AlertPromiseRow = z.object({
  id: z.uuid(),
  shopkeeper_id: z.uuid(),
  amount: z.coerce.number(),
  promise_date: z.iso.date(),
  status: z.enum(PROMISE_STATUSES),
  created_at: z.string(),
}).transform((row): AlertPromise => ({
  id: row.id,
  shopkeeperId: row.shopkeeper_id,
  amount: row.amount,
  promiseDate: row.promise_date,
  status: row.status,
  createdAt: row.created_at,
}));
const RecentCallRow = z.object({ shopkeeper_id: z.uuid(), queued_at: z.string() }).transform(
  (row): RecentCall => ({ shopkeeperId: row.shopkeeper_id, queuedAt: row.queued_at }),
);
const CreatedCallRow = z.object({ id: z.uuid(), shopkeeper_id: z.uuid() }).transform(
  (row): CreatedCall => ({ callId: row.id, shopkeeperId: row.shopkeeper_id }),
);
const ShopkeeperIdRow = z.object({ shopkeeper_id: z.uuid() });
const PersonaRow = z.object({ persona: z.string().nullable() });
const CreatedAtRow = z.object({ created_at: z.string() });

function ids(rows: unknown): string[] {
  return z.array(IdRow).parse(rows).map((row) => row.id);
}

function readQueries(query: PostgrestClient): Pick<
  ReminderRepository,
  | 'listAlertPromises'
  | 'listCallsSince'
  | 'listPausedShopkeepers'
  | 'listDoNotCall'
  | 'getPersona'
  | 'lastInboundAt'
> {
  return {
    async listAlertPromises(ownerId, since): Promise<readonly AlertPromise[]> {
      const path = 'promises?select=id,shopkeeper_id,amount,promise_date,status,created_at,' +
        `shopkeepers!inner(owner_id)&shopkeepers.owner_id=eq.${id(ownerId)}` +
        `&or=(status.eq.open,promise_date.gte.${id(since)})` +
        `&order=created_at.desc&limit=${PROMISE_LIMIT}`;
      return z.array(AlertPromiseRow).parse((await query('listAlertPromises', path)).rows);
    },
    async listCallsSince(since): Promise<readonly RecentCall[]> {
      const path = `calls?select=shopkeeper_id,queued_at&queued_at=gte.${
        id(since.toISOString())
      }&order=queued_at.desc&limit=${CALL_LIMIT}`;
      return z.array(RecentCallRow).parse((await query('listCallsSince', path)).rows);
    },
    async listPausedShopkeepers(): Promise<readonly string[]> {
      const path = 'followups?select=shopkeeper_id&kind=eq.pause_reminders&status=eq.pending' +
        `&limit=${SHOPKEEPER_LIMIT}`;
      const rows = z.array(ShopkeeperIdRow).parse(
        (await query('listPausedShopkeepers', path)).rows,
      );
      return rows.map((row) => row.shopkeeper_id);
    },
    async listDoNotCall(ownerId): Promise<readonly string[]> {
      const path = `shopkeepers?select=id&owner_id=eq.${id(ownerId)}&do_not_call=eq.true` +
        `&limit=${SHOPKEEPER_LIMIT}`;
      return ids((await query('listDoNotCall', path)).rows);
    },
    async getPersona(shopkeeperId): Promise<string | null> {
      const path = `shopkeepers?select=persona&id=eq.${id(shopkeeperId)}`;
      return firstRow(PersonaRow, (await query('getPersona', path)).rows)?.persona ?? null;
    },
    async lastInboundAt(senderHash): Promise<string | null> {
      const path = `wa_messages?select=created_at&direction=eq.in&sender_hash=eq.${
        id(senderHash)
      }&order=created_at.desc&limit=1`;
      return firstRow(CreatedAtRow, (await query('lastInboundAt', path)).rows)?.created_at ?? null;
    },
  };
}

/** A PATCH that returns the changed rows, so the caller learns which rows it actually moved. */
function returning(body: object): { method: 'PATCH'; body: object; prefer: string } {
  return { method: 'PATCH', body, prefer: 'return=representation' };
}

/** The columns that close a call and hand it to the follow-up worker straight away. */
function completedNow(endedAt: Date): Record<string, string> {
  const at = endedAt.toISOString();
  return { status: 'completed', ended_at: at, followup_status: 'pending', followup_next_at: at };
}

function callWrites(
  query: PostgrestClient,
): Pick<ReminderRepository, 'createCalls' | 'claimSimulatedCall'> {
  return {
    async createCalls(calls): Promise<readonly CreatedCall[]> {
      if (calls.length === 0) return [];
      const body = calls.map((call) => ({
        shopkeeper_id: call.shopkeeperId,
        language: call.language,
        mode: call.mode,
      }));
      const request = { method: 'POST', body, prefer: 'return=representation' } as const;
      const rows = (await query('createCalls', 'calls?select=id,shopkeeper_id', request)).rows;
      return z.array(CreatedCallRow).parse(rows);
    },
    async claimSimulatedCall(maxRunning, staleBefore): Promise<string | null> {
      const body = { max_running: maxRunning, stale_before: staleBefore.toISOString() };
      const request = { method: 'POST', body } as const;
      const rows = (await query('claimSimulatedCall', 'rpc/claim_simulated_call', request)).rows;
      return z.uuid().nullable().parse(rows);
    },
  };
}

function simulatedCallEnds(
  query: PostgrestClient,
): Pick<ReminderRepository, 'endStaleSimulatedCalls' | 'finishSimulatedCall'> {
  return {
    async endStaleSimulatedCalls(staleBefore, now): Promise<readonly string[]> {
      const path = 'calls?mode=eq.simulated&status=eq.in_progress' +
        `&accepted_at=lt.${id(staleBefore.toISOString())}&select=id`;
      return ids((await query('endStaleSimulatedCalls', path, returning(completedNow(now)))).rows);
    },
    async finishSimulatedCall(callId, end): Promise<boolean> {
      const path = `calls?id=eq.${id(callId)}&status=eq.in_progress&select=id`;
      const body = {
        ...completedNow(end.endedAt),
        duration_seconds: end.durationSeconds,
        transcript: end.transcript,
      };
      return ids((await query('finishSimulatedCall', path, returning(body))).rows).length === 1;
    },
  };
}

export function createSupabaseReminderRepository(query: PostgrestClient): ReminderRepository {
  const { insertOnce } = createRowInserter(query);
  return {
    ...readQueries(query),
    ...callWrites(query),
    ...simulatedCallEnds(query),
    claimDailyAlert: (claim) =>
      insertOnce('claimDailyAlert', 'owner_alerts', {
        owner_id: claim.ownerId,
        alert_day: claim.day,
        kind: claim.kind,
      }),
  };
}
