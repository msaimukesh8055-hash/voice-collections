// supabase/functions/_shared/audio/ogg.test.ts
// Voice-note length from the Ogg/Opus file (M6).
import { assertEquals } from '@std/assert';
import { oggOpusSeconds } from './ogg.ts';
import { file, opusHead, page } from './__fixtures__/ogg-files.ts';

const TAGS = page(0n, new TextEncoder().encode('OpusTags'));
const AUDIO = new Uint8Array(40).fill(7);

Deno.test('ogg › a 10-second voice note reads as 10 s (pre-skip taken off)', () => {
  const bytes = file(page(0n, opusHead(312)), TAGS, page(240_000n, AUDIO), page(480_312n, AUDIO));
  assertEquals(oggOpusSeconds(bytes), 10);
});

Deno.test('ogg › a 45-second note reads as 45 s', () => {
  const bytes = file(page(0n, opusHead(0)), TAGS, page(2_160_000n, AUDIO));
  assertEquals(oggOpusSeconds(bytes), 45);
});

Deno.test('ogg › rounds to one decimal', () => {
  const bytes = file(page(0n, opusHead(0)), page(100_000n, AUDIO));
  assertEquals(oggOpusSeconds(bytes), 2.1);
});

Deno.test('ogg › not Ogg, Ogg without Opus, or a cut file → null', () => {
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, ...new Uint8Array(40)]);
  const vorbis = file(page(0n, new TextEncoder().encode('\x01vorbis-header-xx')));
  const cut = file(page(0n, opusHead(0))).slice(0, 30);
  assertEquals(oggOpusSeconds(mp3), null);
  assertEquals(oggOpusSeconds(vorbis), null);
  assertEquals(oggOpusSeconds(cut), null);
  assertEquals(oggOpusSeconds(new Uint8Array(3)), null);
});

Deno.test('ogg › a granule smaller than the pre-skip → null', () => {
  const bytes = file(page(0n, opusHead(500)), page(100n, AUDIO));
  assertEquals(oggOpusSeconds(bytes), null);
});
