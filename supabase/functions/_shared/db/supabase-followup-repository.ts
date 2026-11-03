// supabase/functions/_shared/db/supabase-followup-repository.ts
// FollowupRepository over the database HTTP API (service role). Claiming is a compare-and-set
// on the call's follow-up status and attempt count, so two workers can never both run one call;
// the unique index on followup_runs (call_id) backs that up.
import { z } from 'zod';
import type { CallbackRequest, ClaimRecord } from '../followup/facts.ts';
import type { Score } from '../ledger/score.ts';
import { PAYMENT_MODES } from '../schemas/ledger.ts';
import { type CallStatus, CallStatusSchema, IdentityStatusSchema } from '../schemas/shopkeeper.ts';
import { CALLBACK_REASONS } from '../tools/schemas.ts';
import {
  type CallOutcome,
  FOLLOWUP_STATUSES,
  type FollowupCall,
  type FollowupRepository,
  staleBefore,
} from './followup-repository.ts';
import { createRowInserter, type PostgrestClient } from './postgrest.ts';
import { firstRow, IdRow, PROMISE_ROW } from './supabase-rows.ts';

/** A shopkeeper gets a few calls a week; this is a safety cap, not a page. */
const CALL_STATUS_LIMIT = 500;
const id = encodeURIComponent;

const FOLLOWUP_CALL_COLUMNS = 'id,shopkeeper_id,mode,status,identity_status,tone_level,' +
  'interaction_id,transcript,queued_at,accepted_at,ended_at,followup_status,followup_attempts,' +
  'followup_next_at,followup_claimed_at';

const TurnSchema = z.object({ role: z.enum(['assistant', 'user']), content: z.string() });

const FollowupCallRow = z.object({
  id: z.uuid(),
  shopkeeper_id: z.uuid(),
  mode: z.enum(['live', 'simulated']),
  status: CallStatusSchema,
  identity_status: IdentityStatusSchema,
  tone_level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  interaction_id: z.string().nullable(),
  // A transcript in an unexpected shape is treated as none rather than failing the follow-up.
  transcript: z.array(TurnSchema).nullable().catch(null),
  queued_at: z.string(),
  accepted_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  followup_status: z.enum(FOLLOWUP_STATUSES).nullable(),
  followup_attempts: z.number().int().min(0),
  followup_next_at: z.string().nullable(),
  followup_claimed_at: z.string().nullable(),
}).transform((row): FollowupCall => ({
  callId: row.id,
  shopkeeperId: row.shopkeeper_id,
  mode: row.mode,
  status: row.status,
  identityStatus: row.identity_status,
  toneLevel: row.tone_level,
  interactionId: row.interaction_id,
  transcript: row.transcript,
  queuedAt: row.queued_at,
  acceptedAt: row.accepted_at,
  endedAt: row.ended_at,
  followupStatus: row.followup_status,
  followupAttempts: row.followup_attempts,
  followupNextAt: row.followup_next_at,
  followupClaimedAt: row.followup_claimed_at,
}));

const ClaimRow = z.object({
  id: z.uuid(),
  amount: z.coerce.number(),
  entry_date: z.iso.date(),
  payment_mode: z.enum(PAYMENT_MODES),
}).transform((row): ClaimRecord => ({
  entryId: row.id,
  amount: row.amount,
  paidDate: row.entry_date,
  mode: row.payment_mode,
}));

const CallbackRow = z.object({
  reason: z.enum(CALLBACK_REASONS).catch('other'),
  summary: z.string().nullable(),
}).transform((row): CallbackRequest => ({ reason: row.reason, summary: row.summary ?? '' }));

const CallIdRow = z.object({ id: z.uuid() });
const StatusRow = z.object({ status: CallStatusSchema });

function updatedOne(rows: unknown): boolean {
  return z.array(IdRow).parse(rows).length === 1;
}

function patch(body: object): { method: 'PATCH'; body: object; prefer: string } {
  return { method: 'PATCH', body, prefer: 'return=minimal' };
}

function claimMethods(
  query: PostgrestClient,
): Pick<FollowupRepository, 'claimFollowup' | 'releaseFollowup' | 'failFollowup'> {
  return {
    async claimFollowup(call, now): Promise<boolean> {
      const path = `calls?id=eq.${id(call.callId)}&followup_status=eq.${call.followupStatus}` +
        `&followup_attempts=eq.${call.followupAttempts}&select=id`;
      const body = {
        followup_status: 'running',
        followup_attempts: call.followupAttempts + 1,
        followup_claimed_at: now.toISOString(),
      };
      const request = { method: 'PATCH', body, prefer: 'return=representation' } as const;
      return updatedOne((await query('claimFollowup', path, request)).rows);
    },
    async releaseFollowup(callId, nextAt): Promise<void> {
      const body = { followup_status: 'pending', followup_next_at: nextAt.toISOString() };
      await query('releaseFollowup', `calls?id=eq.${id(callId)}`, patch(body));
    },
    async failFollowup(callId): Promise<void> {
      await query(
        'failFollowup',
        `calls?id=eq.${id(callId)}`,
        patch({ followup_status: 'failed' }),
      );
    },
  };
}

