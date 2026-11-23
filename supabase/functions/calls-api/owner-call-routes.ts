// supabase/functions/calls-api/owner-call-routes.ts
// Live evals for Munshi (Saim, 2026-11-20): the Munshi call report, behind the same dashboard link
// as Asha's call pages. The list is the owner's calls to Munshi, newest first. One call is its
// facts, cost, transcript (fetched from Sarvam the first time, then kept), the English of it, every
// Munshi tool call, this call's own ops steps and Munshi's scorecard. Everything after the facts
// is best effort: if Sarvam or a read fails, the page shows the rest and the reason is logged.
import { type CallCost, callCost } from '../_shared/calls/cost.ts';
import { scoreMunshiCall } from '../_shared/calls/munshi-scorecard.ts';
import { toCallScore } from '../_shared/calls/agent-health.ts';
import { replyP50Of, type Scorecard } from '../_shared/calls/scorecard.ts';
import { withTone } from '../_shared/calls/tone-judge.ts';
import type { OwnerCallDetail } from '../_shared/db/owner-call-reads.ts';
import type { TraceStep } from '../_shared/db/ops-repository.ts';
import { errorResponse, jsonResponse } from '../_shared/http.ts';
import { englishLines, needsEnglish } from '../_shared/speech/transcript-english.ts';
import { describeFailure } from '../_shared/tools/registry.ts';
import { openInDemo } from './dashboard-routes.ts';
import { keepScore, toneOf, toneScores } from './tone-route.ts';
import { linkSteps } from './trace-links.ts';
import type { RouteContext } from './types.ts';

const OWNER_CALLS_PAGE = 50;

function withCost<T extends { readonly durationSeconds: number | null }>(
  call: T,
): T & { readonly cost: CallCost } {
  return { ...call, cost: callCost({ mode: 'live', durationSeconds: call.durationSeconds }) };
}

async function ownerCallList(_req: Request, ctx: RouteContext): Promise<Response> {
  const { book, ownerCalls } = ctx.deps.dashboard;
  const owner = await book.getOwner();
  const calls = owner ? await ownerCalls.listOwnerCalls(owner.id, OWNER_CALLS_PAGE) : [];
  return jsonResponse({ calls: calls.map(withCost) }, 200, ctx.cors);
}

/** The transcript from Sarvam, once: kept on the owner call after the first read. */
async function withTranscript(call: OwnerCallDetail, ctx: RouteContext): Promise<OwnerCallDetail> {
  const client = ctx.deps.dashboard.munshiTranscripts;
  if (call.transcript || !call.interactionId || !client || call.status !== 'completed') return call;
  const result = await client.fetchTranscript(call.interactionId);
  if (result.kind !== 'ready') return call;
  await ctx.deps.dashboard.ownerCalls.saveOwnerCallTranscript(call.id, result.turns).catch(
    (error: unknown) =>
      ctx.deps.log('warn', 'owner_transcript_not_saved', { error: describeFailure(error) }),
  );
  return { ...call, transcript: result.turns };
}

async function withEnglish(call: OwnerCallDetail, ctx: RouteContext): Promise<OwnerCallDetail> {
  const { translate, ownerCalls, book } = ctx.deps.dashboard;
  const turns = call.transcript;
  if (!translate || !turns || call.transcriptEnglish || !needsEnglish(turns)) return call;
  const owner = await book.getOwner();
  const shopkeepers = owner ? await book.listShopkeepers(owner.id) : [];
  const names = [
    ...(owner ? [owner.name, owner.businessName] : []),
    ...shopkeepers.flatMap((shopkeeper) => [shopkeeper.name, shopkeeper.shopName]),
  ];
  const lines = await englishLines(turns, translate, names);
  await ownerCalls.saveOwnerCallEnglish(call.id, lines).catch((error: unknown) =>
    ctx.deps.log('warn', 'owner_transcript_english_not_saved', { error: describeFailure(error) })
  );
  return { ...call, transcriptEnglish: lines };
}

async function stepsOf(ownerCallId: string, ctx: RouteContext): Promise<readonly TraceStep[]> {
  try {
    return await ctx.deps.dashboard.ops.listCallSteps(ownerCallId);
  } catch (error) {
    ctx.deps.log('warn', 'owner_call_steps_not_read', { error: describeFailure(error) });
    return [];
  }
}

export interface MunshiReport {
  readonly call: OwnerCallDetail;
  readonly scorecard: Scorecard;
  readonly steps: readonly TraceStep[];
}

/** One Munshi call's report; the score is kept for Agent health (best effort). */
export async function munshiReport(
  found: OwnerCallDetail,
  ctx: RouteContext,
): Promise<MunshiReport> {
  const [call, steps] = await Promise.all([
    withTranscript(found, ctx).then((one) => withEnglish(one, ctx)),
    stepsOf(found.id, ctx),
  ]);
  const tone = await toneOf({
    agent: 'munshi',
    transcript: call.transcript,
    toneJudgement: call.toneJudgement,
    save: (judgement) => ctx.deps.dashboard.ownerCalls.saveOwnerCallTone(call.id, judgement),
  }, ctx);
  const scored = scoreMunshiCall({
    startedAt: call.acceptedAt ?? call.issuedAt,
    durationSeconds: call.durationSeconds,
    transcript: call.transcript,
    tools: call.toolEvents,
    steps,
  });
  const scorecard = withTone(scored, 'munshi', tone);
  await keepScore(
    toCallScore({
      agent: 'munshi',
      callId: call.id,
      startedAt: call.acceptedAt ?? call.issuedAt,
      tone: toneScores(tone),
      costInr: withCost(call).cost.inr,
      replyP50Ms: replyP50Of(steps),
    }, scorecard),
    ctx,
  );
  return { call, scorecard, steps };
}

async function ownerCallDetail(_req: Request, ctx: RouteContext): Promise<Response> {
  const found = await ctx.deps.dashboard.ownerCalls.getOwnerCallDetail(String(ctx.params[0]));
  if (!found) return errorResponse('NOT_FOUND', ctx.cors);
  const { call, scorecard, steps } = await munshiReport(found, ctx);
  const { interactionId: _id, toneJudgement: _tone, ...shown } = call;
  const trace = linkSteps(steps, ctx);
  return jsonResponse({ call: { ...withCost(shown), scorecard, trace } }, 200, ctx.cors);
}

export const OWNER_CALL_ROUTES = {
  list: openInDemo(ownerCallList),
  detail: openInDemo(ownerCallDetail),
} as const;
