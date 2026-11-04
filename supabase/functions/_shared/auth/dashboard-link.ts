// supabase/functions/_shared/auth/dashboard-link.ts
// The dashboard's short-lived link (SPEC §12, M6 Decision 9). The bot sends the owner
// `<DASHBOARD_URL>/#t=<token>`; the page sends the token back on every read. A token is
// "<expiry, unix seconds>.<HMAC-SHA256 of it with DASHBOARD_LINK_SECRET, base64url>": nobody without
// the secret can make one or move its expiry. It sits after "#", so browsers don't send it to the
// web host and it stays out of server logs. One owner in the prototype, so the token names no one.
import { timingSafeEqual } from '@std/crypto/timing-safe-equal';

export { DASHBOARD_TOKEN_HEADER } from './dashboard-header.ts';
export const DASHBOARD_LINK_TTL_MS = 24 * 60 * 60 * 1000;
const VERSION = 'v1';
const TOKEN = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(signature);
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(
    /=+$/,
    '',
  );
}

export async function signDashboardToken(secret: string, now: Date): Promise<string> {
  const expires = Math.floor((now.getTime() + DASHBOARD_LINK_TTL_MS) / 1000);
  return `${expires}.${base64url(await hmac(secret, `${VERSION}.${expires}`))}`;
}

/** The link the bot sends: the page reads the token from after "#t=". */
export async function dashboardLink(baseUrl: string, secret: string, now: Date): Promise<string> {
  const token = await signDashboardToken(secret, now);
  return `${baseUrl.replace(/\/+$/, '')}/#t=${token}`;
}

/** True only for a token we signed that has not expired. Constant-time signature compare. */
export async function isValidDashboardToken(
  token: string | null,
  secret: string,
  now: Date,
): Promise<boolean> {
  const match = TOKEN.exec(token ?? '');
  if (!match) return false;
  const [, expires = '', given = ''] = match;
  const expected = base64url(await hmac(secret, `${VERSION}.${expires}`));
  const encoder = new TextEncoder();
  const same = timingSafeEqual(encoder.encode(given), encoder.encode(expected));
  return same && Number(expires) * 1000 > now.getTime();
}
