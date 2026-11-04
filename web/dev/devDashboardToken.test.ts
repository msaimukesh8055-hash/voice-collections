// web/dev/devDashboardToken.test.ts
// @vitest-environment node
// The localhost dev token endpoint: same token as the bot's link, loopback only, 404 with no secret.
import { signDashboardToken } from '@shared/auth/dashboard-sign.ts';
import { DEV_TOKEN_PATH, devDashboardToken, devTokenHandler } from './devDashboardToken.ts';

const SECRET = 'a-test-secret-that-is-at-least-32-characters';
const NOW = new Date('2026-11-04T10:00:00Z');
/** Same vector as supabase/functions/_shared/auth/dashboard-link.test.ts (Deno). */
const GOLDEN_TOKEN = '1793872800.xendSZT2ifUmjmKjR5dFwfp051pftvMWrvX60eQfWR8';

interface Sent {
  status: number;
  headers: Map<string, string>;
  body: Record<string, string> | null;
  passedOn: boolean;
}

async function call(
  secret: string | undefined,
  request: { url?: string; method?: string; ip?: string; site?: string } = {},
): Promise<Sent> {
  const sent: Sent = { status: 0, headers: new Map(), body: null, passedOn: false };
  const { url = DEV_TOKEN_PATH, method = 'GET', ip = '127.0.0.1', site } = request;
  await new Promise<void>(function run(resolve) {
    const res = {
      statusCode: 200,
      setHeader(name: string, value: string) {
        sent.headers.set(name, value);
        return this;
      },
      end(body: string) {
        sent.status = res.statusCode;
        sent.body = JSON.parse(body) as Record<string, string>;
        resolve();
        return this;
      },
    };
    const req = {
      url,
      method,
      headers: site ? { 'sec-fetch-site': site } : {},
      socket: { remoteAddress: ip },
    };
    devTokenHandler(secret, () => NOW)(req, res, function next() {
      sent.passedOn = true;
      resolve();
    });
  });
  return sent;
}

describe('dev dashboard token', () => {
  it('signs exactly like the bot: same secret and time give the same token', async () => {
    expect(await signDashboardToken(SECRET, NOW)).toBe(GOLDEN_TOKEN);
    const sent = await call(SECRET, { url: `${DEV_TOKEN_PATH}?x=1` });
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({ token: GOLDEN_TOKEN });
    expect(sent.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers IPv6 loopback and same-origin fetches', async () => {
    expect((await call(SECRET, { ip: '::1', site: 'same-origin' })).status).toBe(200);
    expect((await call(SECRET, { ip: '::ffff:127.0.0.1' })).status).toBe(200);
  });

  it('refuses anyone not on this laptop, and cross-site browser requests', async () => {
    for (const ip of ['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', '']) {
      const sent = await call(SECRET, { ip });
      expect([sent.status, sent.body?.['token']]).toEqual([403, undefined]);
    }
    expect((await call(SECRET, { site: 'cross-site' })).status).toBe(403);
    expect((await call(SECRET, { site: 'same-site' })).status).toBe(403);
  });

  it('is 404 without a secret, 405 for other methods, and ignores other paths', async () => {
    expect(await call(undefined)).toMatchObject({
      status: 404,
      body: { error: expect.any(String) },
    });
    expect((await call(SECRET, { method: 'POST' })).status).toBe(405);
    expect((await call(SECRET, { url: '/' })).passedOn).toBe(true);
  });

  it('is a dev-server-only plugin', () => {
    const plugin = devDashboardToken(SECRET);
    expect(plugin.apply).toBe('serve');
    expect(plugin.configureServer).toBeTypeOf('function');
  });
});
