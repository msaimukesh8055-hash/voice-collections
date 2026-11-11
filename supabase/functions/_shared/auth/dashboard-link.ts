// supabase/functions/_shared/auth/dashboard-link.ts
// The dashboard's short-lived link (SPEC §12, M6 Decision 9). The bot sends the owner
// `<DASHBOARD_URL>/#t=<token>`; the page sends the token back on every read. A token is
// "<expiry, unix seconds>.<HMAC-SHA256 of it with DASHBOARD_LINK_SECRET, base64url>": nobody without
// the secret can make one or move its expiry. It sits after "#", so browsers don't send it to the
// web host and it stays out of server logs. One owner in the prototype, so the token names no one.
import { timingSafeEqual } from '@std/crypto/timing-safe-equal';
import { signatureFor, signDashboardToken } from './dashboard-sign.ts';

export { DASHBOARD_TOKEN_HEADER } from './dashboard-header.ts';
export { DASHBOARD_LINK_TTL_MS, signDashboardToken } from './dashboard-sign.ts';
const TOKEN = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

/** The link the bot sends: the page reads the token from after "#t=". */
export async function dashboardLink(baseUrl: string, secret: string, now: Date): Promise<string> {
  const token = await signDashboardToken(secret, now);
  return `${baseUrl.replace(/\/+$/, '')}/#t=${token}`;
}

/** Dry-run fix 8: a link that opens one call's page (transcript, tool events, follow-up):
 * `<DASHBOARD_URL>/calls?id=<call id>#t=<token>`, the same 24-hour token as the dashboard link. */
export async function callLink(
  baseUrl: string,
  secret: string,
  call: { readonly callId: string; readonly now: Date },
): Promise<string> {
  const token = await signDashboardToken(secret, call.now);
  const id = encodeURIComponent(call.callId);
  return `${baseUrl.replace(/\/+$/, '')}/calls?id=${id}#t=${token}`;
}

/** Reply links (cloud build): a link that opens one customer's page in the books (their entries,
 * score, calls): `<DASHBOARD_URL>/shopkeepers?id=<shopkeeper id>#t=<token>`, the same 24-hour
 * token as the dashboard link. */
export async function shopkeeperLink(
  baseUrl: string,
  secret: string,
  shopkeeper: { readonly shopkeeperId: string; readonly now: Date },
): Promise<string> {
  const token = await signDashboardToken(secret, shopkeeper.now);
  const id = encodeURIComponent(shopkeeper.shopkeeperId);
  return `${baseUrl.replace(/\/+$/, '')}/shopkeepers?id=${id}#t=${token}`;
}

/** M9: a link that opens one trace on the ops page: `<DASHBOARD_URL>/ops?id=<trace id>#t=<token>`,
 * the same 24-hour token as the dashboard link. */
export async function traceLink(
  baseUrl: string,
  secret: string,
  trace: { readonly traceId: string; readonly now: Date },
): Promise<string> {
  const token = await signDashboardToken(secret, trace.now);
  const id = encodeURIComponent(trace.traceId);
  return `${baseUrl.replace(/\/+$/, '')}/ops?id=${id}#t=${token}`;
}

/** Reply links (cloud build): the phone page where Ramesh answers Asha's call. No token: the
 * phone page is public and shows no book data. */
export function phonePageLink(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/phone`;
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
  const expected = await signatureFor(secret, expires);
  const encoder = new TextEncoder();
  const same = timingSafeEqual(encoder.encode(given), encoder.encode(expected));
  return same && Number(expires) * 1000 > now.getTime();
}
