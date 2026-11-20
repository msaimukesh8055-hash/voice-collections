// supabase/functions/_shared/db/call-detail-rows.ts
// Row shapes shared by the Asha and Munshi call-detail reads: the transcript columns and the tool
// events. A tool event loses `call_token` (the call's own id, no use on screen) before it leaves.
import { z } from 'zod';
import { ToneJudgementSchema } from '../calls/tone-judge.ts';
import type { DashboardToolEvent } from './dashboard-repository.ts';

const TurnSchema = z.object({ role: z.enum(['assistant', 'user']), content: z.string() });
const JsonObject = z.record(z.string(), z.unknown()).catch({});

/** The transcript columns both call tables have; a malformed value reads as null. */
export const TRANSCRIPT_FIELDS = {
  transcript: z.array(TurnSchema).nullable().catch(null),
  transcript_en: z.array(z.string().nullable()).nullable().catch(null),
  tone_judgement: ToneJudgementSchema.nullable().catch(null),
};

function withoutToken(args: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const { call_token: _token, ...rest } = args;
  return rest;
}

export const ToolEventRow = z.object({
  tool: z.string(),
  args: JsonObject,
  result: JsonObject,
  duration_ms: z.number().int().nullable(),
  created_at: z.string(),
}).transform((row): DashboardToolEvent => ({
  tool: row.tool,
  args: withoutToken(row.args),
  result: row.result,
  durationMs: row.duration_ms,
  createdAt: row.created_at,
}));
