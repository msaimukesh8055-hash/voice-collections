// supabase/functions/calls-api/munshi-routes.ts
// The /munshi page's three steps (M8 A3, ADR-0018), each bound to the signed owner-call token in
// the x-call-token header (never the URL, so it stays out of logs):
//   GET  /v1/munshi/session  is the link still good? Reads only: opening the page (or a link
//                            preview bot) uses nothing up.
//   POST /v1/munshi/accept   Start call: issued → accepted (compare-and-set, once, unexpired);
//                            returns the agent variables and Munshi's Sarvam ids.
//   POST /v1/munshi/ended    accepted / in progress → completed, with seconds and interaction id.
// A tampered, unknown, used or expired token gets the same answer as "used or expired".
import { verifyOwnerCallToken } from '../_shared/auth/owner-call-link.ts';
import { istDayLabel, resolveNow } from '../_shared/clock.ts';
import type { OwnerCall, OwnerCallStatus } from '../_shared/db/owner-call-repository.ts';
import { errorResponse, jsonResponse, readJson } from '../_shared/http.ts';
import { CALL_TOKEN_HEADER } from '../_shared/sarvam.ts';
import { EndedBodySchema } from './phone-routes.ts';
import type { RouteContext } from './types.ts';

export type LinkState = 'ready' | 'used' | 'expired';

const USED: readonly OwnerCallStatus[] = ['accepted', 'in_progress', 'completed'];
const LIVE: readonly OwnerCallStatus[] = ['accepted', 'in_progress'];

function isConfigured(ctx: RouteContext): boolean {
  return ctx.deps.munshi.linkSecret !== null && ctx.deps.sarvam.munshiAppId !== null;
}

/** The owner call the header's token was signed for, or null (tampered, unknown, missing). */
async function findOwnerCall(req: Request, ctx: RouteContext): Promise<OwnerCall | null> {
  const { linkSecret, ownerCalls } = ctx.deps.munshi;
  const token = req.headers.get(CALL_TOKEN_HEADER);
  const ownerCallId = linkSecret === null ? null : await verifyOwnerCallToken(linkSecret, token);
  return ownerCallId === null ? null : await ownerCalls.getOwnerCall(ownerCallId);
}

function stateOf(call: OwnerCall, realNow: Date): LinkState {
  if (USED.includes(call.status)) return 'used';
  const usable = call.status === 'issued' && Date.parse(call.expiresAt) > realNow.getTime();
  return usable ? 'ready' : 'expired';
}

export async function getMunshiSession(req: Request, ctx: RouteContext): Promise<Response> {
  if (!isConfigured(ctx)) return errorResponse('VOICE_NOT_CONFIGURED', ctx.cors);
  const found = await findOwnerCall(req, ctx);
  const state: LinkState = found ? stateOf(found, ctx.deps.clock()) : 'expired';
  return jsonResponse({ state }, 200, ctx.cors);
}

/** "Srinivas" from "Srinivas Reddy": Munshi calls him by his first name. */
function shortNameOf(ownerName: string): string {
  return ownerName.trim().replace(/\s.*$/s, '');
}

export async function acceptMunshi(req: Request, ctx: RouteContext): Promise<Response> {
  const { deps, cors } = ctx;
  const appId = deps.sarvam.munshiAppId;
  if (appId === null || !isConfigured(ctx)) return errorResponse('VOICE_NOT_CONFIGURED', cors);
  const [found, owner, settings] = await Promise.all([
    findOwnerCall(req, ctx),
    deps.munshi.getOwner(),
    deps.repo.getDemoSettings(),
  ]);
  if (!found) return errorResponse('NOT_FOUND', cors);
  const now = deps.clock();
  const startable = owner !== null && owner.id === found.ownerId &&
    stateOf(found, now) === 'ready';
  if (!startable) return errorResponse('CALL_STATE_CONFLICT', cors);
  const patch = { status: 'accepted', acceptedAt: now.toISOString() } as const;
  const accepted = await deps.munshi.ownerCalls.transitionOwnerCall(found.id, ['issued'], patch);
  if (!accepted) return errorResponse('CALL_STATE_CONFLICT', cors);
  deps.log('info', 'owner_call_accepted', { ownerCallId: found.id });
  const { orgId, workspaceId } = deps.sarvam;
  return jsonResponse(
    {
      ownerCallToken: found.id,
      ownerName: owner.name,
      ownerShortName: shortNameOf(owner.name),
      businessName: owner.businessName,
      // Lets Munshi turn "the 15th" into a date (demo clock aware).
      today: istDayLabel(resolveNow(settings.demoClock, now)),
      sarvam: { orgId, workspaceId, appId },
    },
    200,
    cors,
  );
}

export async function endMunshi(req: Request, ctx: RouteContext): Promise<Response> {
  const body = EndedBodySchema.safeParse(await readJson(req));
  if (!body.success) return errorResponse('BAD_REQUEST', ctx.cors);
  const found = await findOwnerCall(req, ctx);
  if (!found) return errorResponse('NOT_FOUND', ctx.cors);
  const { interactionId, seconds } = body.data;
  const ended = await ctx.deps.munshi.ownerCalls.transitionOwnerCall(found.id, LIVE, {
    status: 'completed',
    endedAt: ctx.deps.clock().toISOString(),
    durationSeconds: seconds,
    ...(interactionId === undefined ? {} : { interactionId }),
  });
  if (!ended) return errorResponse('CALL_STATE_CONFLICT', ctx.cors);
  ctx.deps.log('info', 'owner_call_ended', { ownerCallId: found.id, seconds });
  return jsonResponse({ status: 'completed' }, 200, ctx.cors);
}
