// supabase/functions/calls-api/phone-routes.ts
// The borrower phone page (SPEC §7.1): it asks every 2 s whether a live call is ringing (for
// any shopkeeper, one at a time), then accepts, declines or reports the end of the call. Each step is a compare-and-set on the call's
// status, so a call can't be accepted twice or accepted after it was declined.
import { z } from 'zod';
import { istDayLabel, resolveNow } from '../_shared/clock.ts';
import { lineState } from '../_shared/calls/live-line.ts';
import { isStillRinging, OWNER_CALL_MAX_MS } from '../_shared/calls/ringing.ts';
import type { CallPatch, CallSession } from '../_shared/db/repository.ts';
import { isInteractionId } from '../_shared/sarvam-analytics.ts';
import { errorResponse, jsonResponse, readJson } from '../_shared/http.ts';
import type { CallStatus } from '../_shared/schemas/shopkeeper.ts';
import type { RouteContext } from './types.ts';

const MAX_CALL_SECONDS = 3600;
const RINGABLE: readonly CallStatus[] = ['queued', 'ringing'];
const LIVE: readonly CallStatus[] = ['accepted', 'in_progress'];

export const EndedBodySchema = z.object({
  /** Sarvam's id, e.g. "20261102/…"; absent when the call never connected. */
  // Sarvam ids contain ':' (e.g. 20261102/182f511f-21:45:10-8bfe8bd5). M3's pattern refused
  // them, so the page's report failed and calls stayed in_progress (fixed in M5).
  interactionId: z.string().refine(isInteractionId).optional(),
  seconds: z.number().int().min(0).max(MAX_CALL_SECONDS),
});

const NO_CALL = { call: null } as const;

/** Every ended call (completed, declined, missed) gets a follow-up (M5 Decision 4). */
function followupQueued(ctx: RouteContext): Pick<CallPatch, 'followupStatus' | 'followupNextAt'> {
  return { followupStatus: 'pending', followupNextAt: ctx.deps.clock().toISOString() };
}

/** The call named by the path's token, or null for a malformed or unknown token. */
async function findCall({ deps, params }: RouteContext): Promise<CallSession | null> {
  const token = z.uuid().safeParse(params[0]);
  return token.success ? await deps.repo.getCallSession(token.data) : null;
}

async function markMissed(call: CallSession, ctx: RouteContext): Promise<Response> {
  const missed = await ctx.deps.repo.transitionCall(call.callId, RINGABLE, {
    status: 'missed',
    ...followupQueued(ctx),
  });
  ctx.deps.log('info', 'call_missed', { callId: call.callId });
  if (missed) ctx.deps.kickFollowup(call.callId);
  return jsonResponse(NO_CALL, 200, ctx.cors);
}

/** The next live call for the phone page, for any shopkeeper (Live remind, pre-M6): one at a
 * time, oldest first. The page shows who Saim is answering as, from the call's own row. */
export async function getIncomingCall(_req: Request, ctx: RouteContext): Promise<Response> {
  const { repo, clock, munshi } = ctx.deps;
  const now = clock();
  // M8: while Munshi is on a call with the owner, the line is busy (one round trip for both).
  const [calls, ownerCallActive] = await Promise.all([
    repo.listOpenLiveCalls(),
    munshi.ownerCalls.hasActiveOwnerCall(new Date(now.getTime() - OWNER_CALL_MAX_MS)),
  ]);
  const line = lineState(calls, now, ownerCallActive);
  if (line.kind === 'idle' || line.kind === 'busy') return jsonResponse(NO_CALL, 200, ctx.cors);
  if (line.kind === 'stale') return markMissed(line.call, ctx);
  const { call } = line;
  const shopkeeper = await repo.getShopkeeper(call.shopkeeperId);
  if (!shopkeeper) return jsonResponse(NO_CALL, 200, ctx.cors);
  if (call.status === 'queued') {
    // The 30-second ring starts when a phone page first sees the call.
    await repo.transitionCall(call.callId, ['queued'], {
      status: 'ringing',
      ringingAt: now.toISOString(),
    });
  }
  const incoming = {
    callToken: call.callId,
    callerName: shopkeeper.businessName,
    shopkeeperName: shopkeeper.name,
    shopName: shopkeeper.shopName,
  };
  return jsonResponse({ call: incoming }, 200, ctx.cors);
}

export async function acceptCall(_req: Request, ctx: RouteContext): Promise<Response> {
  const { repo, clock, sarvam } = ctx.deps;
  const call = await findCall(ctx);
  if (!call) return errorResponse('NOT_FOUND', ctx.cors);
  if (sarvam.appId === null) return errorResponse('VOICE_NOT_CONFIGURED', ctx.cors);
  const now = clock();
  const answerable = call.status === 'ringing' && isStillRinging(call, now);
  const patch = { status: 'accepted', acceptedAt: now.toISOString() } as const;
  const [accepted, shopkeeper, settings] = await Promise.all([
    answerable ? repo.transitionCall(call.callId, ['ringing'], patch) : Promise.resolve(false),
    repo.getShopkeeper(call.shopkeeperId),
    repo.getDemoSettings(),
  ]);
  if (!accepted || !shopkeeper) return errorResponse('CALL_STATE_CONFLICT', ctx.cors);
  ctx.deps.log('info', 'call_accepted', { callId: call.callId });
  return jsonResponse(
    {
      callToken: call.callId,
      language: call.language,
      shopkeeperName: shopkeeper.name,
      shopName: shopkeeper.shopName,
      ownerName: shopkeeper.ownerName,
      businessName: shopkeeper.businessName,
      // Lets Asha turn "Monday" into a date for log_promise (demo clock aware).
      today: istDayLabel(resolveNow(settings.demoClock, now)),
      sarvam: { orgId: sarvam.orgId, workspaceId: sarvam.workspaceId, appId: sarvam.appId },
    },
    200,
    ctx.cors,
  );
}

export async function declineCall(_req: Request, ctx: RouteContext): Promise<Response> {
  const call = await findCall(ctx);
  if (!call) return errorResponse('NOT_FOUND', ctx.cors);
  const declined = await ctx.deps.repo.transitionCall(call.callId, RINGABLE, {
    status: 'declined',
    ...followupQueued(ctx),
  });
  if (!declined) return errorResponse('CALL_STATE_CONFLICT', ctx.cors);
  ctx.deps.log('info', 'call_declined', { callId: call.callId });
  ctx.deps.kickFollowup(call.callId);
  return jsonResponse({ status: 'declined' }, 200, ctx.cors);
}

export async function endCall(req: Request, ctx: RouteContext): Promise<Response> {
  const body = EndedBodySchema.safeParse(await readJson(req));
  if (!body.success) return errorResponse('BAD_REQUEST', ctx.cors);
  const call = await findCall(ctx);
  if (!call) return errorResponse('NOT_FOUND', ctx.cors);
  const { interactionId, seconds } = body.data;
  // Never overwrite an id already stored (e.g. one fetched from Sarvam's analytics later).
  const keepsId = call.interactionId !== null || interactionId === undefined;
  const ended = await ctx.deps.repo.transitionCall(call.callId, LIVE, {
    status: 'completed',
    endedAt: ctx.deps.clock().toISOString(),
    durationSeconds: seconds,
    ...(keepsId ? {} : { interactionId }),
    ...followupQueued(ctx),
  });
  if (!ended) return errorResponse('CALL_STATE_CONFLICT', ctx.cors);
  ctx.deps.log('info', 'call_ended', { callId: call.callId, seconds });
  ctx.deps.kickFollowup(call.callId);
  return jsonResponse({ status: 'completed' }, 200, ctx.cors);
}
