// supabase/functions/_shared/db/supabase-owner-call-repository.ts
// OwnerCallRepository on Supabase's HTTP API (service role; RLS on, no policies). Status changes
// filter on the expected status (compare-and-set), so a lost race updates no row. Counts use
// HEAD + count=exact, like the calls table's daily cap.
import { z } from 'zod';
import { type PostgrestClient, RepositoryError } from './postgrest.ts';
import {
  ACTIVE_OWNER_CALL_STATUSES,
  OWNER_CALL_STATUSES,
  type OwnerCall,
  type OwnerCallPatch,
  type OwnerCallRepository,
} from './owner-call-repository.ts';
import { firstRow, IdRow } from './supabase-rows.ts';

export const OWNER_CALL_COLUMNS =
  'id,owner_id,status,issued_at,expires_at,accepted_at,url_issued_at';
const RETURN_ROW = 'return=representation';
const COUNT_REQUEST = { method: 'HEAD', prefer: 'count=exact' } as const;
const id = encodeURIComponent;

export const OWNER_CALL_ROW = z.object({
  id: z.uuid(),
  owner_id: z.uuid(),
  status: z.enum(OWNER_CALL_STATUSES),
  issued_at: z.string(),
  expires_at: z.string(),
  accepted_at: z.string().nullable(),
  url_issued_at: z.string().nullable(),
}).transform((row): OwnerCall => ({
  id: row.id,
  ownerId: row.owner_id,
  status: row.status,
  issuedAt: row.issued_at,
  expiresAt: row.expires_at,
  acceptedAt: row.accepted_at,
  urlIssuedAt: row.url_issued_at,
}));

function totalFrom(contentRange: string | null, operation: string): number {
  const total = Number(contentRange?.split('/')[1]);
  if (!Number.isInteger(total)) throw new RepositoryError(operation, 'no count');
  return total;
}

/** Column names for a status change; only the fields present are sent. */
function toColumns(patch: OwnerCallPatch): Record<string, string | number> {
  const columns: Record<string, string | number | undefined> = {
    status: patch.status,
    accepted_at: patch.acceptedAt,
    url_issued_at: patch.urlIssuedAt,
    ended_at: patch.endedAt,
    duration_seconds: patch.durationSeconds,
    interaction_id: patch.interactionId,
  };
  return Object.fromEntries(
    Object.entries(columns).filter((entry): entry is [string, string | number] =>
      entry[1] !== undefined
    ),
  );
}

function rowQueries(
  query: PostgrestClient,
): Pick<
  OwnerCallRepository,
  'createOwnerCall' | 'getOwnerCall' | 'transitionOwnerCall' | 'expireIssuedOwnerCalls'
> {
  return {
    async createOwnerCall(call): Promise<OwnerCall> {
      const body = { owner_id: call.ownerId, expires_at: call.expiresAt };
      const request = { method: 'POST', body, prefer: RETURN_ROW } as const;
      const path = `owner_calls?select=${OWNER_CALL_COLUMNS}`;
      const row = firstRow(OWNER_CALL_ROW, (await query('createOwnerCall', path, request)).rows);
      if (!row) throw new RepositoryError('createOwnerCall', 'no row');
      return row;
    },
    async getOwnerCall(ownerCallId): Promise<OwnerCall | null> {
      const path = `owner_calls?select=${OWNER_CALL_COLUMNS}&id=eq.${id(ownerCallId)}`;
      return firstRow(OWNER_CALL_ROW, (await query('getOwnerCall', path)).rows);
    },
    async transitionOwnerCall(ownerCallId, from, patch): Promise<boolean> {
      const path = `owner_calls?id=eq.${id(ownerCallId)}&status=in.(${from.join(',')})&select=id`;
      const request = { method: 'PATCH', body: toColumns(patch), prefer: RETURN_ROW } as const;
      const rows = (await query('transitionOwnerCall', path, request)).rows;
      return z.array(IdRow).parse(rows).length === 1;
    },
    async expireIssuedOwnerCalls(ownerId): Promise<void> {
      const path = `owner_calls?owner_id=eq.${id(ownerId)}&status=eq.issued`;
      const body = { status: 'expired' };
      await query('expireIssuedOwnerCalls', path, {
        method: 'PATCH',
        body,
        prefer: 'return=minimal',
      });
    },
  };
}

function countQueries(
  query: PostgrestClient,
): Pick<
  OwnerCallRepository,
  'countOwnerCallsIssuedSince' | 'countOwnerUrlsIssuedSince' | 'hasActiveOwnerCall'
> {
  return {
    async countOwnerCallsIssuedSince(ownerId, since): Promise<number> {
      const path = `owner_calls?select=id&owner_id=eq.${id(ownerId)}` +
        `&issued_at=gte.${id(since.toISOString())}`;
      const reply = await query('countOwnerCallsIssuedSince', path, COUNT_REQUEST);
      return totalFrom(reply.contentRange, 'countOwnerCallsIssuedSince');
    },
    async countOwnerUrlsIssuedSince(since): Promise<number> {
      const path = `owner_calls?select=id&url_issued_at=gte.${id(since.toISOString())}`;
      const reply = await query('countOwnerUrlsIssuedSince', path, COUNT_REQUEST);
      return totalFrom(reply.contentRange, 'countOwnerUrlsIssuedSince');
    },
    async hasActiveOwnerCall(acceptedSince): Promise<boolean> {
      const path = `owner_calls?select=id&status=in.(${ACTIVE_OWNER_CALL_STATUSES.join(',')})` +
        `&accepted_at=gte.${id(acceptedSince.toISOString())}&limit=1`;
      return z.array(IdRow).parse((await query('hasActiveOwnerCall', path)).rows).length > 0;
    },
  };
}

export function createSupabaseOwnerCallRepository(query: PostgrestClient): OwnerCallRepository {
  return {
    ...rowQueries(query),
    ...countQueries(query),
    async insertOwnerToolEvent(event): Promise<void> {
      const body = {
        owner_call_id: event.ownerCallId,
        tool: event.tool,
        args: event.args,
        result: event.result,
        duration_ms: event.durationMs,
      };
      await query('insertOwnerToolEvent', 'owner_tool_events', {
        method: 'POST',
        body,
        prefer: 'return=minimal',
      });
    },
  };
}
