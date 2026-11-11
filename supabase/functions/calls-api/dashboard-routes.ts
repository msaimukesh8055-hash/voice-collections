// supabase/functions/calls-api/dashboard-routes.ts
// The web dashboard's reads (SPEC §12, M6 Decision 9). Every route first checks the signed link
// token (x-dashboard-token) and answers 401 with no data without a valid one, unless DASHBOARD_PUBLIC=on
// (public demo, fake data: every route, the setting too, is open). Figures are worked
// out here with the same code as WhatsApp (dues, insights, score), on the demo-clock date. The
// one write is the "English under Telugu" demo switch.
import { z } from 'zod';
import { DASHBOARD_TOKEN_HEADER, isValidDashboardToken } from '../_shared/auth/dashboard-link.ts';
import { type CallCost, callCost } from '../_shared/calls/cost.ts';
import { istDate, resolveNow } from '../_shared/clock.ts';
import type { BookShopkeeper } from '../_shared/db/book-repository.ts';
import type { DashboardCall, DashboardCallDetail } from '../_shared/db/dashboard-repository.ts';
import { englishLines, needsEnglish } from '../_shared/speech/transcript-english.ts';
import { describeFailure } from '../_shared/tools/registry.ts';
import { errorResponse, jsonResponse, readJson } from '../_shared/http.ts';
import { computeDues } from '../_shared/ledger/dues.ts';
import { computeInsights } from '../_shared/ledger/insights.ts';
import { scoreFrom } from '../_shared/reminders/score-explain.ts';
import type { RouteContext, RouteHandler } from './types.ts';

const RECENT_CALLS = 10;
const CALLS_PAGE = 50;
const SHOPKEEPER_CALLS = 10;
const SHOPKEEPER_ENTRIES = 20;
const NOTES = 5;

const SettingsBody = z.object({ englishUnderTelugu: z.boolean() });

async function todayOf(ctx: RouteContext): Promise<string> {
  const { demoClock } = await ctx.deps.repo.getDemoSettings();
  return istDate(resolveNow(demoClock, ctx.deps.clock()));
}

/** Public demo (DASHBOARD_PUBLIC=on): the route runs without the link token. */
export function openInDemo(handler: RouteHandler): RouteHandler {
  const checked = guarded(handler);
  return async function maybeOpen(req, ctx): Promise<Response> {
    if (ctx.deps.dashboard.publicDemo === true) return await handler(req, ctx);
    return await checked(req, ctx);
  };
}

/** Runs the route only for a valid dashboard token (real time, not the demo clock). */
function guarded(handler: RouteHandler): RouteHandler {
  return async function checked(req, ctx): Promise<Response> {
    const token = req.headers.get(DASHBOARD_TOKEN_HEADER);
    const valid = await isValidDashboardToken(
      token,
      ctx.deps.dashboard.linkSecret,
      ctx.deps.clock(),
    );
    if (!valid) return errorResponse('UNAUTHORIZED', ctx.cors);
    return await handler(req, ctx);
  };
}

function nameMap(shopkeepers: readonly BookShopkeeper[]): ReadonlyMap<string, BookShopkeeper> {
  return new Map(shopkeepers.map((shopkeeper) => [shopkeeper.id, shopkeeper]));
}

/** A call as the dashboard shows it: who, and what it cost. */
export type CallRow<T extends DashboardCall> = T & {
  readonly shopkeeperName: string;
  readonly shopName: string;
  readonly cost: CallCost;
};

function callRow<T extends DashboardCall>(
  call: T,
  names: ReadonlyMap<string, BookShopkeeper>,
): CallRow<T> {
  const shopkeeper = names.get(call.shopkeeperId);
  return {
    ...call,
    shopkeeperName: shopkeeper?.name ?? '?',
    shopName: shopkeeper?.shopName ?? '',
    cost: callCost(call),
  };
}

async function overview(_req: Request, ctx: RouteContext): Promise<Response> {
  const { book, reads, score } = ctx.deps.dashboard;
  const owner = await book.getOwner();
  if (!owner) return errorResponse('NOT_FOUND', ctx.cors);
  const [today, shopkeepers, entries, calls] = await Promise.all([
    todayOf(ctx),
    book.listShopkeepers(owner.id),
    book.listEntries(owner.id),
    reads.listCalls({ limit: RECENT_CALLS }),
  ]);
  const insights = computeInsights(shopkeepers, entries, today);
  const top = await Promise.all(insights.top.map(async (row) => {
    const own = entries.filter((entry) => entry.shopkeeperId === row.shopkeeper.id);
    const result = await scoreFrom(score, { shopkeeperId: row.shopkeeper.id, entries: own, today });
    return { ...row, score: result.score, band: result.band };
  }));
  const names = nameMap(shopkeepers);
  return jsonResponse(
    {
      owner: { name: owner.name, businessName: owner.businessName },
      settings: { englishUnderTelugu: owner.englishUnderTelugu },
      insights: { ...insights, top },
      calls: calls.map((call) => callRow(call, names)),
    },
    200,
    ctx.cors,
  );
}

