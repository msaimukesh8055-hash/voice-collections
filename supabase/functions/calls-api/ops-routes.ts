// supabase/functions/calls-api/ops-routes.ts
// The ops page's reads (M9 Build A), behind the same signed link as the rest of the dashboard:
//   GET /v1/dashboard/ops              → error rate, latency, LLM answers, queue, spend, errors
//   GET /v1/dashboard/ops/traces/:id   → every step of one request, oldest first
// Spend is priced here from the database's minutes and token counts (cost.ts), so the price
// list lives in one place.
import { llmCost, SPEND_CAP_INR, voiceCost } from '../_shared/calls/cost.ts';
import type { OpsSummary, SourceStats, TokenUse } from '../_shared/db/ops-repository.ts';
import { errorResponse, jsonResponse } from '../_shared/http.ts';
import { leadErrors } from '../_shared/ops/lead-errors.ts';
import { isTraceId } from '../_shared/ops/trace.ts';
import { openInDemo } from './dashboard-routes.ts';
import type { RouteContext, RouteHandler } from './types.ts';

/** Munshi's and Asha's hard latency target for server time per tool (M8 acceptance criteria). */
export const TOOL_TARGET_MS = 500;

/** The five Edge Functions. Each is always listed, with zeros when it had no requests: a
 * missing row would read as "not monitored" when it only means "no traffic" (Saim, 2026-11-11). */
export const FUNCTIONS = [
  'whatsapp-webhook',
  'sarvam-tools',
  'munshi-tools',
  'calls-api',
  'followup-worker',
] as const;

/** Every function in a fixed order, then anything else that was recorded (a drill's label). */
function allSources(recorded: readonly SourceStats[]): readonly SourceStats[] {
  const known: readonly string[] = FUNCTIONS;
  const listed = FUNCTIONS.map((source): SourceStats =>
    recorded.find((row) => row.source === source) ??
      { source, requests: 0, failed: 0, p95Ms: null }
  );
  return [...listed, ...recorded.filter((row) => !known.includes(row.source))];
}

export interface Spend {
  readonly voiceInr: number;
  readonly llmInr: number;
  readonly totalInr: number;
}

function roundInr(inr: number): number {
  return Math.round(inr * 100) / 100;
}

function spendFor(summary: OpsSummary, period: 'today' | 'month'): Spend {
  const voiceInr = voiceCost(summary.voice[period].liveMinutes);
  const perProvider = summary.tokens.map((use: TokenUse) => llmCost(use.provider, use[period]));
  const llmInr = roundInr(perProvider.reduce((sum, inr) => sum + inr, 0));
  return { voiceInr, llmInr, totalInr: roundInr(voiceInr + llmInr) };
}

async function getOps(_req: Request, { deps, cors }: RouteContext): Promise<Response> {
  const summary = await deps.dashboard.ops.getSummary();
  const body = {
    ...summary,
    // One row per failed request, not one per error step (Saim, 2026-11-11).
    recentErrors: leadErrors(summary.recentErrors),
    sources: allSources(summary.sources),
    toolTargetMs: TOOL_TARGET_MS,
    spend: {
      capInr: SPEND_CAP_INR,
      today: spendFor(summary, 'today'),
      month: spendFor(summary, 'month'),
    },
    generatedAt: deps.clock().toISOString(),
  };
  return jsonResponse(body, 200, cors);
}

async function getTrace(_req: Request, { deps, cors, params }: RouteContext): Promise<Response> {
  const traceId = params[0] ?? null;
  if (!isTraceId(traceId)) return errorResponse('NOT_FOUND', cors);
  const steps = await deps.dashboard.ops.listTraceSteps(traceId);
  if (steps.length === 0) return errorResponse('NOT_FOUND', cors);
  return jsonResponse({ traceId, steps }, 200, cors);
}

export const OPS_ROUTES: Readonly<Record<'summary' | 'trace', RouteHandler>> = {
  summary: openInDemo(getOps),
  trace: openInDemo(getTrace),
};
