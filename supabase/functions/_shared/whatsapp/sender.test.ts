// supabase/functions/_shared/whatsapp/sender.test.ts
import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { identifySender, maskedHash } from './sender.ts';

// FAKE numbers in the never-real +91 00000 range.
const OWNER = '910000099999';
const STRANGER = '910000011111';
const CONFIG = { ownerNumber: OWNER, hashKey: 'hash-key' };

Deno.test('sender › the owner number is recognised, with or without + and spaces', async () => {
  assertEquals((await identifySender(OWNER, CONFIG)).isOwner, true);
  assertEquals((await identifySender('+91 00000 99999', CONFIG)).isOwner, true);
});

Deno.test('sender › any other number is a stranger', async () => {
  assertEquals((await identifySender(STRANGER, CONFIG)).isOwner, false);
  assertEquals((await identifySender('', CONFIG)).isOwner, false);
});

Deno.test('sender › the hash never contains the number and is stable per number', async () => {
  const first = await identifySender(OWNER, CONFIG);
  const again = await identifySender(`+${OWNER}`, CONFIG);
  const other = await identifySender(STRANGER, CONFIG);
  assertEquals(first.senderHash, again.senderHash);
  assertNotEquals(first.senderHash, other.senderHash);
  assert(!first.senderHash.includes(OWNER) && !first.senderHash.includes('99999'));
});

Deno.test('sender › the hash depends on the key, so a number list cannot be hashed offline', async () => {
  const a = await identifySender(OWNER, CONFIG);
  const b = await identifySender(OWNER, { ...CONFIG, hashKey: 'other-key' });
  assertNotEquals(a.senderHash, b.senderHash);
});

Deno.test('sender › logs get only a short hash prefix', () => {
  assertEquals(maskedHash('abcdef0123456789'), 'abcdef01');
});