function callQueries(
  query: PostgrestClient,
): Pick<
  FollowupRepository,
  'getFollowupCall' | 'finishFollowup' | 'listDueFollowups' | 'listCallStatuses'
> {
  async function idsWhere(filter: string, limit: number): Promise<string[]> {
    const path = `calls?select=id&${filter}&order=queued_at&limit=${limit}`;
    return z.array(CallIdRow).parse((await query('listDueFollowups', path)).rows).map((r) => r.id);
  }
  return {
    async getFollowupCall(callId): Promise<FollowupCall | null> {
      const path = `calls?select=${FOLLOWUP_CALL_COLUMNS}&id=eq.${id(callId)}`;
      return firstRow(FollowupCallRow, (await query('getFollowupCall', path)).rows);
    },
    async finishFollowup(callId, result): Promise<void> {
      const body = {
        followup_status: 'done',
        transcript: result.transcript,
        summary: result.summary,
        ...(result.interactionId ? { interaction_id: result.interactionId } : {}),
      };
      await query('finishFollowup', `calls?id=eq.${id(callId)}`, patch(body));
    },
    async listDueFollowups(now, limit): Promise<readonly string[]> {
      const [pending, stale] = await Promise.all([
        idsWhere(`followup_status=eq.pending&followup_next_at=lte.${id(now.toISOString())}`, limit),
        idsWhere(
          `followup_status=eq.running&followup_claimed_at=lt.${id(staleBefore(now).toISOString())}`,
          limit,
        ),
      ]);
      return [...pending, ...stale].slice(0, limit);
    },
    async listCallStatuses(shopkeeperId): Promise<readonly CallStatus[]> {
      const path = `calls?select=status&shopkeeper_id=eq.${id(shopkeeperId)}` +
        `&order=queued_at.desc&limit=${CALL_STATUS_LIMIT}`;
      return z.array(StatusRow).parse((await query('listCallStatuses', path)).rows).map((r) =>
        r.status
      );
    },
  };
}

function outcomeQueries(query: PostgrestClient): Pick<FollowupRepository, 'getCallOutcome'> {
  return {
    async getCallOutcome(callId): Promise<CallOutcome> {
      const call = id(callId);
      const [promise, claim, callbacks] = await Promise.all([
        query('getCallOutcome', `promises?select=amount,promise_date&call_id=eq.${call}&limit=1`),
        query(
          'getCallOutcome',
          `ledger_entries?select=id,amount,entry_date,payment_mode&call_id=eq.${call}` +
            '&kind=eq.payment&status=eq.claimed&limit=1',
        ),
        query(
          'getCallOutcome',
          `followups?select=reason,summary&call_id=eq.${call}&kind=eq.owner_callback` +
            '&order=created_at&limit=10',
        ),
      ]);
      return {
        promise: firstRow(PROMISE_ROW, promise.rows),
        claim: firstRow(ClaimRow, claim.rows),
        callbacks: z.array(CallbackRow).parse(callbacks.rows),
      };
    },
  };
}

function writes(
  query: PostgrestClient,
): Pick<FollowupRepository, 'insertFollowupRun' | 'insertNote' | 'insertFollowup' | 'saveScore'> {
  const { insert, insertOnce } = createRowInserter(query);
  return {
    insertFollowupRun: (run) =>
      insertOnce('insertFollowupRun', 'followup_runs', {
        call_id: run.callId,
        shopkeeper_id: run.shopkeeperId,
        path: run.path,
        decision: run.decision,
        reasoning: run.reasoning,
        actions: run.actions,
      }),
    insertNote: (note) =>
      insertOnce('insertNote', 'shopkeeper_notes', {
        call_id: note.callId,
        shopkeeper_id: note.shopkeeperId,
        note: note.note,
      }),
    insertFollowup: (followup) =>
      insert('insertFollowup', 'followups', {
        call_id: followup.callId,
        shopkeeper_id: followup.shopkeeperId,
        kind: followup.kind,
        reason: followup.reason,
        scheduled_for: followup.scheduledFor,
      }),
    async saveScore(shopkeeperId, score: Score, at): Promise<void> {
      const body = {
        score: score.score,
        score_band: score.band,
        score_parts: { parts: score.parts, facts: score.facts },
        score_updated_at: at.toISOString(),
      };
      await query('saveScore', `shopkeepers?id=eq.${id(shopkeeperId)}`, patch(body));
    },
  };
}

export function createSupabaseFollowupRepository(query: PostgrestClient): FollowupRepository {
  return {
    ...claimMethods(query),
    ...callQueries(query),
    ...outcomeQueries(query),
    ...writes(query),
  };
}
