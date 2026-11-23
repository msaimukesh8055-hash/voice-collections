// supabase/functions/calls-api/whatsapp-routes.ts
// WhatsApp live checks (Saim, 2026-11-22; ADR-0022): GET /v1/dashboard/whatsapp lists the owner's
// latest WhatsApp exchanges with each one's verdict; GET /v1/dashboard/whatsapp/:id is one
// exchange with its full scorecard. Scored on every read (pure code, ₹0), so nothing is kept.
// 2026-11-23: one exchange also returns its trace steps (AI steps linked to Langfuse).
import type { Scorecard } from '../_shared/calls/scorecard.ts';
import { scoreExchange } from '../_shared/calls/whatsapp-scorecard.ts';
import type { ExchangeRow } from '../_shared/db/exchange-repository.ts';
import type { TraceStep } from '../_shared/db/ops-repository.ts';
import { describeFailure } from '../_shared/tools/registry.ts';
import { jsonResponse } from '../_shared/http.ts';
import { openInDemo } from './dashboard-routes.ts';
import { linkSteps } from './trace-links.ts';
import type { RouteContext } from './types.ts';

/** Exchanges listed on the page (and read for one exchange's report). */
export const EXCHANGES_PAGE = 100;

/** Why a message is not "went well", for the list: the checks that failed, or, when only
 * warnings brought it down, the warnings. Empty when it went well. */
export function reasonsOf(card: Scorecard): readonly string[] {
  if (card.verdict === 'good') return [];
  const checks = card.groups.flatMap((group) => group.checks);
  const fails = checks.filter((one) => one.status === 'fail');
  const shown = fails.length > 0 ? fails : checks.filter((one) => one.status === 'warn');
  return shown.map((one) => one.id);
}

function listed(row: ExchangeRow, now: Date): Record<string, unknown> {
  const card = scoreExchange(row, now);
  return {
    id: row.id,
    createdAt: row.createdAt,
    msgType: row.msgType,
    path: row.path,
    command: row.command,
    inText: row.inText,
    isTest: row.isTest,
    handleMs: row.handleMs,
    verdict: card.verdict,
    passed: card.passed,
    applicable: card.applicable,
    reasons: reasonsOf(card),
  };
}

async function exchangeList(_req: Request, ctx: RouteContext): Promise<Response> {
  const rows = await ctx.deps.dashboard.exchanges.listExchanges(EXCHANGES_PAGE);
  const now = ctx.deps.clock();
  return jsonResponse({ exchanges: rows.map((row) => listed(row, now)) }, 200, ctx.cors);
}

async function exchangeDetail(_req: Request, ctx: RouteContext): Promise<Response> {
  const id = ctx.params[0] ?? '';
  const rows = await ctx.deps.dashboard.exchanges.listExchanges(EXCHANGES_PAGE);
  const row = rows.find((one) => one.id === id);
  if (!row) return jsonResponse({ error: 'not_found' }, 404, ctx.cors);
  const steps = linkSteps(await exchangeSteps(row, ctx), ctx);
  return jsonResponse(
    { exchange: row, scorecard: scoreExchange(row, ctx.deps.clock()), trace: steps },
    200,
    ctx.cors,
  );
}

/** Readable traces (2026-11-23): what happened while handling this message, step by step.
 * Best effort: older messages have no trace id, and a failed read leaves the report as it was. */
async function exchangeSteps(row: ExchangeRow, ctx: RouteContext): Promise<readonly TraceStep[]> {
  if (!row.traceId) return [];
  try {
    return await ctx.deps.dashboard.ops.listTraceSteps(row.traceId);
  } catch (error) {
    ctx.deps.log('warn', 'exchange_steps_not_read', { error: describeFailure(error) });
    return [];
  }
}

export const WHATSAPP_ROUTES = {
  list: openInDemo(exchangeList),
  detail: openInDemo(exchangeDetail),
} as const;
