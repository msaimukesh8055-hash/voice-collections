// supabase/functions/munshi-tools/handler.ts
// Munshi's tool server (M8 A4, ADR-0018). Sarvam POSTs one flat JSON body per tool call to
// /munshi-tools/<tool>: { owner_call_token, ...arguments }, with the owner tool secret (never
// Asha's) as a bearer token. Order: secret → parse → find the owner call from its token → check
// it is live and the owner's → run the tool → wrap-up note → audit → reply. The token resolves
// only in owner_calls, so a shopkeeper call id is never accepted here (and an owner call id
// never resolves in sarvam-tools). Build B adds the writes (voice actions, confirm, cancel); no
// LLM, Meta or Translate call here (a WhatsApp send is a background kick to the worker).
import { z } from 'zod';
import { hasBearerSecret } from '../_shared/auth/bearer.ts';
import { istDate, resolveNow } from '../_shared/clock.ts';
import type { BookRepository, Owner } from '../_shared/db/book-repository.ts';
import {
  ACTIVE_OWNER_CALL_STATUSES,
  type OwnerCall,
  type OwnerCallRepository,
} from '../_shared/db/owner-call-repository.ts';
import type { Repository } from '../_shared/db/repository.ts';
import {
  errorResponse,
  jsonResponse,
  pathAfter,
  readJson,
  withErrorBoundary,
} from '../_shared/http.ts';
import type { Logger } from '../_shared/log.ts';
import { OWNER_CALL_TOKEN_VARIABLE, WARM_TOOLS_PATH } from '../_shared/sarvam.ts';
import { OWNER_TOOL_TTL_MS } from '../_shared/calls/owner-call-limits.ts';
import { auditOwnerToolRun } from '../_shared/owner-tools/audit.ts';
import { type OwnerToolRun, runOwnerTool } from '../_shared/owner-tools/registry.ts';
import { ownerFail, type OwnerReads, type OwnerWrites } from '../_shared/owner-tools/types.ts';
import { withWrapUp } from '../_shared/owner-tools/wrap-up.ts';
import { AUDIT_MARKERS } from '../_shared/tools/define.ts';
import { toReplyBody } from '../_shared/tools/types.ts';

const FUNCTION_PREFIX = '/munshi-tools/';
/** GET /munshi-tools/warm wakes the function; the call page pings it. Reads and returns nothing. */
export const WARM_PATH = WARM_TOOLS_PATH;

export interface OwnerToolsDeps {
  readonly ownerCalls: Pick<OwnerCallRepository, 'getOwnerCall' | 'insertOwnerToolEvent'>;
  readonly reads: OwnerReads;
  readonly writes: OwnerWrites;
  readonly getDemoSettings: Repository['getDemoSettings'];
  readonly getOwner: BookRepository['getOwner'];
  readonly secret: string;
  readonly clock: () => Date;
  readonly log: Logger;
}

const BodySchema = z.looseObject({ [OWNER_CALL_TOKEN_VARIABLE]: z.unknown().optional() });
type Body = z.infer<typeof BodySchema>;

type RefusalReason =
  | 'missing_token'
  | 'unknown_token'
  | 'not_active'
  | 'token_expired'
  | 'owner_mismatch';

type Authorisation =
  | {
    readonly ok: true;
    readonly ownerCall: OwnerCall;
    readonly owner: Owner;
    readonly today: string;
  }
  | { readonly ok: false; readonly ownerCall: OwnerCall | null; readonly reason: RefusalReason };

/** The tool name comes from our URL (set in the agent config), not from the LLM. */
function toolNameOf(req: Request): string {
  return pathAfter(req, FUNCTION_PREFIX);
}

function isExpired(ownerCall: OwnerCall, realNow: Date): boolean {
  if (ownerCall.acceptedAt === null) return true;
  return realNow.getTime() - Date.parse(ownerCall.acceptedAt) > OWNER_TOOL_TTL_MS;
}

