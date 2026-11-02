// supabase/functions/sarvam-tools/handler.ts
// Asha's tool server (ADR-0012). Sarvam POSTs one flat JSON body per tool call to
// /sarvam-tools/<tool>: { call_token, ...arguments the LLM chose }, with our secret as a bearer
// token. Order matters: secret check → parse → find the call from its token (the LLM never says
// who the shopkeeper is) → run the tool through the registry → audit → reply. Sarvam sends no
// interaction id, so a token is locked by its state instead: accepted on the phone page, one call
// URL per token (calls-api proxy), and a time limit.
import { timingSafeEqual } from '@std/crypto/timing-safe-equal';
import { z } from 'zod';
import { resolveNow } from '../_shared/clock.ts';
import type { CallSession, Repository } from '../_shared/db/repository.ts';
import { errorResponse, jsonResponse, readJson, withErrorBoundary } from '../_shared/http.ts';
import type { Logger } from '../_shared/log.ts';
import { CALL_TOKEN_VARIABLE } from '../_shared/sarvam.ts';
import type { CallStatus } from '../_shared/schemas/shopkeeper.ts';
import {
  AUDIT_MARKERS,
  describeFailure,
  runTool,
  type ToolRun,
} from '../_shared/tools/registry.ts';
import { fail, toReplyBody } from '../_shared/tools/types.ts';

/** Tools work for this long after the call is accepted (Sarvam caps calls at 4 minutes). */
export const CALL_TOKEN_TTL_MS = 10 * 60 * 1000;
const ACTIVE_STATUSES: readonly CallStatus[] = ['accepted', 'in_progress'];
const FUNCTION_PREFIX = '/sarvam-tools/';
const BEARER = /^bearer\s+(.+)$/i;
/** GET /sarvam-tools/warm wakes the function before Asha's first tool call (cold start gave a 503
 * in M3 testing). The phone page calls it when a call starts ringing; it reads and returns nothing. */
export const WARM_PATH = 'warm';

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

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Constant-time comparison; hashing first gives both sides the same length. */
async function hasValidSecret(req: Request, secret: string): Promise<boolean> {
  const provided = BEARER.exec(req.headers.get('authorization') ?? '')?.[1];
  if (provided === undefined) return false;
  const [actual, expected] = await Promise.all([sha256(provided.trim()), sha256(secret)]);
  return timingSafeEqual(actual, expected);
}

/** The tool name comes from our URL (set in the agent config), not from the LLM. */
function toolNameOf(req: Request): string {
  const { pathname } = new URL(req.url);
  const start = pathname.indexOf(FUNCTION_PREFIX);
  return start === -1 ? '' : pathname.slice(start + FUNCTION_PREFIX.length);
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

/** A failed audit write is logged but never changes what the shopkeeper is told: the tool
 * already ran (e.g. a promise was saved), so failing now would invite a duplicate (CP1 H2). */
async function audit(
  event: { callId: string; tool: string; run: ToolRun; durationMs: number },
  deps: ToolsDeps,
): Promise<void> {
  const { callId, tool, run, durationMs } = event;
  try {
    await deps.repo.insertToolEvent({
      callId,
      tool,
      args: run.auditArgs,
      result: run.result,
      durationMs,
    });
  } catch (error) {
    deps.log('error', 'audit_write_failed', { callId, tool, error: describeFailure(error) });
  }
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
  if (auth.session) await audit({ callId: auth.session.callId, tool, run, durationMs: 0 }, deps);
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
  await audit({ callId: auth.session.callId, tool, run, durationMs }, deps);
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
  if (!(await hasValidSecret(req, deps.secret))) {
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
