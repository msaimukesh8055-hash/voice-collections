// supabase/functions/_shared/whatsapp/sender.ts
// Who sent a message (M4 Decision 6). The owner's number lives only in a function secret; it is
// compared in constant time and never logged or stored. Rows keep a keyed hash (HMAC-SHA256 with
// the App Secret): a plain hash of a phone number could be reversed by hashing every number.
import { timingSafeEqual } from '@std/crypto/timing-safe-equal';

const LOG_HASH_LENGTH = 8;

export interface SenderConfig {
  /** Digits only, with the country code (as Meta sends `from`). */
  readonly ownerNumber: string;
  readonly hashKey: string;
}

export interface Sender {
  readonly isOwner: boolean;
  /** Hex HMAC of the digits; safe for database rows. */
  readonly senderHash: string;
}

export function phoneDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function hmacHex(value: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value));
  return toHex(new Uint8Array(signature));
}

export async function identifySender(from: string, config: SenderConfig): Promise<Sender> {
  const digits = phoneDigits(from);
  // Hashing first gives both sides the same length for the constant-time compare.
  const [actual, expected, senderHash] = await Promise.all([
    sha256(digits),
    sha256(phoneDigits(config.ownerNumber)),
    hmacHex(digits, config.hashKey),
  ]);
  const isOwner = digits.length > 0 && timingSafeEqual(actual, expected);
  return { isOwner, senderHash };
}

/** For logs: enough to tell senders apart, nothing more. */
export function maskedHash(senderHash: string): string {
  return senderHash.slice(0, LOG_HASH_LENGTH);
}
