// supabase/functions/_shared/db/supabase-owner-call-reads.ts
// OwnerCallReads over the database HTTP API (service role). Fixed caps on every list. Tool events
// lose `call_token` before they leave, as for Asha's calls (call-detail-rows.ts).
import { z } from 'zod';
import { ToolEventRow, TRANSCRIPT_FIELDS } from './call-detail-rows.ts';
import { OWNER_CALL_STATUSES } from './owner-call-repository.ts';
import type { OwnerCallDetail, OwnerCallReads, OwnerCallRow } from './owner-call-reads.ts';
import type { PostgrestClient } from './postgrest.ts';
import { firstRow } from './supabase-rows.ts';

const id = encodeURIComponent;
const MAX_TOOL_EVENTS = 50;
const STARTED = 'accepted,in_progress,completed';
const COLUMNS = 'id,status,issued_at,accepted_at,ended_at,duration_seconds,is_test';

const Row = z.object({
  id: z.uuid(),
  status: z.enum(OWNER_CALL_STATUSES),
  issued_at: z.string(),
  accepted_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  duration_seconds: z.number().int().nullable(),
  is_test: z.boolean().default(false),
}).transform((row): OwnerCallRow => ({
  id: row.id,
  status: row.status,
  issuedAt: row.issued_at,
  acceptedAt: row.accepted_at,
  endedAt: row.ended_at,
  durationSeconds: row.duration_seconds,
  isTest: row.is_test,
}));

const DetailRow = z.object({ interaction_id: z.string().nullable(), ...TRANSCRIPT_FIELDS });

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
    toolEvents: z.array(ToolEventRow).parse(toolRows.rows),
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
