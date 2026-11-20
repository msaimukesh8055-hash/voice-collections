// supabase/functions/_shared/db/supabase-owner-call-reads.ts
// OwnerCallReads over the database HTTP API (service role). Fixed caps on every list. Tool events
// lose `call_token` before they leave, as for Asha's calls.
import { z } from 'zod';
import { ToneJudgementSchema } from '../calls/tone-judge.ts';
import { OWNER_CALL_STATUSES } from './owner-call-repository.ts';
import type { OwnerCallDetail, OwnerCallReads, OwnerCallRow } from './owner-call-reads.ts';
import type { PostgrestClient } from './postgrest.ts';
import { firstRow } from './supabase-rows.ts';

const id = encodeURIComponent;
const MAX_TOOL_EVENTS = 50;
const STARTED = 'accepted,in_progress,completed';
const COLUMNS = 'id,status,issued_at,accepted_at,ended_at,duration_seconds';

const Row = z.object({
  id: z.uuid(),
  status: z.enum(OWNER_CALL_STATUSES),
  issued_at: z.string(),
  accepted_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  duration_seconds: z.number().int().nullable(),
}).transform((row): OwnerCallRow => ({
  id: row.id,
  status: row.status,
  issuedAt: row.issued_at,
  acceptedAt: row.accepted_at,
  endedAt: row.ended_at,
  durationSeconds: row.duration_seconds,
}));

const TurnSchema = z.object({ role: z.enum(['assistant', 'user']), content: z.string() });
const JsonObject = z.record(z.string(), z.unknown()).catch({});
const DetailRow = z.object({
  interaction_id: z.string().nullable(),
  transcript: z.array(TurnSchema).nullable().catch(null),
  transcript_en: z.array(z.string().nullable()).nullable().catch(null),
  tone_judgement: ToneJudgementSchema.nullable().catch(null),
});
const ToolRow = z.object({
  tool: z.string(),
  args: JsonObject,
  result: JsonObject,
  duration_ms: z.number().int().nullable(),
  created_at: z.string(),
});

function withoutToken(args: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { call_token: _token, ...rest } = args;
  return rest;
}

async function readDetail(
  query: PostgrestClient,
  ownerCallId: string,
): Promise<OwnerCallDetail | null> {
  const [callRows, toolRows] = await Promise.all([
    query(
      'getOwnerCallDetail',
      `owner_calls?select=${COLUMNS},interaction_id,transcript,transcript_en,tone_judgement` +
        `&id=eq.${id(ownerCallId)}&status=in.(${STARTED})`,
    ),
    query(
      'listOwnerToolEvents',
      `owner_tool_events?select=tool,args,result,duration_ms,created_at` +
        `&owner_call_id=eq.${id(ownerCallId)}&order=created_at&limit=${MAX_TOOL_EVENTS}`,
    ),
  ]);
  const call = firstRow(Row, callRows.rows);
  const detail = firstRow(DetailRow, callRows.rows);
  if (!call || !detail) return null;
  return {
    ...call,
    interactionId: detail.interaction_id,
    transcript: detail.transcript,
    transcriptEnglish: detail.transcript_en,
    toneJudgement: detail.tone_judgement,
    toolEvents: z.array(ToolRow).parse(toolRows.rows).map((row) => ({
      tool: row.tool,
      args: withoutToken(row.args),
      result: row.result,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    })),
  };
}

export function createSupabaseOwnerCallReads(query: PostgrestClient): OwnerCallReads {
  async function patch(operation: string, ownerCallId: string, body: unknown): Promise<void> {
    await query(operation, `owner_calls?id=eq.${id(ownerCallId)}`, {
      method: 'PATCH',
      body,
      prefer: 'return=minimal',
    });
  }
  return {
    async listOwnerCalls(ownerId, limit): Promise<readonly OwnerCallRow[]> {
      const path = `owner_calls?select=${COLUMNS}&owner_id=eq.${id(ownerId)}` +
        `&status=in.(${STARTED})&order=issued_at.desc&limit=${limit}`;
      return z.array(Row).parse((await query('listOwnerCalls', path)).rows);
    },
    getOwnerCallDetail: (ownerCallId) => readDetail(query, ownerCallId),
    saveOwnerCallTranscript: (ownerCallId, turns) =>
      patch('saveOwnerCallTranscript', ownerCallId, { transcript: turns }),
    saveOwnerCallEnglish: (ownerCallId, lines) =>
      patch('saveOwnerCallEnglish', ownerCallId, { transcript_en: lines }),
    saveOwnerCallTone: (ownerCallId, judgement) =>
      patch('saveOwnerCallTone', ownerCallId, { tone_judgement: judgement }),
  };
}
