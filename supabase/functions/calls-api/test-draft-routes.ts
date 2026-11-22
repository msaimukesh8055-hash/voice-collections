// supabase/functions/calls-api/test-draft-routes.ts
// Live failures to tests (Saim, 2026-11-20), behind the dashboard link:
// POST /v1/dashboard/test-drafts saves "Add as a test case" from a call report or a WhatsApp
// trace; GET lists the drafts waiting to become scripted tests (shown on the Evals page). For a
// call the server fills in what was said (the caller's first lines) and what went wrong (the
// scorecard's fails and warnings) from the same report code as the call page. For a WhatsApp
// message the owner types what he sent: the bot never stores message text.
import { z } from 'zod';
import type { Scorecard } from '../_shared/calls/scorecard.ts';
import type { Turn } from '../_shared/sarvam-analytics.ts';
import { TEST_DRAFT_SOURCES } from '../_shared/db/test-draft-repository.ts';
import { errorResponse, jsonResponse, readJson } from '../_shared/http.ts';
import { ashaReport, openInDemo } from './dashboard-routes.ts';
import { munshiReport } from './owner-call-routes.ts';
import type { RouteContext } from './types.ts';

const MAX_SAID = 1000;
const MAX_PROBLEM = 1000;
const MAX_EXPECTED = 500;
const SAID_LINES = 4;
const DRAFTS_PAGE = 50;
const WHATSAPP_PROBLEM = 'The WhatsApp bot did not handle this message (see its trace).';

const DraftBody = z.object({
  source: z.enum(TEST_DRAFT_SOURCES),
  refId: z.string().trim().min(1).max(100),
  said: z.string().trim().max(MAX_SAID).optional(),
  expected: z.string().trim().max(MAX_EXPECTED).optional(),
});

/** The caller's first few lines, as the test's script. */
function callerLines(turns: readonly Turn[] | null): string {
  return (turns ?? []).filter((turn) => turn.role !== 'assistant').slice(0, SAID_LINES)
    .map((turn) => turn.content.trim()).join(' / ').slice(0, MAX_SAID);
}

/** The scorecard's fails and warnings, worst first, with their measured values. */
export function problemsOf(card: Scorecard): string {
  const checks = card.groups.flatMap((group) => group.checks);
  const rows = card.toolUse.filter((row) => row.status === 'fail')
    .map((row) => `${row.tool} needed but never ran: ${row.why}`);
  const lines = [
    ...checks.filter((one) => one.status === 'fail').map((one) =>
      `Fail: ${one.label} (${one.value})`
    ),
    ...rows.map((row) => `Fail: ${row}`),
    ...checks.filter((one) => one.status === 'warn').map((one) =>
      `Check: ${one.label} (${one.value})`
    ),
  ];
  return (lines.length === 0 ? 'Marked by the owner; every check passed.' : lines.join('\n'))
    .slice(0, MAX_PROBLEM);
}

async function fromCall(
  body: z.infer<typeof DraftBody>,
  ctx: RouteContext,
): Promise<{ said: string; problem: string } | null> {
  const { reads, ownerCalls } = ctx.deps.dashboard;
  if (body.source === 'asha_call') {
    const found = await reads.getCall(body.refId);
    if (!found) return null;
    const report = await ashaReport(found, ctx);
    return { said: callerLines(report.call.transcript), problem: problemsOf(report.scorecard) };
  }
  const found = await ownerCalls.getOwnerCallDetail(body.refId);
  if (!found) return null;
  const report = await munshiReport(found, ctx);
  return { said: callerLines(report.call.transcript), problem: problemsOf(report.scorecard) };
}

async function addDraft(req: Request, ctx: RouteContext): Promise<Response> {
  const parsed = DraftBody.safeParse(await readJson(req));
  if (!parsed.success) return errorResponse('BAD_REQUEST', ctx.cors);
  const body = parsed.data;
  let words: { said: string; problem: string } | null;
  if (body.source === 'whatsapp' || body.source === 'whatsapp_chat') {
    words = body.said ? { said: body.said, problem: WHATSAPP_PROBLEM } : null;
    if (!words) return errorResponse('BAD_REQUEST', ctx.cors);
  } else {
    words = await fromCall(body, ctx);
    if (!words) return errorResponse('NOT_FOUND', ctx.cors);
  }
  await ctx.deps.dashboard.testDrafts.saveTestDraft({
    source: body.source,
    refId: body.refId,
    said: body.said ?? words.said,
    problem: words.problem,
    expected: body.expected && body.expected !== '' ? body.expected : null,
  });
  ctx.deps.log('info', 'test_draft_saved', { source: body.source });
  return jsonResponse({ saved: true }, 200, ctx.cors);
}

async function listDrafts(_req: Request, ctx: RouteContext): Promise<Response> {
  const drafts = await ctx.deps.dashboard.testDrafts.listTestDrafts(DRAFTS_PAGE);
  return jsonResponse({ drafts }, 200, ctx.cors);
}

export const TEST_DRAFT_ROUTES = {
  add: openInDemo(addDraft),
  list: openInDemo(listDrafts),
} as const;
