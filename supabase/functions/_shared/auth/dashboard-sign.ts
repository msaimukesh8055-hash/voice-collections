// supabase/functions/_shared/auth/dashboard-sign.ts
// Signs the dashboard link token (M6 Decision 9). Split out of dashboard-link.ts with no Deno-only
// imports, only Web Crypto, so the exact same code also runs in Node: the web dev server uses it
// to hand localhost a token (ADR-0017 addendum). Checking a token stays in dashboard-link.ts.

export const DASHBOARD_LINK_TTL_MS = 24 * 60 * 60 * 1000;
const VERSION = 'v1';

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

/** The HMAC of one expiry, as it appears after the "." in a token. */
export function signatureFor(secret: string, expires: string): Promise<string> {
  return hmac(secret, `${VERSION}.${expires}`).then(base64url);
}

/** "<expiry, unix seconds>.<signature>", valid for 24 hours from `now`. */
export async function signDashboardToken(secret: string, now: Date): Promise<string> {
  const expires = String(Math.floor((now.getTime() + DASHBOARD_LINK_TTL_MS) / 1000));
  return `${expires}.${await signatureFor(secret, expires)}`;
}
