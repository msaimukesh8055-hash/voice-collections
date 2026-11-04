// supabase/functions/calls-api/sarvam-proxy.ts
// The Sarvam SDK's one HTTP request, made on the browser's behalf (M3 Decision 4): the browser
// never holds the Voice Agents key. Guarded so it is not an open proxy: only for a call token
// just accepted on the phone page, only one URL per token, only our own org/workspace/app.
// One token = one Sarvam session = at most one billed call (capped at 4 minutes by Sarvam).
// On top, an always-on daily cap on issued URLs bounds the spend (CP2 M3, ADR-0012).
import { z } from 'zod';
import { istMidnight } from '../_shared/clock.ts';
import type { Repository } from '../_shared/db/repository.ts';
import type { ErrorCode } from '../_shared/errors.ts';
import { errorResponse, jsonResponse } from '../_shared/http.ts';
import type { Logger } from '../_shared/log.ts';
import { CALL_TOKEN_HEADER, SARVAM_RUNTIME_URL } from '../_shared/sarvam.ts';

/** The page asks for the URL right after Accept; a token left unused this long is stale. */
export const CALL_URL_WINDOW_MS = 2 * 60 * 1000;
/**
 * Budget guard (CP2 M3): at most this many Sarvam call URLs (billed live sessions) a day, counted
 * on the real clock from IST midnight. Always on: no demo switch turns it off (like do-not-call).
 * 20 sessions × 4 min × ₹3.50 ≈ ₹280 a day at worst.
 */
export const MAX_LIVE_SESSIONS_PER_DAY = 20;
const UPSTREAM_TIMEOUT_MS = 10_000;
/** Query parameters the SDK sends; anything else is dropped. */
const FORWARDED_QUERY = ['interaction_type', 'version'] as const;

export interface SarvamSettings {
  readonly apiKey: string;
  readonly orgId: string;
  readonly workspaceId: string;
  /** Null until Asha's Sarvam app exists. */
  readonly appId: string | null;
}

export interface ProxyDeps {
  readonly repo: Repository;
  readonly clock: () => Date;
  readonly log: Logger;
  readonly sarvam: SarvamSettings;
  readonly fetchImpl: typeof fetch;
}

/** What the SDK needs; any extra fields Sarvam sends are passed through untouched. */
const SignedUrlSchema = z.looseObject({ url: z.string().min(1), reference_id: z.string().min(1) });

type Refusal =
  | 'bad_target'
  | 'missing_token'
  | 'unknown_token'
  | 'not_accepted'
  | 'stale'
  | 'daily_cap'
  | 'race';

export interface ProxyRequest {
  /** The org, workspace and app ids from the path. */
  readonly params: readonly string[];
  readonly cors?: HeadersInit;
}

function isOwnApp(params: readonly string[], sarvam: SarvamSettings): boolean {
  const [org, workspace, app] = params;
  return org === sarvam.orgId && workspace === sarvam.workspaceId && app === sarvam.appId;
}

function upstreamUrl(req: Request, params: readonly string[]): string {
  const [org, workspace, app] = params.map(encodeURIComponent);
  const target = new URL(
    `${SARVAM_RUNTIME_URL}orgs/${org}/workspaces/${workspace}/apps/${app}/url`,
  );
  const incoming = new URL(req.url).searchParams;
  for (const key of FORWARDED_QUERY) {
    const value = incoming.get(key);
    if (value !== null) target.searchParams.set(key, value);
  }
  return target.toString();
}

/** Marks the call in progress with its URL issued; null when it may not have one. */
async function claimCallUrl(req: Request, deps: ProxyDeps): Promise<Refusal | null> {
  const token = z.uuid().safeParse(req.headers.get(CALL_TOKEN_HEADER));
  if (!token.success) return 'missing_token';
  const session = await deps.repo.getCallSession(token.data);
  if (!session) return 'unknown_token';
  // 'accepted' only: once a URL is issued the call is in_progress, so a second URL is refused.
  if (session.status !== 'accepted' || session.acceptedAt === null) return 'not_accepted';
  const now = deps.clock();
  if (now.getTime() - Date.parse(session.acceptedAt) > CALL_URL_WINDOW_MS) return 'stale';
  // Counted just before the claim; parallel claims can overshoot by at most the few in flight.
  const issuedToday = await deps.repo.countCallUrlsIssuedSince(istMidnight(now));
  if (issuedToday >= MAX_LIVE_SESSIONS_PER_DAY) return 'daily_cap';
  const patch = { status: 'in_progress', urlIssuedAt: now.toISOString() } as const;
  const claimed = await deps.repo.transitionCall(session.callId, ['accepted'], patch);
  return claimed ? null : 'race';
}

type SignedUrl = z.infer<typeof SignedUrlSchema>;

async function fetchSignedUrl(url: string, deps: ProxyDeps): Promise<SignedUrl | ErrorCode> {
  try {
    const upstream = await deps.fetchImpl(url, {
      headers: { 'X-API-Key': deps.sarvam.apiKey },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!upstream.ok) {
      deps.log('warn', 'sarvam_url_failed', { status: upstream.status });
      return 'UPSTREAM_ERROR';
    }
    const body = SignedUrlSchema.safeParse(await upstream.json());
    return body.success ? body.data : 'UPSTREAM_ERROR';
  } catch (error) {
    deps.log('warn', 'sarvam_url_failed', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return 'UPSTREAM_ERROR';
  }
}

/** GET /v1/sarvam/orgs/{org}/workspaces/{ws}/apps/{app}/url — `params` are those three ids. */
export async function proxyCallUrl(
  req: Request,
  deps: ProxyDeps,
  { params, cors = {} }: ProxyRequest,
): Promise<Response> {
  if (deps.sarvam.appId === null) return errorResponse('VOICE_NOT_CONFIGURED', cors);
  const refusal = isOwnApp(params, deps.sarvam) ? await claimCallUrl(req, deps) : 'bad_target';
  if (refusal !== null) {
    deps.log('warn', 'call_url_refused', { reason: refusal });
    return errorResponse(refusal === 'daily_cap' ? 'RATE_LIMITED' : 'FORBIDDEN', cors);
  }
  const result = await fetchSignedUrl(upstreamUrl(req, params), deps);
  return typeof result === 'string' ? errorResponse(result, cors) : jsonResponse(result, 200, cors);
}