function refusalOf(ownerCall: OwnerCall, owner: Owner, realNow: Date): RefusalReason | null {
  if (!ACTIVE_OWNER_CALL_STATUSES.includes(ownerCall.status)) return 'not_active';
  if (isExpired(ownerCall, realNow)) return 'token_expired';
  if (owner.id !== ownerCall.ownerId) return 'owner_mismatch';
  return null;
}

async function authorise(body: Body, deps: OwnerToolsDeps): Promise<Authorisation> {
  const token = z.uuid().safeParse(body[OWNER_CALL_TOKEN_VARIABLE]);
  if (!token.success) return { ok: false, ownerCall: null, reason: 'missing_token' };
  // One parallel round: the call row, the demo clock and the owner.
  const [ownerCall, settings, owner] = await Promise.all([
    deps.ownerCalls.getOwnerCall(token.data),
    deps.getDemoSettings(),
    deps.getOwner(),
  ]);
  if (!ownerCall) return { ok: false, ownerCall: null, reason: 'unknown_token' };
  if (!owner) return { ok: false, ownerCall, reason: 'owner_mismatch' };
  const realNow = deps.clock();
  const reason = refusalOf(ownerCall, owner, realNow);
  if (reason !== null) return { ok: false, ownerCall, reason };
  return { ok: true, ownerCall, owner, today: istDate(resolveNow(settings.demoClock, realNow)) };
}

function withoutToken(body: Body): Record<string, unknown> {
  const { [OWNER_CALL_TOKEN_VARIABLE]: _token, ...args } = body;
  return args;
}

async function refuse(
  tool: string,
  auth: Extract<Authorisation, { ok: false }>,
  deps: OwnerToolsDeps,
): Promise<Response> {
  deps.log('warn', 'owner_call_not_authorised', { tool, reason: auth.reason });
  const run: OwnerToolRun = {
    ...ownerFail('CALL_NOT_AUTHORISED'),
    auditArgs: AUDIT_MARKERS.notAuthorised,
  };
  if (auth.ownerCall) {
    await auditOwnerToolRun({ ownerCallId: auth.ownerCall.id, tool, run, durationMs: 0 }, deps);
  }
  return jsonResponse(toReplyBody(run.result));
}

async function handleTool(req: Request, body: Body, deps: OwnerToolsDeps): Promise<Response> {
  const started = Date.now();
  const tool = toolNameOf(req);
  const auth = await authorise(body, deps);
  if (!auth.ok) return refuse(tool, auth, deps);

  const { ownerCall, owner, today } = auth;
  const realNow = deps.clock();
  const ctx = { reads: deps.reads, writes: deps.writes, owner, ownerCall, today, realNow };
  const ran = await runOwnerTool(tool, withoutToken(body), ctx);
  const run: OwnerToolRun = {
    ...ran,
    result: withWrapUp(ran.result, ownerCall.acceptedAt, realNow),
  };
  const durationMs = Date.now() - started;
  await auditOwnerToolRun({ ownerCallId: ownerCall.id, tool, run, durationMs }, deps);
  deps.log(run.failure ? 'error' : 'info', 'owner_tool_call', {
    ownerCallId: ownerCall.id,
    tool,
    ok: run.result.ok,
    code: run.result.ok ? null : run.result.code,
    error: run.failure ?? null,
    ms: durationMs,
  });
  return jsonResponse(toReplyBody(run.result));
}

async function route(req: Request, deps: OwnerToolsDeps): Promise<Response> {
  if (req.method === 'GET' && toolNameOf(req) === WARM_PATH) {
    return new Response(null, { status: 204 });
  }
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED');
  if (!(await hasBearerSecret(req, deps.secret))) {
    deps.log('warn', 'owner_tool_request_unauthorised');
    return errorResponse('UNAUTHORIZED');
  }
  const body = BodySchema.safeParse(await readJson(req));
  if (!body.success) return errorResponse('BAD_REQUEST');
  return handleTool(req, body.data, deps);
}

export function handleOwnerToolRequest(req: Request, deps: OwnerToolsDeps): Promise<Response> {
  return withErrorBoundary(() => route(req, deps), deps.log);
}
