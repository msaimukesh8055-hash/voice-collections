// supabase/functions/calls-api/sarvam-proxy.ts
// The Sarvam SDK's one HTTP request, made on the browser's behalf (M3 Decision 4): the browser
// never holds the Voice Agents key. Guarded so it is not an open proxy: only for a call token
// just accepted on the phone page, only one URL per token, only our own org/workspace/app.
// One token = one Sarvam session = at most one billed call (capped at 4 minutes by Sarvam).
// On top, an always-on daily cap on issued URLs bounds the spend (CP2 M3, ADR-0012).
// M8 (ADR-0018): the app id picks the session table. Asha's app takes a shopkeeper call token
// (`calls`); Munshi's app takes a signed owner-call token (`owner_calls`). Neither token works for
// the other app. The daily cap counts both tables, with at most 6 Munshi sessions inside it.
import { z } from 'zod';
import { verifyOwnerCallToken } from '../_shared/auth/owner-call-link.ts';
import { MAX_MUNSHI_SESSIONS_PER_DAY } from '../_shared/calls/owner-call-limits.ts';
import { istMidnight } from '../_shared/clock.ts';
import type { OwnerCallRepository } from '../_shared/db/owner-call-repository.ts';
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
 * 20 sessions × 4 min × ₹3.50 ≈ ₹280 a day at worst. Since M8 it counts Asha and Munshi together.
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
  /** Null until Munshi's Sarvam app exists (M8). */
  readonly munshiAppId: string | null;
}

/** Munshi's side of the line (M8): owner call rows and the link secret (null = not set up). */
export interface MunshiLine {
  readonly ownerCalls: OwnerCallRepository;
  readonly linkSecret: string | null;
}

export interface ProxyDeps {
  readonly repo: Repository;
  readonly clock: () => Date;
  readonly log: Logger;
  readonly sarvam: SarvamSettings;
  readonly fetchImpl: typeof fetch;
  readonly munshi: MunshiLine;
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

type Target = 'asha' | 'munshi';

/** Which of our two agents the path names; null for anything else (another org, workspace or
 * app, or an agent that is not set up yet). */
function targetOf(params: readonly string[], sarvam: SarvamSettings): Target | null {
  const [org, workspace, app] = params;
  if (org !== sarvam.orgId || workspace !== sarvam.workspaceId || app === undefined) return null;
  if (app === sarvam.appId) return 'asha';
  return app === sarvam.munshiAppId ? 'munshi' : null;
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

interface SessionCounts {
  readonly all: number;
  readonly munshi: number;
}

/** Sessions issued today (real clock, IST midnight), Asha's and Munshi's, in one round trip.
 * Counted just before the claim; parallel claims can overshoot by at most the few in flight. */
async function sessionsToday(deps: ProxyDeps, now: Date): Promise<SessionCounts> {
  const since = istMidnight(now);
  const [calls, munshi] = await Promise.all([
    deps.repo.countCallUrlsIssuedSince(since),
    deps.munshi.ownerCalls.countOwnerUrlsIssuedSince(since),
  ]);
  return { all: calls + munshi, munshi };
}

/** 'accepted' only: once a URL is issued the call is in_progress, so a second URL is refused. */
function acceptedRefusal(
  row: { readonly status: string; readonly acceptedAt: string | null },
  now: Date,
): Refusal | null {
  if (row.status !== 'accepted' || row.acceptedAt === null) return 'not_accepted';
  return now.getTime() - Date.parse(row.acceptedAt) > CALL_URL_WINDOW_MS ? 'stale' : null;
}

/** Asha: marks the shopkeeper call in progress with its URL issued; null when it may have one. */
async function claimCallUrl(req: Request, deps: ProxyDeps): Promise<Refusal | null> {
  const token = z.uuid().safeParse(req.headers.get(CALL_TOKEN_HEADER));
  if (!token.success) return 'missing_token';
  const session = await deps.repo.getCallSession(token.data);
  if (!session) return 'unknown_token';
  const now = deps.clock();
  const refusal = acceptedRefusal(session, now);
  if (refusal) return refusal;
  if ((await sessionsToday(deps, now)).all >= MAX_LIVE_SESSIONS_PER_DAY) return 'daily_cap';
  const patch = { status: 'in_progress', urlIssuedAt: now.toISOString() } as const;
  const claimed = await deps.repo.transitionCall(session.callId, ['accepted'], patch);
  return claimed ? null : 'race';
}

function isOverMunshiCap(sessions: SessionCounts): boolean {
  return sessions.all >= MAX_LIVE_SESSIONS_PER_DAY ||
    sessions.munshi >= MAX_MUNSHI_SESSIONS_PER_DAY;
}

/** Munshi (M8): the same rules, on the owner call named by a signed link token. */
async function claimOwnerCallUrl(req: Request, deps: ProxyDeps): Promise<Refusal | null> {
  const { linkSecret, ownerCalls } = deps.munshi;
  if (linkSecret === null) return 'missing_token';
  const ownerCallId = await verifyOwnerCallToken(linkSecret, req.headers.get(CALL_TOKEN_HEADER));
  if (ownerCallId === null) return 'missing_token';
  const call = await ownerCalls.getOwnerCall(ownerCallId);
  if (!call) return 'unknown_token';
  const now = deps.clock();
  const refusal = acceptedRefusal(call, now);
  if (refusal) return refusal;
  if (isOverMunshiCap(await sessionsToday(deps, now))) return 'daily_cap';
  const patch = { status: 'in_progress', urlIssuedAt: now.toISOString() } as const;
  return (await ownerCalls.transitionOwnerCall(call.id, ['accepted'], patch)) ? null : 'race';
}

type Claim = (req: Request, deps: ProxyDeps) => Promise<Refusal | null>;
const CLAIMS: Readonly<Record<Target, Claim>> = { asha: claimCallUrl, munshi: claimOwnerCallUrl };

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
  const { appId, munshiAppId } = deps.sarvam;
  if (appId === null && munshiAppId === null) return errorResponse('VOICE_NOT_CONFIGURED', cors);
  const target = targetOf(params, deps.sarvam);
  const refusal = target === null ? 'bad_target' : await CLAIMS[target](req, deps);
  if (refusal !== null) {
    deps.log('warn', 'call_url_refused', { reason: refusal, target });
    return errorResponse(refusal === 'daily_cap' ? 'RATE_LIMITED' : 'FORBIDDEN', cors);
  }
  const result = await fetchSignedUrl(upstreamUrl(req, params), deps);
  return typeof result === 'string' ? errorResponse(result, cors) : jsonResponse(result, 200, cors);
}
