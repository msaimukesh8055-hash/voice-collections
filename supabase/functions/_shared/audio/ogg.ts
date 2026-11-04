// supabase/functions/_shared/audio/ogg.ts
// How long a WhatsApp voice note is, read from the file itself (M6 Decision 10): Meta's webhook
// does not say, and Saaras' quick API is for audio under 30 s. A voice note is Opus sound in an
// Ogg file: the last Ogg page's "granule position" counts 48,000 samples a second, minus the
// "pre-skip" written in the OpusHead header. Anything that is not Ogg/Opus gives null.

const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53]; // "OggS"
const OPUS_HEAD = [0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]; // "OpusHead"
const OPUS_RATE = 48_000;
/** Ogg page header: magic(4) version(1) type(1) granule(8) serial(4) sequence(4) crc(4) count(1). */
const PAGE_HEADER = 27;
const GRANULE_OFFSET = 6;
const PRE_SKIP_OFFSET = 10;

function startsWith(bytes: Uint8Array, at: number, magic: readonly number[]): boolean {
  return magic.every((byte, index) => bytes[at + index] === byte);
}

/** The last page's start. The caller already found one at 0, so the search always ends. */
function lastPageAt(bytes: Uint8Array): number {
  let at = bytes.length - PAGE_HEADER;
  while (at > 0 && !startsWith(bytes, at, OGG_MAGIC)) at -= 1;
  return at;
}

/** Length in seconds (one decimal), or null when the bytes are not an Ogg/Opus file. */
export function oggOpusSeconds(bytes: Uint8Array<ArrayBuffer>): number | null {
  if (bytes.length < PAGE_HEADER || !startsWith(bytes, 0, OGG_MAGIC)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The first packet starts after the first page's segment table.
  const head = PAGE_HEADER + view.getUint8(PAGE_HEADER - 1);
  if (head + PRE_SKIP_OFFSET + 2 > bytes.length || !startsWith(bytes, head, OPUS_HEAD)) return null;
  const preSkip = view.getUint16(head + PRE_SKIP_OFFSET, true);
  const last = lastPageAt(bytes);
  const granule = view.getBigInt64(last + GRANULE_OFFSET, true);
  const samples = Number(granule) - preSkip;
  if (samples < 0) return null;
  return Math.round((samples / OPUS_RATE) * 10) / 10;
}
