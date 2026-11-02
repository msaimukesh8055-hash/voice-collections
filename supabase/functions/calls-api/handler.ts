// supabase/functions/calls-api/handler.ts
// Dashboard API. POST /v1/calls/authorize is the only way to get a call token: the pre-call
// compliance check runs here, so a blocked call never reaches Vapi with working tools.
// No login in the prototype (M2 Decision 5): it exposes names/language/city only, all fake.
import { z } from 'zod';
import { DAY_MS, istDayLabel, istMidnight, resolveNow } from '../_shared/clock.ts';
import { checkPrecall } from '../_shared/compliance/precall.ts';
import type { Repository } from '../_shared/db/repository.ts';
import { errorResponse, jsonResponse, readJson, withErrorBoundary } from '../_shared/http.ts';
import type { Logger } from '../_shared/log.ts';
import { REGION_HEADER } from '../_shared/region.ts';

const FUNCTION_PREFIX = '/calls-api';
const ATTEMPT_WINDOW_DAYS = 7;
/**
 * Rate limit (CP1 M2): the anon key is public, so a script could mint call tokens in a loop and
 * use up a borrower's daily attempts before the real call. Counted on real time, not the demo
 * clock, and per customer: generous for a person clicking, useless for a loop.
 */
const RATE_LIMIT = { maxCalls: 3, windowMs: 60_000 } as const;

export interface CallsApiDeps {
  readonly repo: Repository;
  readonly clock: () => Date;
  readonly log: Logger;
  readonly allowedOrigins: readonly string[];
}

type RouteHandler = (req: Request, deps: CallsApiDeps, cors: HeadersInit) => Promise<Response>;

const AuthorizeBodySchema = z.object({ customerId: z.uuid() });

function corsHeaders(req: Request, allowedOrigins: readonly string[]): HeadersInit {
  const origin = req.headers.get('origin');
  if (origin === null || !allowedOrigins.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers':
      `authorization, apikey, content-type, x-client-info, ${REGION_HEADER}`,
    vary: 'Origin',
  };
}

/** Supabase serves the function under /calls-api; routes are matched on what follows. */
function routePath(req: Request): string {
  const { pathname } = new URL(req.url);
  const start = pathname.indexOf(FUNCTION_PREFIX);
  return start === -1 ? pathname : pathname.slice(start + FUNCTION_PREFIX.length);
}

async function listCustomers(
  _req: Request,
  deps: CallsApiDeps,
  cors: HeadersInit,
): Promise<Response> {
  return jsonResponse({ customers: await deps.repo.listCustomers() }, 200, cors);
}

async function authorizeCall(
  req: Request,
  deps: CallsApiDeps,
  cors: HeadersInit,
): Promise<Response> {
  const body = AuthorizeBodySchema.safeParse(await readJson(req));
  if (!body.success) return errorResponse('BAD_REQUEST', cors);
  const { customerId } = body.data;

  const settings = await deps.repo.getDemoSettings();
  const now = resolveNow(settings.demoClock, deps.clock());
  const todayStart = istMidnight(now);
  const weekStart = istMidnight(new Date(now.getTime() - (ATTEMPT_WINDOW_DAYS - 1) * DAY_MS));
  const rateWindowStart = new Date(deps.clock().getTime() - RATE_LIMIT.windowMs);
  const [customer, callsToday, callsThisWeek, recentCalls] = await Promise.all([
    deps.repo.getCustomerForCall(customerId),
    deps.repo.countCallsSince(customerId, todayStart),
    deps.repo.countCallsSince(customerId, weekStart),
    deps.repo.countCallsSince(customerId, rateWindowStart),
  ]);
  if (!customer) return errorResponse('NOT_FOUND', cors);
  if (recentCalls >= RATE_LIMIT.maxCalls) {
    deps.log('warn', 'call_rate_limited', { customerId });
    return errorResponse('RATE_LIMITED', cors);
  }

  const decision = checkPrecall({
    now,
    doNotCall: customer.doNotCall,
    callingHoursEnabled: settings.callingHoursEnabled,
    callLimitsEnabled: settings.callLimitsEnabled,
    callsToday,
    callsThisWeek,
  });
  if (!decision.allowed) {
    deps.log('info', 'call_blocked', { customerId, code: decision.code });
    return errorResponse(decision.code, cors);
  }

  const callToken = await deps.repo.createCall({
    customerId,
    language: customer.language,
    attemptNo: callsToday + 1,
  });
  deps.log('info', 'call_authorised', { callId: callToken });
  const authorised = {
    callToken,
    customerName: customer.fullName,
    language: customer.language,
    today: istDayLabel(now),
  };
  return jsonResponse(authorised, 201, cors);
}

const ROUTES: Readonly<Record<string, Readonly<Record<string, RouteHandler>>>> = {
  '/v1/customers': { GET: listCustomers },
  '/v1/calls/authorize': { POST: authorizeCall },
};

async function route(req: Request, deps: CallsApiDeps, cors: HeadersInit): Promise<Response> {
  const methods = ROUTES[routePath(req)];
  if (!methods) return errorResponse('NOT_FOUND', cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const handler = methods[req.method];
  if (!handler) return errorResponse('METHOD_NOT_ALLOWED', cors);
  return await handler(req, deps, cors);
}

export function handleCallsApi(req: Request, deps: CallsApiDeps): Promise<Response> {
  const cors = corsHeaders(req, deps.allowedOrigins);
  return withErrorBoundary(() => route(req, deps, cors), deps.log, cors);
}
