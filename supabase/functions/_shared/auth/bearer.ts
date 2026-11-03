// supabase/functions/_shared/auth/bearer.ts
// "Authorization: Bearer <secret>" checked in constant time. Used by sarvam-tools (Sarvam's tool
// secret) and followup-worker (WORKER_SECRET from calls-api and, in 5b, pg_cron). Hashing both
// sides first gives them the same length, so the compare leaks neither content nor length.
import { timingSafeEqual } from '@std/crypto/timing-safe-equal';

const BEARER = /^bearer\s+(.+)$/i;

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export async function hasBearerSecret(req: Request, secret: string): Promise<boolean> {
  const provided = BEARER.exec(req.headers.get('authorization') ?? '')?.[1];
  if (provided === undefined) return false;
  const [actual, expected] = await Promise.all([sha256(provided.trim()), sha256(secret)]);
  return timingSafeEqual(actual, expected);
}
