// supabase/functions/_shared/auth/bearer.test.ts
import { assertEquals } from '@std/assert';
import { hasBearerSecret } from './bearer.ts';

const SECRET = 'w'.repeat(40);

function request(authorization?: string): Request {
  const headers: Record<string, string> = authorization ? { authorization } : {};
  return new Request('https://example.test/fn', { method: 'POST', headers });
}

Deno.test('bearer › the right secret passes, in any case of "Bearer", trimmed', async () => {
  assertEquals(await hasBearerSecret(request(`Bearer ${SECRET}`), SECRET), true);
  assertEquals(await hasBearerSecret(request(`bearer   ${SECRET} `), SECRET), true);
});

Deno.test('bearer › wrong, partial, longer or missing secrets fail', async () => {
  for (const header of [`Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, 'Bearer wrong', SECRET]) {
    assertEquals(await hasBearerSecret(request(header), SECRET), false, header);
  }
  assertEquals(await hasBearerSecret(request(), SECRET), false);
});
