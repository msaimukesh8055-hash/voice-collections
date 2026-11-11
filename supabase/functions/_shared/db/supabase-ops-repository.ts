// supabase/functions/_shared/db/supabase-ops-repository.ts
// OpsRepository over the database HTTP API (service role). The summary is one call to the
// ops_summary() database function; its JSON is checked here, so a drift between the SQL and the
// page fails loudly in one place.
import { z } from 'zod';
import type { OpsError, OpsRepository, OpsSummary, TraceStep } from './ops-repository.ts';
import { createRowInserter, type PostgrestClient } from './postgrest.ts';

/** Matches MAX_EVENTS_PER_TRACE per function; a trace can span two functions (a worker kick). */
const MAX_TRACE_STEPS = 400;
const TRACE_COLUMNS =
  'source,step,status,error_code,provider,duration_ms,tokens_in,tokens_out,detail,created_at';

/** An error storm is summarised from its newest steps; the rest stay on the ops page. */
const MAX_ERRORS = 200;
const ERROR_COLUMNS = 'trace_id,source,step,error_code,created_at';

const Count = z.coerce.number().int().nonnegative();
const ErrorRow = z.object({
  trace_id: z.uuid(),
  source: z.string(),
  step: z.string(),
  error_code: z.string().nullable(),
  created_at: z.string(),
});
const RequestCount = z.object({ requests: Count, failed: Count });
const VoiceUse = z.object({ live_minutes: Count, simulated_calls: Count });

const SummaryRow = z.object({
  windows: z.object({ day: RequestCount, week: RequestCount }),
  sources: z.array(z.object({
    source: z.string(),
    requests: Count,
    failed: Count,
    p95_ms: z.number().int().nullable(),
  })),
  tools: z.array(z.object({
    agent: z.enum(['asha', 'munshi']),
    tool: z.string(),
    calls: Count,
    p50_ms: z.number().int(),
    p95_ms: z.number().int(),
  })),
  llm: z.array(z.object({ provider: z.string(), answers: Count, rejected: Count, failed: Count })),
  tokens: z.array(z.object({
    provider: z.string(),
    today_in: Count,
    today_out: Count,
    month_in: Count,
    month_out: Count,
  })),
  paths: z.record(z.string(), Count),
  followups: z.object({ waiting: Count, stuck: Count, failed_week: Count }),
  spend: z.object({ today: VoiceUse, month: VoiceUse }),
  recent_errors: z.array(ErrorRow),
});
type SummaryRow = z.infer<typeof SummaryRow>;

const StepRow = z.object({
  source: z.string(),
  step: z.string(),
  status: z.enum(['ok', 'warn', 'error']),
  error_code: z.string().nullable(),
  provider: z.string().nullable(),
  duration_ms: z.number().int().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  detail: z.record(z.string(), z.unknown()).catch({}),
  created_at: z.string(),
});

function toError(row: z.infer<typeof ErrorRow>): OpsError {
  return {
    traceId: row.trace_id,
    source: row.source,
    step: row.step,
    errorCode: row.error_code,
    createdAt: row.created_at,
  };
}

function voiceUse(row: z.infer<typeof VoiceUse>): OpsSummary['voice']['today'] {
  return { liveMinutes: row.live_minutes, simulatedCalls: row.simulated_calls };
}

function toSummary(row: SummaryRow): OpsSummary {
  return {
    day: row.windows.day,
    week: row.windows.week,
    sources: row.sources.map(({ p95_ms: p95Ms, ...rest }) => ({ ...rest, p95Ms })),
    tools: row.tools.map(({ p50_ms: p50Ms, p95_ms: p95Ms, ...rest }) => ({
      ...rest,
      p50Ms,
      p95Ms,
    })),
    llm: row.llm,
    tokens: row.tokens.map((use) => ({
      provider: use.provider,
      today: { input: use.today_in, output: use.today_out },
      month: { input: use.month_in, output: use.month_out },
    })),
    paths: row.paths,
    followups: {
      waiting: row.followups.waiting,
      stuck: row.followups.stuck,
      failedWeek: row.followups.failed_week,
    },
    voice: { today: voiceUse(row.spend.today), month: voiceUse(row.spend.month) },
    recentErrors: row.recent_errors.map(toError),
  };
}

function toStep(row: z.infer<typeof StepRow>): TraceStep {
  return {
    source: row.source,
    step: row.step,
    status: row.status,
    errorCode: row.error_code,
    provider: row.provider,
    durationMs: row.duration_ms,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

export function createSupabaseOpsRepository(query: PostgrestClient): OpsRepository {
  const rows = createRowInserter(query);
  return {
    async listErrorsSince(sinceIso): Promise<readonly OpsError[]> {
      const path = `ops_events?select=${ERROR_COLUMNS}&status=eq.error` +
        `&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=${MAX_ERRORS}`;
      return z.array(ErrorRow).parse((await query('listOpsErrors', path)).rows).map(toError);
    },
    claimAlert: (claim) =>
      rows.insertOnce('claimOpsAlert', 'ops_alerts', {
        alert_key: claim.key,
        alert_window: claim.window,
        error_count: claim.count,
        trace_id: claim.traceId,
      }),
    async getSummary(): Promise<OpsSummary> {
      const { rows } = await query('getOpsSummary', 'rpc/ops_summary', {
        method: 'POST',
        body: {},
      });
      return toSummary(SummaryRow.parse(rows));
    },
    async listTraceSteps(traceId): Promise<readonly TraceStep[]> {
      const path = `ops_events?select=${TRACE_COLUMNS}&trace_id=eq.${encodeURIComponent(traceId)}` +
        `&order=created_at.asc&limit=${MAX_TRACE_STEPS}`;
      return z.array(StepRow).parse((await query('listTraceSteps', path)).rows).map(toStep);
    },
  };
}
