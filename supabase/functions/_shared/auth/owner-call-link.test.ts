// supabase/functions/_shared/auth/owner-call-link.test.ts
// Munshi's single-use link token (M8 A2, security, 100%): "<owner call id>.<HMAC of munshi:<id>>".
// Only a token we signed, for that exact id, with this secret, passes.
import { assertEquals, assertMatch } from '@std/assert';
import { signMessage } from './dashboard-sign.ts';
import {
  MUNSHI_PATH,
  munshiLink,
  OWNER_CALL_TOKEN_PATTERN,
  signOwnerCallToken,
  verifyOwnerCallToken,
} from './owner-call-link.ts';

const SECRET = 'munshi-link-test-secret-of-32-chars!!';
const OTHER_SECRET = 'another-munshi-secret-of-32-characters';
const ID = 'ca000000-0000-4000-8000-0000000000b1';
const OTHER_ID = 'ca000000-0000-4000-8000-0000000000b2';

Deno.test('owner-call link › a signed token verifies back to its owner call id', async () => {
  const token = await signOwnerCallToken(SECRET, ID);
  assertMatch(token, OWNER_CALL_TOKEN_PATTERN);
  assertEquals(token.startsWith(`${ID}.`), true);
  assertEquals(await verifyOwnerCallToken(SECRET, token), ID);
});

Deno.test('owner-call link › another id with the same signature is refused', async () => {
  const signature = (await signOwnerCallToken(SECRET, ID)).split('.')[1];
  assertEquals(await verifyOwnerCallToken(SECRET, `${OTHER_ID}.${signature}`), null);
});

Deno.test('owner-call link › a changed signature is refused', async () => {
  const token = await signOwnerCallToken(SECRET, ID);
  const last = token.at(-1) === 'A' ? 'B' : 'A';
  assertEquals(await verifyOwnerCallToken(SECRET, `${token.slice(0, -1)}${last}`), null);
});

Deno.test('owner-call link › a token signed with another secret is refused', async () => {
  const token = await signOwnerCallToken(OTHER_SECRET, ID);
  assertEquals(await verifyOwnerCallToken(SECRET, token), null);
});

Deno.test('owner-call link › the dashboard-style signature (no munshi: prefix) is refused', async () => {
  const unprefixed = await signMessage(SECRET, ID);
  assertEquals(await verifyOwnerCallToken(SECRET, `${ID}.${unprefixed}`), null);
  const otherPrefix = await signMessage(SECRET, `v1.${ID}`);
  assertEquals(await verifyOwnerCallToken(SECRET, `${ID}.${otherPrefix}`), null);
});

Deno.test('owner-call link › empty, missing, malformed or extra-dot tokens are refused', async () => {
  const token = await signOwnerCallToken(SECRET, ID);
  for (
    const bad of [
      null,
      '',
      ID,
      `${ID}.`,
      `.${token.split('.')[1]}`,
      `${token}.extra`,
      `x.${token}`,
      `not-a-uuid.${token.split('.')[1]}`,
      ` ${token}`,
      `${token.toUpperCase()}`,
    ]
  ) {
    assertEquals(await verifyOwnerCallToken(SECRET, bad), null, String(bad));
  }
});

Deno.test('owner-call link › the link puts the token after #t= on /munshi', async () => {
  const token = await signOwnerCallToken(SECRET, ID);
  assertEquals(
    munshiLink('https://app.example/', token),
    `https://app.example${MUNSHI_PATH}#t=${token}`,
  );
  assertEquals(munshiLink('https://app.example', token), `https://app.example/munshi#t=${token}`);
});

Deno.test('owner-call link › every one-character change of the signature is refused', async () => {
  const token = await signOwnerCallToken(SECRET, ID);
  const [id = '', signature = ''] = token.split('.');
  for (let index = 0; index < signature.length; index += 1) {
    const swapped = signature[index] === 'A' ? 'B' : 'A';
    const changed = `${signature.slice(0, index)}${swapped}${signature.slice(index + 1)}`;
    assertEquals(await verifyOwnerCallToken(SECRET, `${id}.${changed}`), null, String(index));
  }
});
