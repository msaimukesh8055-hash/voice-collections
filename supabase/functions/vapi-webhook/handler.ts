// supabase/functions/vapi-webhook/handler.ts
// Vapi server URL. Order matters: secret check → parse → resolve the call from its token (the LLM
// never says who the customer is) → run each tool through the registry → audit → reply.
import { timingSafeEqual } from '@std/crypto/timing-safe-equal';
import { z } from 'zod';
import { resolveNow } from '../_shared/clock.ts';
import type { CallSession, Repository } from '../_shared/db/repository.ts';
import { errorResponse, jsonResponse, readJson, withErrorBoundary } from '../_shared/http.ts';
import type { Logger } from '../_shared/log.ts';
import { runTool } from '../_shared/tools/registry.ts';
import { fail, type ToolResult } from '../_shared/tools/types.ts';
import { VAPI_SECRET_HEADER } from '../_shared/vapi.ts';

/** A token must be used within this window after authorisation (calls are capped at 2 minutes). */
export const CALL_TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_TOOL_CALLS_PER_REQUEST = 10;
const SENSITIVE_ARG_KEYS: readonly string[] = ['dob'];

export interface WebhookDeps {
  readonly repo: Repository;
  readonly secret: string;
  readonly clock: () => Date;
  readonly log: Logger;
}

const EnvelopeSchema = z.object({ message: z.looseObject({ type: z.string() }) });

const TokenHolder = z.object({ callToken: z.unknown() }).partial();

const ToolCallsMessageSchema = z.object({
  type: z.literal('tool-calls'),
  call: z.object({
    id: z.string().min(1).max(100),
    metadata: TokenHolder.optional(),
    assistantOverrides: z.object({ metadata: TokenHolder.optional() }).optional(),
  }),
  toolCallList: z
    .array(
      z.object({
        id: z.string().min(1),
        function: z.object({ name: z.string(), arguments: z.unknown().optional() }),
      }),
    )
    .min(1)
    .max(MAX_TOOL_CALLS_PER_REQUEST),
});

type ToolCallsMessage = z.infer<typeof ToolCallsMessageSchema>;
type ToolCall = ToolCallsMessage['toolCallList'][number];

interface VapiToolResult {
  readonly toolCallId: string;
  readonly result: string;
}

type Authorisation =
  | { readonly ok: true; readonly session: CallSession; readonly now: Date }
  | {
    readonly ok: false;
    readonly reason:
      | 'missing_token'
      | 'unknown_token'
      | 'token_in_use'
      | 'token_expired'
      | 'claim_lost';
  };

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Constant-time comparison; hashing first gives both sides the same length. */
async function hasValidSecret(req: Request, secret: string): Promise<boolean> {
  const provided = req.headers.get(VAPI_SECRET_HEADER);
  if (provided === null) return false;
  const [actual, expected] = await Promise.all([sha256(provided), sha256(secret)]);
  return timingSafeEqual(actual, expected);
}

/** The browser passes the token as call metadata; Vapi reports it under either location. */
function callTokenOf(call: ToolCallsMessage['call']): string | null {
  const raw = call.assistantOverrides?.metadata?.callToken ?? call.metadata?.callToken;
  const parsed = z.uuid().safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function isExpired(session: CallSession, realNow: Date): boolean {
  return realNow.getTime() - Date.parse(session.authorizedAt) > CALL_TOKEN_TTL_MS;
}

async function authoriseCall(message: ToolCallsMessage, deps: WebhookDeps): Promise<Authorisation> {
  const token = callTokenOf(message.call);
  if (token === null) return { ok: false, reason: 'missing_token' };
  // Parallel reads: one round trip of latency.
  const [session, settings] = await Promise.all([
    deps.repo.getCallSession(token),
    deps.repo.getDemoSettings(),
  ]);
  if (!session) return { ok: false, reason: 'unknown_token' };
  const now = resolveNow(settings.demoClock, deps.clock());
  if (session.vapiCallId === message.call.id) return { ok: true, session, now };
  if (session.vapiCallId !== null) return { ok: false, reason: 'token_in_use' };
  if (isExpired(session, deps.clock())) return { ok: false, reason: 'token_expired' };
  const claimed = await deps.repo.claimCall(session.callId, message.call.id);
  if (!claimed) return { ok: false, reason: 'claim_lost' };
  return { ok: true, session: { ...session, vapiCallId: message.call.id }, now };
}

/** Vapi usually sends an object; some providers send a JSON string. */
function parseArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // Left as a string so schema validation reports INVALID_ARGS to the LLM.
  }
}

function redact(args: unknown): unknown {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return args;
  return Object.fromEntries(
    Object.entries(args).map((
      [key, value],
    ) => [key, SENSITIVE_ARG_KEYS.includes(key) ? '[redacted]' : value]),
  );
}

function toVapiResult(toolCall: ToolCall, result: ToolResult): VapiToolResult {
  return { toolCallId: toolCall.id, result: JSON.stringify(result) };
}

async function runToolCalls(
  message: ToolCallsMessage,
  auth: Extract<Authorisation, { ok: true }>,
  deps: WebhookDeps,
): Promise<VapiToolResult[]> {
  let session = auth.session;
  const results: VapiToolResult[] = [];
  // Sequential on purpose: a later call may depend on an earlier one (verify, then lookup).
  for (const toolCall of message.toolCallList) {
    const started = Date.now();
    const args = parseArguments(toolCall.function.arguments);
    const outcome = await runTool(toolCall.function.name, args, {
      repo: deps.repo,
      session,
      now: auth.now,
    });
    session = outcome.session ?? session;
    await deps.repo.insertToolEvent({
      callId: session.callId,
      tool: toolCall.function.name,
      args: redact(args),
      result: outcome.result,
    });
    deps.log('info', 'tool_call', {
      callId: session.callId,
      tool: toolCall.function.name,
      ok: outcome.result.ok,
      code: outcome.result.ok ? null : outcome.result.code,
      ms: Date.now() - started,
    });
    results.push(toVapiResult(toolCall, outcome.result));
  }
  return results;
}

async function handleToolCalls(message: ToolCallsMessage, deps: WebhookDeps): Promise<Response> {
  const auth = await authoriseCall(message, deps);
  if (!auth.ok) {
    deps.log('warn', 'call_not_authorised', { reason: auth.reason, vapiCallId: message.call.id });
    const refusal = fail('CALL_NOT_AUTHORISED').result;
    return jsonResponse({
      results: message.toolCallList.map((toolCall) => toVapiResult(toolCall, refusal)),
    });
  }
  return jsonResponse({ results: await runToolCalls(message, auth, deps) });
}

async function route(req: Request, deps: WebhookDeps): Promise<Response> {
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED');
  if (!(await hasValidSecret(req, deps.secret))) {
    deps.log('warn', 'webhook_unauthorised');
    return errorResponse('UNAUTHORIZED');
  }
  const envelope = EnvelopeSchema.safeParse(await readJson(req));
  if (!envelope.success) return errorResponse('BAD_REQUEST');
  // Only tool calls are handled in M2; end-of-call reports arrive in M4.
  if (envelope.data.message.type !== 'tool-calls') return jsonResponse({});
  const message = ToolCallsMessageSchema.safeParse(envelope.data.message);
  if (!message.success) return errorResponse('BAD_REQUEST');
  return handleToolCalls(message.data, deps);
}

export function handleWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  return withErrorBoundary(() => route(req, deps), deps.log);
}
