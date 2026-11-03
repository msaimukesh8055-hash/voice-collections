// supabase/functions/_shared/whatsapp/signature.test.ts
import { assertEquals } from '@std/assert';
import { isValidSignature, signBody } from './signature.ts';

const SECRET = 'app-secret-for-tests';
const BODY = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[]}');

Deno.test('signature › a body signed with the app secret passes', async () => {
  const header = await signBody(BODY, SECRET);
  assertEquals(await isValidSignature(BODY, header, SECRET), true);
});

Deno.test('signature › the header is "sha256=" plus 64 hex characters', async () => {
  assertEquals(/^sha256=[0-9a-f]{64}$/.test(await signBody(BODY, SECRET)), true);
});

Deno.test('signature › a missing header fails', async () => {
  assertEquals(await isValidSignature(BODY, null, SECRET), false);
});

Deno.test('signature › a header signed with another secret fails', async () => {
  const header = await signBody(BODY, 'another-secret');
  assertEquals(await isValidSignature(BODY, header, SECRET), false);
});

Deno.test('signature › a body changed after signing fails', async () => {
  const header = await signBody(BODY, SECRET);
  const changed = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[1]}');
  assertEquals(await isValidSignature(changed, header, SECRET), false);
});

Deno.test('signature › malformed headers fail without throwing', async () => {
  const valid = await signBody(BODY, SECRET);
  const malformed = [
    valid.replace('sha256=', 'sha1='),
    valid.slice(0, -2),
    `sha256=${'z'.repeat(64)}`,
    '',
    'sha256=',
  ];
  for (const header of malformed) {
    assertEquals(await isValidSignature(BODY, header, SECRET), false, header);
  }
});

Deno.test('signature › upper-case hex from a proxy is still accepted', async () => {
  const header = await signBody(BODY, SECRET);
  const upper = `sha256=${header.slice('sha256='.length).toUpperCase()}`;
  assertEquals(await isValidSignature(BODY, upper, SECRET), true);
});
