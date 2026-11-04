// supabase/functions/_shared/audio/__fixtures__/ogg-files.ts
// Tiny Ogg/Opus files for tests, built page by page in the layout WhatsApp voice notes use.

/** One Ogg page holding one packet (granule = samples at 48 kHz so far). */
export function page(granule: bigint, packet: Uint8Array): Uint8Array {
  const header = new Uint8Array(27 + 1);
  header.set([0x4f, 0x67, 0x67, 0x53], 0);
  new DataView(header.buffer).setBigInt64(6, granule, true);
  header[26] = 1; // one segment
  header[27] = packet.length;
  const out = new Uint8Array(header.length + packet.length);
  out.set(header, 0);
  out.set(packet, header.length);
  return out;
}

export function opusHead(preSkip: number): Uint8Array {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode('OpusHead'), 0);
  head[8] = 1; // version
  head[9] = 1; // channels
  new DataView(head.buffer).setUint16(10, preSkip, true);
  return head;
}

export function file(...pages: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = pages.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of pages) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A voice note of the given length (48,000 samples a second, no pre-skip). */
export function voiceNote(seconds: number): Uint8Array<ArrayBuffer> {
  const audio = new Uint8Array(40).fill(7);
  return file(page(0n, opusHead(0)), page(BigInt(Math.round(seconds * 48_000)), audio));
}
