// supabase/functions/_shared/db/supabase-repository.ts
// Repository backed by Supabase Postgres through its HTTP API (service role; RLS blocks the
// browser). Ids reaching query strings are UUIDs validated upstream, and still encoded.
// Compare-and-set updates filter on the expected state, so a lost race updates no row.
import { z } from 'zod';
import { createRowInserter, type PostgrestClient, RepositoryError } from './postgrest.ts';
import { memoryQueries } from './supabase-memory.ts';
import type { LedgerEntry } from '../schemas/ledger.ts';
import {
  type CallSession,
  type DemoSettings,
  OPEN_LIVE_CALLS_LIMIT,
  type Repository,
  type SavedClaim,
  type SavedPromise,
  type Shopkeeper,
} from './repository.ts';
import {
  CLAIM_ROW,
  firstRow,
  IdRow,
  LEDGER_COLUMNS,
  LEDGER_ROW,
  PROMISE_ROW,
  SESSION_COLUMNS,
  SESSION_ROW,
  SETTINGS_COLUMNS,
  SETTINGS_ROW,
  SHOPKEEPER_COLUMNS,
  SHOPKEEPER_ROW,
  toCallColumns,
} from './supabase-rows.ts';

/** A shopkeeper's book holds ~30 entries for 6 months; this is a safety cap, not a page. */
const LEDGER_LIMIT = 2000;
const DEFAULT_SETTINGS = {
  demoClock: null,
  callingHoursEnabled: false,
  callLimitsEnabled: false,
  liveShopkeeperId: null,
} as const;

const id = encodeURIComponent;

/** Total from a Content-Range header such as "0-2/3" or "*\/3". */
function totalFrom(contentRange: string | null, operation: string): number {
  const total = Number(contentRange?.split('/')[1]);
  if (!Number.isInteger(total)) throw new RepositoryError(operation, 'no count');
  return total;
}

const COUNT_REQUEST = { method: 'HEAD', prefer: 'count=exact' } as const;

function updatedOne(rows: unknown): boolean {
  return z.array(IdRow).parse(rows).length === 1;
}

/** Attempt limits (per shopkeeper) and the daily live-session cap (all calls, CP2 M3). */
function callCounts(
  query: PostgrestClient,
): Pick<Repository, 'countCallsSince' | 'countCallUrlsIssuedSince'> {
  return {
    async countCallsSince(shopkeeperId, since): Promise<number> {
      const path = `calls?select=id&shopkeeper_id=eq.${id(shopkeeperId)}` +
        `&queued_at=gte.${id(since.toISOString())}`;
      const reply = await query('countCallsSince', path, COUNT_REQUEST);
      return totalFrom(reply.contentRange, 'countCallsSince');
    },
    async countCallUrlsIssuedSince(since): Promise<number> {
      const path = `calls?select=id&url_issued_at=gte.${id(since.toISOString())}`;
      const reply = await query('countCallUrlsIssuedSince', path, COUNT_REQUEST);
      return totalFrom(reply.contentRange, 'countCallUrlsIssuedSince');
    },
  };
}

function callQueries(
  query: PostgrestClient,
): Pick<
  Repository,
  | 'getDemoSettings'
  | 'getShopkeeper'
  | 'createCall'
  | 'getCallSession'
  | 'findRingingCall'
  | 'listOpenLiveCalls'
> {
  return {
    async getDemoSettings(): Promise<DemoSettings> {
      const path = `demo_settings?select=${SETTINGS_COLUMNS}&id=eq.1`;
      return firstRow(SETTINGS_ROW, (await query('getDemoSettings', path)).rows) ??
        DEFAULT_SETTINGS;
    },
    async getShopkeeper(shopkeeperId): Promise<Shopkeeper | null> {
      const path = `shopkeepers?select=${SHOPKEEPER_COLUMNS}&id=eq.${id(shopkeeperId)}`;
      return firstRow(SHOPKEEPER_ROW, (await query('getShopkeeper', path)).rows);
    },
    async createCall(call): Promise<string> {
      const body = { shopkeeper_id: call.shopkeeperId, language: call.language, mode: call.mode };
      const request = { method: 'POST', body, prefer: 'return=representation' } as const;
      const row = firstRow(IdRow, (await query('createCall', 'calls?select=id', request)).rows);
      if (!row) throw new RepositoryError('createCall', 'no row');
      return row.id;
    },
    async getCallSession(callId): Promise<CallSession | null> {
      const path = `calls?select=${SESSION_COLUMNS}&id=eq.${id(callId)}`;
      return firstRow(SESSION_ROW, (await query('getCallSession', path)).rows);
    },
    async findRingingCall(shopkeeperId): Promise<CallSession | null> {
      const path = `calls?select=${SESSION_COLUMNS}&shopkeeper_id=eq.${id(shopkeeperId)}` +
        '&status=in.(queued,ringing)&order=queued_at.desc&limit=1';
      return firstRow(SESSION_ROW, (await query('findRingingCall', path)).rows);
    },
    async listOpenLiveCalls(): Promise<readonly CallSession[]> {
      const path = `calls?select=${SESSION_COLUMNS}&mode=eq.live` +
        '&status=in.(queued,ringing,accepted,in_progress)' +
        `&order=queued_at.desc&limit=${OPEN_LIVE_CALLS_LIMIT}`;
      return z.array(SESSION_ROW).parse((await query('listOpenLiveCalls', path)).rows);
    },
  };
}

