// supabase/functions/calls-api/agent-health-routes.ts
// Agent health (Saim, 2026-11-20): GET /v1/dashboard/health, behind the same dashboard link.
// Asha's and Munshi's health across their recent calls, from the kept call scores. Calls that
// finished but were never scored (their report was never opened) are scored here, a few per
// load, through the same report code as their call pages, so both always agree.
import { agentHealth, HEALTH_CALLS, type HealthAgent } from '../_shared/calls/agent-health.ts';
import { exchangeScore } from '../_shared/calls/whatsapp-scorecard.ts';
import { istDate } from '../_shared/clock.ts';
import { jsonResponse } from '../_shared/http.ts';
import { describeFailure } from '../_shared/tools/registry.ts';
import { ashaReport, openInDemo } from './dashboard-routes.ts';
import { munshiReport } from './owner-call-routes.ts';
import type { RouteContext } from './types.ts';

/** Unscored calls worked out per page load; the rest follow on the next loads. */
export const SCORE_PER_LOAD = 6;

interface Unscored {
  readonly agent: Exclude<HealthAgent, 'whatsapp'>;
  readonly id: string;
}

async function finishedCalls(ctx: RouteContext): Promise<readonly Unscored[]> {
  const { book, reads, ownerCalls } = ctx.deps.dashboard;
  const owner = await book.getOwner();
  const [asha, munshi] = await Promise.all([
    reads.listCalls({ limit: HEALTH_CALLS }),
    owner ? ownerCalls.listOwnerCalls(owner.id, HEALTH_CALLS) : Promise.resolve([]),
  ]);
  return [
    ...asha.filter((call) => call.mode === 'live' && call.status === 'completed')
      .map((call) => ({ agent: 'asha' as const, id: call.id })),
    ...munshi.filter((call) => call.status === 'completed' && !call.isTest)
      .map((call) => ({ agent: 'munshi' as const, id: call.id })),
  ];
}

async function scoreOne(call: Unscored, ctx: RouteContext): Promise<void> {
  const { reads, ownerCalls } = ctx.deps.dashboard;
  if (call.agent === 'asha') {
    const found = await reads.getCall(call.id);
    if (found) await ashaReport(found, ctx);
    return;
  }
  const found = await ownerCalls.getOwnerCallDetail(call.id);
  if (found) await munshiReport(found, ctx);
}

/** Scores a few calls that have none yet; returns how many are still waiting. */
async function scoreMissing(ctx: RouteContext): Promise<number> {
  const { callScores } = ctx.deps.dashboard;
  const [calls, asha, munshi] = await Promise.all([
    finishedCalls(ctx),
    callScores.listCallScores('asha', HEALTH_CALLS),
    callScores.listCallScores('munshi', HEALTH_CALLS),
  ]);
  const kept = new Set([...asha, ...munshi].map((score) => `${score.agent}:${score.callId}`));
  const missing = calls.filter((call) => !kept.has(`${call.agent}:${call.id}`));
  const now = missing.slice(0, SCORE_PER_LOAD);
  await Promise.all(
    now.map((call) =>
      scoreOne(call, ctx).catch((error: unknown) =>
        ctx.deps.log('warn', 'health_score_failed', {
          agent: call.agent,
          error: describeFailure(error),
        })
      )
    ),
  );
  return missing.length - now.length;
}

async function health(_req: Request, ctx: RouteContext): Promise<Response> {
  const waiting = await scoreMissing(ctx);
  const { callScores } = ctx.deps.dashboard;
  const [asha, munshi, publishes, calls, exchanges] = await Promise.all([
    callScores.listCallScores('asha', HEALTH_CALLS),
    callScores.listCallScores('munshi', HEALTH_CALLS),
    callScores.listPublishes(),
    finishedCalls(ctx),
    ctx.deps.dashboard.exchanges.listExchanges(HEALTH_CALLS * 2),
  ]);
  // Real dates: calls happen in real time, whatever the demo clock says.
  const today = istDate(ctx.deps.clock());
  // Only real, finished calls count (2026-11-22): a kept score for a test-script call or a
  // simulated Asha call stays on its call page but is left out of the health figures.
  const real = new Set(calls.map((call) => `${call.agent}:${call.id}`));
  const scores = [...asha, ...munshi].filter((score) => real.has(`${score.agent}:${score.callId}`));
  // WhatsApp (2026-11-22): each owner message is scored here, in code, on every load; smoke-test
  // messages are left out like test calls.
  const now = ctx.deps.clock();
  const whatsapp = exchanges.filter((row) => !row.isTest).map((row) => exchangeScore(row, now));
  return jsonResponse(
    {
      today,
      waiting,
      agents: [
        agentHealth('asha', { scores, publishes, today }),
        agentHealth('munshi', { scores, publishes, today }),
        agentHealth('whatsapp', { scores: whatsapp, publishes: [], today }),
      ],
    },
    200,
    ctx.cors,
  );
}

export const AGENT_HEALTH_ROUTES = { summary: openInDemo(health) } as const;
