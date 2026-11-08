// supabase/functions/sarvam-tools/handler.ts
// Asha's tool server (ADR-0012). Sarvam POSTs one flat JSON body per tool call to
// /sarvam-tools/<tool>: { call_token, ...arguments the LLM chose }, with our secret as a bearer
// token. Order matters: secret check → parse → find the call from its token (the LLM never says
// who the shopkeeper is) → run the tool through the registry → audit → reply. Sarvam sends no
// interaction id, so a token is locked by its state instead: accepted on the phone page, one call
// URL per token (calls-api proxy), and a time limit.
import { z } from 'zod';
import { hasBearerSecret } from '../_shared/auth/bearer.ts';
import { resolveNow } from '../_shared/clock.ts';
import type { CallSession, Repository } from '../_shared/db/repository.ts';
import {
  errorResponse,
  jsonResponse,
  pathAfter,
  readJson,
  withErrorBoundary,
} from '../_shared/http.ts';
import type { Logger } from '../_shared/log.ts';
import { CALL_TOKEN_VARIABLE, WARM_TOOLS_PATH } from '../_shared/sarvam.ts';
import type { CallStatus } from '../_shared/schemas/shopkeeper.ts';
import { AUDIT_MARKERS, runTool, type ToolRun } from '../_shared/tools/registry.ts';
import { auditToolRun } from '../_shared/tools/audit.ts';
import { fail, toReplyBody } from '../_shared/tools/types.ts';

/** Tools work for this long after the call is accepted (Sarvam caps calls at 4 minutes). */
export const CALL_TOKEN_TTL_MS = 10 * 60 * 1000;
const ACTIVE_STATUSES: readonly CallStatus[] = ['accepted', 'in_progress'];
const FUNCTION_PREFIX = '/sarvam-tools/';
/** GET /sarvam-tools/warm wakes the function before Asha's first tool call (cold start gave a 503
 * in M3 testing). The phone page calls it when a call starts ringing; it reads and returns nothing. */
export const WARM_PATH = WARM_TOOLS_PATH;

export interface ToolsDeps {
  readonly repo: Repository;
  readonly secret: string;
  readonly clock: () => Date;
  readonly log: Logger;
}

const BodySchema = z.looseObject({ [CALL_TOKEN_VARIABLE]: z.unknown().optional() });
type Body = z.infer<typeof BodySchema>;

type Authorisation =
  | { readonly ok: true; readonly session: CallSession; readonly now: Date }
  | {
    readonly ok: false;
    readonly session: CallSession | null;
    readonly reason: 'missing_token' | 'unknown_token' | 'not_active' | 'token_expired';
  };

/** The tool name comes from our URL (set in the agent config), not from the LLM. */
function toolNameOf(req: Request): string {
  return pathAfter(req, FUNCTION_PREFIX);
}

function isExpired(session: CallSession, realNow: Date): boolean {
  if (session.acceptedAt === null) return true;
  return realNow.getTime() - Date.parse(session.acceptedAt) > CALL_TOKEN_TTL_MS;
}

async function authorise(body: Body, deps: ToolsDeps): Promise<Authorisation> {
  const token = z.uuid().safeParse(body[CALL_TOKEN_VARIABLE]);
  if (!token.success) return { ok: false, session: null, reason: 'missing_token' };
  // Parallel reads: one round trip of latency.
  const [session, settings] = await Promise.all([
    deps.repo.getCallSession(token.data),
    deps.repo.getDemoSettings(),
  ]);
  if (!session) return { ok: false, session: null, reason: 'unknown_token' };
  if (!ACTIVE_STATUSES.includes(session.status)) {
    return { ok: false, session, reason: 'not_active' };
  }
  if (isExpired(session, deps.clock())) return { ok: false, session, reason: 'token_expired' };
  return { ok: true, session, now: resolveNow(settings.demoClock, deps.clock()) };
}

function withoutToken(body: Body): Record<string, unknown> {
  const { [CALL_TOKEN_VARIABLE]: _token, ...args } = body;
  return args;
}

async function refuse(
  tool: string,
  auth: Extract<Authorisation, { ok: false }>,
  deps: ToolsDeps,
): Promise<Response> {
  deps.log('warn', 'call_not_authorised', { tool, reason: auth.reason });
  const run: ToolRun = { ...fail('CALL_NOT_AUTHORISED'), auditArgs: AUDIT_MARKERS.notAuthorised };
  if (auth.session) {
    await auditToolRun({ callId: auth.session.callId, tool, run, durationMs: 0 }, deps);
  }
  return jsonResponse(toReplyBody(run.result));
}

async function handleTool(req: Request, body: Body, deps: ToolsDeps): Promise<Response> {
  const started = Date.now();
  const tool = toolNameOf(req);
  const auth = await authorise(body, deps);
  if (!auth.ok) return refuse(tool, auth, deps);

  const ctx = { repo: deps.repo, session: auth.session, now: auth.now };
  const run = await runTool(tool, withoutToken(body), ctx);
  const durationMs = Date.now() - started;
  await auditToolRun({ callId: auth.session.callId, tool, run, durationMs }, deps);
  deps.log(run.failure ? 'error' : 'info', 'tool_call', {
    callId: auth.session.callId,
    tool,
    ok: run.result.ok,
    code: run.result.ok ? null : run.result.code,
    error: run.failure ?? null,
    ms: durationMs,
  });
  return jsonResponse(toReplyBody(run.result));
}

async function route(req: Request, deps: ToolsDeps): Promise<Response> {
  if (req.method === 'GET' && toolNameOf(req) === WARM_PATH) {
    return new Response(null, { status: 204 });
  }
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED');
  if (!(await hasBearerSecret(req, deps.secret))) {
    deps.log('warn', 'tool_request_unauthorised');
    return errorResponse('UNAUTHORIZED');
  }
  const body = BodySchema.safeParse(await readJson(req));
  if (!body.success) return errorResponse('BAD_REQUEST');
  return handleTool(req, body.data, deps);
}

export function handleToolRequest(req: Request, deps: ToolsDeps): Promise<Response> {
  return withErrorBoundary(() => route(req, deps), deps.log);
}
