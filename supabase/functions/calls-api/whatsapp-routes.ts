// supabase/functions/calls-api/whatsapp-routes.ts
// WhatsApp live checks (Saim, 2026-11-22; ADR-0022): GET /v1/dashboard/whatsapp lists the owner's
// latest WhatsApp exchanges with each one's verdict; GET /v1/dashboard/whatsapp/:id is one
// exchange with its full scorecard. Scored on every read (pure code, ₹0), so nothing is kept.
import { scoreExchange } from '../_shared/calls/whatsapp-scorecard.ts';
import type { ExchangeRow } from '../_shared/db/exchange-repository.ts';
import { jsonResponse } from '../_shared/http.ts';
import { openInDemo } from './dashboard-routes.ts';
import type { RouteContext } from './types.ts';

/** Exchanges listed on the page (and read for one exchange's report). */
export const EXCHANGES_PAGE = 100;

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
  return jsonResponse(
    { exchange: row, scorecard: scoreExchange(row, ctx.deps.clock()) },
    200,
    ctx.cors,
  );
}

export const WHATSAPP_ROUTES = {
  list: openInDemo(exchangeList),
  detail: openInDemo(exchangeDetail),
} as const;
