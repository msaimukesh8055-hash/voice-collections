// supabase/functions/_shared/auth/owner-call-link.ts
// Munshi's single-use link (M8 A2, ADR-0018): the bot sends `<web app>/munshi#t=<token>`, where
// token = "<owner call id>.<HMAC-SHA256 of 'munshi:<id>' with MUNSHI_LINK_SECRET, base64url>".
// Bound to one owner_calls row (unlike the 24-hour dashboard token, which names no one); the row's
// status makes it single-use, and its expiry makes it last 15 minutes. The "munshi:" prefix and
// its own secret mean no dashboard token or other signature can pass for it. After "#", so the
// browser never sends it to the web host and it stays out of server logs.
import { timingSafeEqual } from '@std/crypto/timing-safe-equal';
import { signMessage } from './dashboard-sign.ts';
import { MUNSHI_PATH, OWNER_CALL_TOKEN_PATTERN } from './owner-call-token.ts';

export { MUNSHI_PATH, OWNER_CALL_TOKEN_PATTERN };
const MESSAGE_PREFIX = 'munshi:';

function signatureOf(secret: string, ownerCallId: string): Promise<string> {
  return signMessage(secret, `${MESSAGE_PREFIX}${ownerCallId}`);
}

export async function signOwnerCallToken(secret: string, ownerCallId: string): Promise<string> {
  return `${ownerCallId}.${await signatureOf(secret, ownerCallId)}`;
}

/** The owner call id, only for a token we signed for it; null otherwise. Constant-time compare. */
export async function verifyOwnerCallToken(
  secret: string,
  token: string | null,
): Promise<string | null> {
  const match = OWNER_CALL_TOKEN_PATTERN.exec(token ?? '');
  if (!match) return null;
  const [, ownerCallId = '', given = ''] = match;
  const expected = await signatureOf(secret, ownerCallId);
  const encoder = new TextEncoder();
  return timingSafeEqual(encoder.encode(given), encoder.encode(expected)) ? ownerCallId : null;
}

/** The link the bot sends: the /munshi page reads the token from after "#t=". */
export function munshiLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${MUNSHI_PATH}#t=${token}`;
}
