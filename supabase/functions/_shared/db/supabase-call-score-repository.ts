// supabase/functions/_shared/db/supabase-call-score-repository.ts
// CallScoreRepository over the database HTTP API (service role). Scores are upserted on
// (agent, call_id); a bad row is an error, as for every read.
import { z } from 'zod';
import type { CallScore, Publish } from '../calls/agent-health.ts';
import type { CallScoreRepository } from './call-score-repository.ts';
import type { PostgrestClient } from './postgrest.ts';

const id = encodeURIComponent;
const AgentSchema = z.enum(['asha', 'munshi']);
const COLUMNS =
  'agent,call_id,started_at,verdict,passed,applicable,checks,tone,cost_inr,reply_p50_ms';

const ScoreRow = z.object({
  agent: AgentSchema,
  call_id: z.string(),
  started_at: z.string(),
  verdict: z.enum(['good', 'check', 'failed']),
  passed: z.number().int(),
  applicable: z.number().int(),
  checks: z.array(z.object({
    id: z.string(),
    label: z.string(),
    group: z.string(),
    status: z.enum(['pass', 'warn', 'fail', 'na']),
  })),
  tone: z.record(z.string(), z.number()).catch({}),
  cost_inr: z.coerce.number().nullable(),
  reply_p50_ms: z.number().int().nullable(),
}).transform((row): CallScore => ({
  agent: row.agent,
  callId: row.call_id,
  startedAt: row.started_at,
  verdict: row.verdict,
  passed: row.passed,
  applicable: row.applicable,
  checks: row.checks,
  tone: row.tone,
  costInr: row.cost_inr,
  replyP50Ms: row.reply_p50_ms,
}));

const PublishRow = z.object({
  agent: z.string(),
  sarvam_version: z.number().int(),
  published_at: z.string(),
});

export function createSupabaseCallScoreRepository(query: PostgrestClient): CallScoreRepository {
  return {
    async saveCallScore(score): Promise<void> {
      await query('saveCallScore', 'call_scores?on_conflict=agent,call_id', {
        method: 'POST',
        body: {
          agent: score.agent,
          call_id: score.callId,
          started_at: score.startedAt,
          verdict: score.verdict,
          passed: score.passed,
          applicable: score.applicable,
          checks: score.checks,
          tone: score.tone,
          cost_inr: score.costInr,
          reply_p50_ms: score.replyP50Ms,
          scored_at: new Date().toISOString(),
        },
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
    },
    async listCallScores(agent, limit): Promise<readonly CallScore[]> {
      const path = `call_scores?select=${COLUMNS}&agent=eq.${id(agent)}` +
        `&order=started_at.desc&limit=${limit}`;
      return z.array(ScoreRow).parse((await query('listCallScores', path)).rows);
    },
    async listPublishes(): Promise<readonly Publish[]> {
      const path = 'publishes?select=agent,sarvam_version,published_at&order=published_at';
      const rows = z.array(PublishRow).parse((await query('listPublishes', path)).rows);
      return rows.flatMap((row) => {
        const agent = AgentSchema.safeParse(row.agent);
        return agent.success
          ? [{ agent: agent.data, version: row.sarvam_version, publishedAt: row.published_at }]
          : [];
      });
    },
  };
}
