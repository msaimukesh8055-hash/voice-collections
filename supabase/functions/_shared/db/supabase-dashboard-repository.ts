// supabase/functions/_shared/db/supabase-dashboard-repository.ts
// DashboardRepository over the database HTTP API (service role). Every list has a fixed cap.
// A call's tool events lose `call_token` (the call's own id, no use on screen) before they leave.
import { z } from 'zod';
import { CallStatusSchema, LanguageSchema } from '../schemas/shopkeeper.ts';
import type {
  DashboardCall,
  DashboardCallDetail,
  DashboardNote,
  DashboardPromise,
  DashboardRepository,
} from './dashboard-repository.ts';
import type { PostgrestClient } from './postgrest.ts';
import { firstRow } from './supabase-rows.ts';

const id = encodeURIComponent;
const MAX_TOOL_EVENTS = 50;
const MAX_PROMISES = 20;

const CALL_COLUMNS =
  'id,shopkeeper_id,mode,status,language,tone_level,queued_at,ended_at,duration_seconds,summary';

const CallRow = z.object({
  id: z.uuid(),
  shopkeeper_id: z.uuid(),
  mode: z.enum(['live', 'simulated']),
  status: CallStatusSchema,
  language: LanguageSchema,
  tone_level: z.number().int(),
  queued_at: z.string(),
  ended_at: z.string().nullable(),
  duration_seconds: z.number().int().nullable(),
  summary: z.string().nullable(),
}).transform((row): DashboardCall => ({
  id: row.id,
  shopkeeperId: row.shopkeeper_id,
  mode: row.mode,
  status: row.status,
  language: row.language,
  toneLevel: row.tone_level,
  queuedAt: row.queued_at,
  endedAt: row.ended_at,
  durationSeconds: row.duration_seconds,
  summary: row.summary,
}));

const TurnSchema = z.object({ role: z.enum(['assistant', 'user']), content: z.string() });
const JsonObject = z.record(z.string(), z.unknown()).catch({});

const DetailRow = z.object({
  transcript: z.array(TurnSchema).nullable().catch(null),
});
const ToolRow = z.object({
  tool: z.string(),
  args: JsonObject,
  result: JsonObject,
  duration_ms: z.number().int().nullable(),
  created_at: z.string(),
});
const RunRow = z.object({
  path: z.enum(['rule', 'agent']),
  decision: z.string(),
  reasoning: z.string(),
});
const PromiseRow = z.object({
  amount: z.coerce.number(),
  promise_date: z.string(),
  status: z.enum(['open', 'kept', 'broken', 'replaced']),
  created_at: z.string(),
}).transform((row): DashboardPromise => ({
  amount: row.amount,
  promiseDate: row.promise_date,
  status: row.status,
  createdAt: row.created_at,
}));
const NoteRow = z.object({ note: z.string(), created_at: z.string() }).transform(
  (row): DashboardNote => ({ note: row.note, createdAt: row.created_at }),
);

function withoutToken(args: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { call_token: _token, ...rest } = args;
  return rest;
}

async function readCall(
  query: PostgrestClient,
  callId: string,
): Promise<DashboardCallDetail | null> {
  const [callRows, toolRows, runRows] = await Promise.all([
    query('getDashboardCall', `calls?select=${CALL_COLUMNS},transcript&id=eq.${id(callId)}`),
    query(
      'listDashboardToolEvents',
      `tool_events?select=tool,args,result,duration_ms,created_at&call_id=eq.${id(callId)}` +
        `&order=created_at&limit=${MAX_TOOL_EVENTS}`,
    ),
    query(
      'getDashboardFollowupRun',
      `followup_runs?select=path,decision,reasoning&call_id=eq.${id(callId)}&limit=1`,
    ),
  ]);
  const call = firstRow(CallRow, callRows.rows);
  if (!call) return null;
  const tools = z.array(ToolRow).parse(toolRows.rows);
  return {
    ...call,
    transcript: firstRow(DetailRow, callRows.rows)?.transcript ?? null,
    toolEvents: tools.map((row) => ({
      tool: row.tool,
      args: withoutToken(row.args),
      result: row.result,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    })),
    followup: firstRow(RunRow, runRows.rows),
  };
}

export function createSupabaseDashboardRepository(query: PostgrestClient): DashboardRepository {
  return {
    async listCalls({ limit, shopkeeperId }): Promise<readonly DashboardCall[]> {
      const filter = shopkeeperId ? `&shopkeeper_id=eq.${id(shopkeeperId)}` : '';
      const path = `calls?select=${CALL_COLUMNS}${filter}&order=queued_at.desc&limit=${limit}`;
      return z.array(CallRow).parse((await query('listDashboardCalls', path)).rows);
    },
    getCall: (callId) => readCall(query, callId),
    async listPromises(shopkeeperId): Promise<readonly DashboardPromise[]> {
      const path = `promises?select=amount,promise_date,status,created_at` +
        `&shopkeeper_id=eq.${id(shopkeeperId)}&order=created_at.desc&limit=${MAX_PROMISES}`;
      return z.array(PromiseRow).parse((await query('listDashboardPromises', path)).rows);
    },
    async listNotes(shopkeeperId, limit): Promise<readonly DashboardNote[]> {
      const path = `shopkeeper_notes?select=note,created_at&shopkeeper_id=eq.${id(shopkeeperId)}` +
        `&order=created_at.desc&limit=${limit}`;
      return z.array(NoteRow).parse((await query('listDashboardNotes', path)).rows);
    },
    async setEnglishUnderTelugu(ownerId, on): Promise<void> {
      await query('setEnglishUnderTelugu', `owners?id=eq.${id(ownerId)}`, {
        method: 'PATCH',
        body: { english_under_telugu: on },
        prefer: 'return=minimal',
      });
    },
  };
}
