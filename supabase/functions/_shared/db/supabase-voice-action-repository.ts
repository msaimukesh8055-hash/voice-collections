// supabase/functions/_shared/db/supabase-voice-action-repository.ts
// VoiceActionRepository on Supabase's HTTP API (service role; pending_actions has RLS on and no
// policies). Status changes filter on the expected status (compare-and-set), so of two confirms
// racing, only one updates the row. Rows are parsed with Zod: a WhatsApp card or a payload
// without a ref is refused rather than trusted.
import { z } from 'zod';
import { ACTION_STATUSES } from './book-repository.ts';
import { type PostgrestClient, RepositoryError } from './postgrest.ts';
import { firstRow, IdRow } from './supabase-rows.ts';
import {
  VOICE_ACTION_KINDS,
  type VoiceAction,
  type VoiceActionRepository,
} from './voice-action-repository.ts';

const COLUMNS = 'id,owner_id,owner_call_id,kind,payload,status,created_at,expires_at';
const RETURN_ROW = 'return=representation';
const id = encodeURIComponent;

const VOICE_ACTION_ROW = z.object({
  id: z.uuid(),
  owner_id: z.uuid(),
  owner_call_id: z.uuid(),
  kind: z.enum(VOICE_ACTION_KINDS),
  payload: z.object({ ref: z.string(), data: z.unknown() }),
  status: z.enum(ACTION_STATUSES),
  created_at: z.string(),
  expires_at: z.string(),
}).transform((row): VoiceAction => ({
  id: row.id,
  ownerId: row.owner_id,
  ownerCallId: row.owner_call_id,
  kind: row.kind,
  ref: row.payload.ref,
  data: row.payload.data,
  status: row.status,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
}));

function totalFrom(contentRange: string | null, operation: string): number {
  const total = Number(contentRange?.split('/')[1]);
  if (!Number.isInteger(total)) throw new RepositoryError(operation, 'no count');
  return total;
}

function writes(
  query: PostgrestClient,
): Pick<
  VoiceActionRepository,
  'createVoiceAction' | 'cancelOpenVoiceActions' | 'transitionVoiceAction'
> {
  return {
    async createVoiceAction(action): Promise<string> {
      const body = {
        owner_id: action.ownerId,
        owner_call_id: action.ownerCallId,
        kind: action.kind,
        payload: { ref: action.ref, data: action.data },
        created_at: action.createdAt,
        expires_at: action.expiresAt,
      };
      const request = { method: 'POST', body, prefer: RETURN_ROW } as const;
      const result = await query('createVoiceAction', 'pending_actions?select=id', request);
      const row = firstRow(IdRow, result.rows);
      if (!row) throw new RepositoryError('createVoiceAction', 'no row');
      return row.id;
    },
    async cancelOpenVoiceActions(ownerCallId, createdBefore): Promise<number> {
      const path = `pending_actions?owner_call_id=eq.${id(ownerCallId)}&status=eq.open` +
        `&created_at=lt.${id(createdBefore)}&select=id`;
      const body = { status: 'cancelled', resolved_at: createdBefore };
      const request = { method: 'PATCH', body, prefer: RETURN_ROW } as const;
      const rows = (await query('cancelOpenVoiceActions', path, request)).rows;
      return z.array(IdRow).parse(rows).length;
    },
    async transitionVoiceAction(actionId, from, to): Promise<boolean> {
      const path = `pending_actions?id=eq.${id(actionId)}&status=eq.${from}&select=id`;
      const body = { status: to, resolved_at: new Date().toISOString() };
      const request = { method: 'PATCH', body, prefer: RETURN_ROW } as const;
      const rows = (await query('transitionVoiceAction', path, request)).rows;
      return z.array(IdRow).parse(rows).length === 1;
    },
  };
}

function reads(
  query: PostgrestClient,
): Pick<VoiceActionRepository, 'countVoiceActions' | 'latestVoiceActions' | 'getVoiceAction'> {
  return {
    async countVoiceActions(ownerCallId): Promise<number> {
      const path = `pending_actions?select=id&owner_call_id=eq.${id(ownerCallId)}`;
      const reply = await query('countVoiceActions', path, {
        method: 'HEAD',
        prefer: 'count=exact',
      });
      return totalFrom(reply.contentRange, 'countVoiceActions');
    },
    async latestVoiceActions(ownerCallId): Promise<readonly VoiceAction[]> {
      const path = `pending_actions?select=${COLUMNS}&owner_call_id=eq.${id(ownerCallId)}` +
        '&order=created_at.desc,id.desc&limit=2';
      return z.array(VOICE_ACTION_ROW).parse((await query('latestVoiceActions', path)).rows);
    },
    async getVoiceAction(actionId): Promise<VoiceAction | null> {
      const path = `pending_actions?select=${COLUMNS}&id=eq.${id(actionId)}` +
        '&owner_call_id=not.is.null';
      return firstRow(VOICE_ACTION_ROW, (await query('getVoiceAction', path)).rows);
    },
  };
}

export function createSupabaseVoiceActionRepository(
  query: PostgrestClient,
): VoiceActionRepository {
  return { ...reads(query), ...writes(query) };
}