async function shopkeeperList(_req: Request, ctx: RouteContext): Promise<Response> {
  const { book } = ctx.deps.dashboard;
  const owner = await book.getOwner();
  if (!owner) return errorResponse('NOT_FOUND', ctx.cors);
  const [today, shopkeepers, entries] = await Promise.all([
    todayOf(ctx),
    book.listShopkeepers(owner.id),
    book.listEntries(owner.id),
  ]);
  const rows = shopkeepers.map((shopkeeper) => {
    const dues = computeDues(entries.filter((e) => e.shopkeeperId === shopkeeper.id), today);
    return {
      ...shopkeeper,
      outstanding: dues.outstanding,
      overdueAmount: dues.overdueAmount,
      daysOverdue: dues.daysOverdue,
    };
  });
  rows.sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name));
  return jsonResponse({ today, shopkeepers: rows }, 200, ctx.cors);
}

async function shopkeeperDetail(_req: Request, ctx: RouteContext): Promise<Response> {
  const { book, reads, score } = ctx.deps.dashboard;
  const shopkeeperId = String(ctx.params[0]);
  const owner = await book.getOwner();
  const shopkeepers = owner ? await book.listShopkeepers(owner.id) : [];
  const shopkeeper = shopkeepers.find((item) => item.id === shopkeeperId);
  if (!shopkeeper) return errorResponse('NOT_FOUND', ctx.cors);
  const [today, entries, promises, notes, calls] = await Promise.all([
    todayOf(ctx),
    book.listShopkeeperEntries(shopkeeperId),
    reads.listPromises(shopkeeperId),
    reads.listNotes(shopkeeperId, NOTES),
    reads.listCalls({ limit: SHOPKEEPER_CALLS, shopkeeperId }),
  ]);
  const result = await scoreFrom(score, { shopkeeperId, entries, today });
  const recent = [...entries]
    .sort((a, b) =>
      b.entryDate.localeCompare(a.entryDate) || b.createdAt.localeCompare(a.createdAt)
    )
    .slice(0, SHOPKEEPER_ENTRIES);
  return jsonResponse(
    {
      today,
      shopkeeper,
      dues: computeDues(entries, today),
      score: result,
      entries: recent,
      promises,
      notes,
      calls: calls.map((call) => callRow(call, nameMap([shopkeeper]))),
    },
    200,
    ctx.cors,
  );
}

async function callList(_req: Request, ctx: RouteContext): Promise<Response> {
  const { book, reads } = ctx.deps.dashboard;
  const owner = await book.getOwner();
  const [shopkeepers, calls] = await Promise.all([
    owner ? book.listShopkeepers(owner.id) : Promise.resolve([]),
    reads.listCalls({ limit: CALLS_PAGE }),
  ]);
  const names = nameMap(shopkeepers);
  return jsonResponse({ calls: calls.map((call) => callRow(call, names)) }, 200, ctx.cors);
}

/** The transcript's English, made once on first view and kept on the call (M6 Decision 4).
 * Best effort: if it can't be made or saved, the page shows the transcript alone. */
async function withEnglish(
  call: DashboardCallDetail,
  ctx: RouteContext,
  names: readonly string[],
): Promise<DashboardCallDetail> {
  const { translate, reads } = ctx.deps.dashboard;
  const turns = call.transcript;
  if (!translate || !turns || call.transcriptEnglish || !needsEnglish(turns)) return call;
  const lines = await englishLines(turns, translate, names);
  await reads.saveEnglishTranscript(call.id, lines).catch((error: unknown) =>
    ctx.deps.log('warn', 'transcript_english_not_saved', { error: describeFailure(error) })
  );
  return { ...call, transcriptEnglish: lines };
}

async function callDetail(_req: Request, ctx: RouteContext): Promise<Response> {
  const { book, reads } = ctx.deps.dashboard;
  const found = await reads.getCall(String(ctx.params[0]));
  if (!found) return errorResponse('NOT_FOUND', ctx.cors);
  const owner = await book.getOwner();
  const shopkeepers = owner ? await book.listShopkeepers(owner.id) : [];
  const names = [
    ...(owner ? [owner.name, owner.businessName] : []),
    ...shopkeepers.flatMap((shopkeeper) => [shopkeeper.name, shopkeeper.shopName]),
  ];
  const call = await withEnglish(found, ctx, names);
  return jsonResponse({ call: callRow(call, nameMap(shopkeepers)) }, 200, ctx.cors);
}

async function changeSettings(req: Request, ctx: RouteContext): Promise<Response> {
  const parsed = SettingsBody.safeParse(await readJson(req));
  if (!parsed.success) return errorResponse('BAD_REQUEST', ctx.cors);
  const { book, reads } = ctx.deps.dashboard;
  const owner = await book.getOwner();
  if (!owner) return errorResponse('NOT_FOUND', ctx.cors);
  await reads.setEnglishUnderTelugu(owner.id, parsed.data.englishUnderTelugu);
  ctx.deps.log('info', 'dashboard_setting', { englishUnderTelugu: parsed.data.englishUnderTelugu });
  return jsonResponse({ settings: parsed.data }, 200, ctx.cors);
}

export const DASHBOARD_ROUTES = {
  overview: openInDemo(overview),
  shopkeepers: openInDemo(shopkeeperList),
  shopkeeper: openInDemo(shopkeeperDetail),
  calls: openInDemo(callList),
  call: openInDemo(callDetail),
  settings: openInDemo(changeSettings),
} as const;
