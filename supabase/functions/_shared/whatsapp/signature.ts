// supabase/functions/_shared/whatsapp/signature.ts
// Meta signs every webhook POST with the App Secret: header X-Hub-Signature-256 =
// "sha256=<hex HMAC-SHA256 of the raw body>". We check the exact bytes received (re-encoding
// parsed JSON would change them) and compare in constant time, so a fake message cannot pass and
// timing reveals nothing (M4 Decision 9).
import { timingSafeEqual } from '@std/crypto/timing-safe-equal';

export const SIGNATURE_HEADER = 'x-hub-signature-256';
const PREFIX = 'sha256=';
const SHA256_HEX = /^[0-9a-f]{64}$/;

async function hmacSha256(body: Uint8Array<ArrayBuffer>, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(
    { length: hex.length / 2 },
    (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16),
  );
}

/** The header value Meta would send for this body (tests and the smoke script sign with it). */
export async function signBody(body: Uint8Array<ArrayBuffer>, secret: string): Promise<string> {
  return PREFIX + toHex(await hmacSha256(body, secret));
}

export async function isValidSignature(
  body: Uint8Array<ArrayBuffer>,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (header === null || !header.startsWith(PREFIX)) return false;
  const provided = header.slice(PREFIX.length).toLowerCase();
  if (!SHA256_HEX.test(provided)) return false;
  return timingSafeEqual(fromHex(provided), await hmacSha256(body, secret));
}
