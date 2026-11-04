// supabase/functions/calls-api/handler.ts
// App API for the dashboard and the borrower phone page (SPEC §16: calls-api → app API).
// No login in the prototype (fake data; known gap): the anon key gets the request past Supabase,
// and every call action is bound to a one-time call token and its status.
import { errorResponse, withErrorBoundary } from '../_shared/http.ts';
import { REGION_HEADER } from '../_shared/region.ts';
import { CALL_TOKEN_HEADER } from '../_shared/sarvam.ts';
import { DASHBOARD_TOKEN_HEADER } from '../_shared/auth/dashboard-link.ts';
import { DASHBOARD_ROUTES } from './dashboard-routes.ts';
import { getDemo, ringLiveShopkeeper } from './demo-routes.ts';
import { acceptCall, declineCall, endCall, getIncomingCall } from './phone-routes.ts';
import { proxyCallUrl } from './sarvam-proxy.ts';
import type { CallsApiDeps, RouteContext, RouteHandler } from './types.ts';

const FUNCTION_PREFIX = '/calls-api';

interface Route {
  readonly pattern: RegExp;
  readonly methods: Readonly<Partial<Record<string, RouteHandler>>>;
}

function proxyRoute(req: Request, ctx: RouteContext): Promise<Response> {
  return proxyCallUrl(req, ctx.deps, { params: ctx.params, cors: ctx.cors });
}

/** Typed lookup table (no switch ladder). Capture groups become `params`. */
const ROUTES: readonly Route[] = [
  { pattern: /^\/v1\/demo$/, methods: { GET: getDemo } },
  { pattern: /^\/v1\/demo\/ring$/, methods: { POST: ringLiveShopkeeper } },
  { pattern: /^\/v1\/phone\/incoming$/, methods: { GET: getIncomingCall } },
  { pattern: /^\/v1\/calls\/([^/]+)\/accept$/, methods: { POST: acceptCall } },
  { pattern: /^\/v1\/calls\/([^/]+)\/decline$/, methods: { POST: declineCall } },
  { pattern: /^\/v1\/calls\/([^/]+)\/ended$/, methods: { POST: endCall } },
  // M6: the web dashboard, behind the signed link.
  { pattern: /^\/v1\/dashboard\/overview$/, methods: { GET: DASHBOARD_ROUTES.overview } },
  { pattern: /^\/v1\/dashboard\/shopkeepers$/, methods: { GET: DASHBOARD_ROUTES.shopkeepers } },
  {
    pattern: /^\/v1\/dashboard\/shopkeepers\/([^/]+)$/,
    methods: { GET: DASHBOARD_ROUTES.shopkeeper },
  },
  { pattern: /^\/v1\/dashboard\/calls$/, methods: { GET: DASHBOARD_ROUTES.calls } },
  { pattern: /^\/v1\/dashboard\/calls\/([^/]+)$/, methods: { GET: DASHBOARD_ROUTES.call } },
  { pattern: /^\/v1\/dashboard\/settings$/, methods: { POST: DASHBOARD_ROUTES.settings } },
  {
    pattern: /^\/v1\/sarvam\/orgs\/([^/]+)\/workspaces\/([^/]+)\/apps\/([^/]+)\/url$/,
    methods: { GET: proxyRoute },
  },
];

function corsHeaders(req: Request, allowedOrigins: readonly string[]): HeadersInit {
  const origin = req.headers.get('origin');
  if (origin === null || !allowedOrigins.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    // x-api-key: the Sarvam SDK always sends it (empty); the real key is added server-side.
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, ' +
      `${REGION_HEADER}, ${CALL_TOKEN_HEADER}, x-api-key, ${DASHBOARD_TOKEN_HEADER}`,
    vary: 'Origin',
  };
}

/** Supabase serves the function under /calls-api; routes are matched on what follows. */
function routePath(req: Request): string {
  const { pathname } = new URL(req.url);
  const start = pathname.indexOf(FUNCTION_PREFIX);
  return start === -1 ? pathname : pathname.slice(start + FUNCTION_PREFIX.length);
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment; // Malformed escapes stay as they are; validation downstream rejects them.
  }
}

function matchRoute(path: string): { route: Route; params: readonly string[] } | null {
  for (const route of ROUTES) {
    const match = route.pattern.exec(path);
    if (match) return { route, params: match.slice(1).map(safeDecode) };
  }
  return null;
}

async function route(req: Request, deps: CallsApiDeps, cors: HeadersInit): Promise<Response> {
  const matched = matchRoute(routePath(req));
  if (!matched) return errorResponse('NOT_FOUND', cors);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const handler = matched.route.methods[req.method];
  if (!handler) return errorResponse('METHOD_NOT_ALLOWED', cors);
  return await handler(req, { deps, cors, params: matched.params });
}

export function handleCallsApi(req: Request, deps: CallsApiDeps): Promise<Response> {
  const cors = corsHeaders(req, deps.allowedOrigins);
  return withErrorBoundary(() => route(req, deps, cors), deps.log, cors);
}