function callUpdates(
  query: PostgrestClient,
): Pick<Repository, 'transitionCall' | 'recordIdentity'> {
  return {
    async transitionCall(callId, from, patch): Promise<boolean> {
      const path = `calls?id=eq.${id(callId)}&status=in.(${from.join(',')})&select=id`;
      const request = {
        method: 'PATCH',
        body: toCallColumns(patch),
        prefer: 'return=representation',
      } as const;
      return updatedOne((await query('transitionCall', path, request)).rows);
    },
    async recordIdentity(callId, expected, next): Promise<boolean> {
      const path = `calls?id=eq.${id(callId)}&identity_status=eq.${expected.status}` +
        `&identity_unsure_count=eq.${expected.unsureCount}&select=id`;
      const body = { identity_status: next.status, identity_unsure_count: next.unsureCount };
      const request = { method: 'PATCH', body, prefer: 'return=representation' } as const;
      return updatedOne((await query('recordIdentity', path, request)).rows);
    },
  };
}

function promiseUpdates(query: PostgrestClient): Pick<Repository, 'updatePromiseForCall'> {
  return {
    async updatePromiseForCall(callId, promise): Promise<boolean> {
      const path = `promises?call_id=eq.${id(callId)}&select=id`;
      const body = { amount: promise.amount, promise_date: promise.promiseDate };
      const request = { method: 'PATCH', body, prefer: 'return=representation' } as const;
      return updatedOne((await query('updatePromiseForCall', path, request)).rows);
    },
  };
}

function ledgerQueries(
  query: PostgrestClient,
): Pick<Repository, 'getLedger' | 'getPromiseForCall' | 'getClaimForCall'> {
  return {
    async getLedger(shopkeeperId): Promise<readonly LedgerEntry[]> {
      const path = `ledger_entries?select=${LEDGER_COLUMNS}&shopkeeper_id=eq.${id(shopkeeperId)}` +
        `&order=entry_date&limit=${LEDGER_LIMIT}`;
      return z.array(LEDGER_ROW).parse((await query('getLedger', path)).rows);
    },
    async getPromiseForCall(callId): Promise<SavedPromise | null> {
      const path = `promises?select=amount,promise_date&call_id=eq.${id(callId)}&limit=1`;
      return firstRow(PROMISE_ROW, (await query('getPromiseForCall', path)).rows);
    },
    async getClaimForCall(callId): Promise<SavedClaim | null> {
      const path = `ledger_entries?select=amount,entry_date,payment_mode&call_id=eq.${id(callId)}` +
        '&limit=1';
      return firstRow(CLAIM_ROW, (await query('getClaimForCall', path)).rows);
    },
  };
}

function inserts(
  query: PostgrestClient,
): Pick<
  Repository,
  'insertPromise' | 'insertPaymentClaim' | 'insertOwnerCallback' | 'insertToolEvent'
> {
  const { insert, insertOnce } = createRowInserter(query);
  return {
    insertPromise: (promise) =>
      insertOnce('insertPromise', 'promises', {
        shopkeeper_id: promise.shopkeeperId,
        call_id: promise.callId,
        amount: promise.amount,
        promise_date: promise.promiseDate,
      }),
    insertPaymentClaim: (claim) =>
      insertOnce('insertPaymentClaim', 'ledger_entries', {
        shopkeeper_id: claim.shopkeeperId,
        call_id: claim.callId,
        kind: 'payment',
        amount: claim.amount,
        entry_date: claim.paidDate,
        status: 'claimed',
        source: 'call',
        payment_mode: claim.mode,
      }),
    insertOwnerCallback: (callback) =>
      insert('insertOwnerCallback', 'followups', {
        shopkeeper_id: callback.shopkeeperId,
        call_id: callback.callId,
        kind: 'owner_callback',
        reason: callback.reason,
        summary: callback.summary,
      }),
    insertToolEvent: (event) =>
      insert('insertToolEvent', 'tool_events', {
        call_id: event.callId,
        tool: event.tool,
        args: event.args,
        result: event.result,
        duration_ms: event.durationMs,
      }),
  };
}

export function createSupabaseRepository(query: PostgrestClient): Repository {
  return {
    ...callQueries(query),
    ...callCounts(query),
    ...callUpdates(query),
    ...ledgerQueries(query),
    ...promiseUpdates(query),
    ...inserts(query),
    ...memoryQueries(query),
  };
}
