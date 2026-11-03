// supabase/functions/whatsapp-webhook/handler.ts
// Meta's webhook (ADR-0015).
//   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=… → the challenge (one-off setup)
//   POST signed message events → signature checked on the raw bytes (401 if wrong, nothing read)
//        → 200 straight away → the work continues in the background (EdgeRuntime.waitUntil),
//        so a slow LLM never makes Meta retry.
import { timingSafeEqual } from '@std/crypto/timing-safe-equal';
import { errorResponse, withErrorBoundary } from '../_shared/http.ts';
import type { Logger } from '../_shared/log.ts';
import { type WebhookPayload, WebhookPayloadSchema } from '../_shared/whatsapp/inbound.ts';
import { isValidSignature, SIGNATURE_HEADER } from '../_shared/whatsapp/signature.ts';

export interface WebhookDeps {
  readonly verifyToken: string;
  readonly appSecret: string;
  /** Keeps background work alive after the response (EdgeRuntime.waitUntil in production). */
  readonly defer: (task: Promise<void>) => void;
  readonly process: (payload: WebhookPayload) => Promise<void>;
  readonly log: Logger;
}

const SUBSCRIBE = 'subscribe';

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function sameSecret(provided: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(provided), sha256(expected)]);
  return timingSafeEqual(a, b);
}

async function verify(req: Request, deps: WebhookDeps): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const challenge = params.get('hub.challenge') ?? '';
  const valid = params.get('hub.mode') === SUBSCRIBE &&
    (await sameSecret(params.get('hub.verify_token') ?? '', deps.verifyToken));
  deps.log(valid ? 'info' : 'warn', 'whatsapp_verify', { ok: valid });
  if (!valid) return errorResponse('FORBIDDEN');
  return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
}

function parsePayload(raw: Uint8Array<ArrayBuffer>): WebhookPayload | null {
  try {
    const parsed = WebhookPayloadSchema.safeParse(JSON.parse(new TextDecoder().decode(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null; // Signed but not JSON: answered 400 below.
  }
}

async function receive(req: Request, deps: WebhookDeps): Promise<Response> {
  const raw = new Uint8Array(await req.arrayBuffer());
  if (!(await isValidSignature(raw, req.headers.get(SIGNATURE_HEADER), deps.appSecret))) {
    deps.log('warn', 'whatsapp_bad_signature');
    return errorResponse('UNAUTHORIZED');
  }
  const payload = parsePayload(raw);
  if (!payload) return errorResponse('BAD_REQUEST');
  deps.defer(
    deps.process(payload).catch((error: unknown) => {
      deps.log('error', 'whatsapp_background_failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    }),
  );
  return new Response('EVENT_RECEIVED', { status: 200 });
}

function route(req: Request, deps: WebhookDeps): Promise<Response> {
  if (req.method === 'GET') return verify(req, deps);
  if (req.method === 'POST') return receive(req, deps);
  return Promise.resolve(errorResponse('METHOD_NOT_ALLOWED'));
}

export function handleWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  return withErrorBoundary(() => route(req, deps), deps.log);
}
