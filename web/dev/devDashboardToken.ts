// web/dev/devDashboardToken.ts
// Localhost-only convenience (ADR-0017 addendum): while `vite` serves the dashboard on this
// laptop, GET /__dev/dashboard-token hands the page a fresh 24-hour dashboard token, so it opens
// with data without the WhatsApp link. It is a dev-server plugin only (`apply: 'serve'`), so it
// does not exist in `vite build` or `vite preview`. The server-side token check is unchanged: the
// token is signed with the real DASHBOARD_LINK_SECRET by the same code the bot uses.
// Guards: loopback callers only; no secret → 404 and the page behaves as before. Vite's own CORS
// (localhost origins only) and host check (blocks DNS rebinding) run before this middleware.
import type { Plugin } from 'vite';
import { signDashboardToken } from '../../supabase/functions/_shared/auth/dashboard-sign.ts';

export const DEV_TOKEN_PATH = '/__dev/dashboard-token';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The parts of Node's request and response this uses (so tests need no real server). */
interface Request {
  readonly url?: string | undefined;
  readonly method?: string | undefined;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly socket: { readonly remoteAddress?: string | undefined };
}
interface Response {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body: string): unknown;
}
type Next = () => void;

function reply(res: Response, status: number, body: Record<string, string>): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** A browser on another site says so in Sec-Fetch-Site; only this page itself is served. */
function isCrossSite(req: Request): boolean {
  const site = req.headers['sec-fetch-site'];
  return site !== undefined && site !== 'same-origin' && site !== 'none';
}

export function devTokenHandler(
  secret: string | undefined,
  now: () => Date,
): (req: Request, res: Response, next: Next) => void {
  return function handleDevToken(req, res, next) {
    if ((req.url ?? '').split('?')[0] !== DEV_TOKEN_PATH) return next();
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '') || isCrossSite(req)) {
      return reply(res, 403, { error: 'localhost only' });
    }
    if (req.method !== 'GET') return reply(res, 405, { error: 'GET only' });
    if (!secret) return reply(res, 404, { error: 'no DASHBOARD_LINK_SECRET' });
    signDashboardToken(secret, now()).then(
      function sendToken(token) {
        reply(res, 200, { token });
      },
      function sendError() {
        reply(res, 500, { error: 'could not sign' });
      },
    );
  };
}

/** Add to `plugins`; `secret` comes from the repo-root .env via loadEnv (never a VITE_ var). */
export function devDashboardToken(secret: string | undefined): Plugin {
  return {
    name: 'dev-dashboard-token',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(devTokenHandler(secret?.trim() || undefined, () => new Date()));
    },
  };
}
