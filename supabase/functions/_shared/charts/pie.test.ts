// supabase/functions/_shared/charts/pie.test.ts
// The insights ring chart PNG (M6 Decision 8): slice maths, colours at known points, and a
// valid PNG (signature, header, checksums, pixels read back after decompressing).
import { assert, assertEquals } from '@std/assert';
import { arcsOf, BACKGROUND, colourAt, crc32, piePng, SLICE_COLOURS } from './pie.ts';

const GREEN = SLICE_COLOURS.collected.rgb;
const BLUE = SLICE_COLOURS.notYetDue.rgb;
const ORANGE = SLICE_COLOURS.overdue.rgb;

Deno.test('pie › slice ends add up to the whole ring; zero slices are skipped', () => {
  const arcs = arcsOf([
    { value: 3000, rgb: GREEN },
    { value: 0, rgb: BLUE },
    { value: 1000, rgb: ORANGE },
  ]);
  assertEquals(arcs, [{ end: 0.75, rgb: GREEN }, { end: 1, rgb: ORANGE }]);
  assertEquals(arcsOf([{ value: 0, rgb: GREEN }]), []);
});

Deno.test("pie › colours: clockwise from 12 o'clock, background outside and in the hole", () => {
  const arcs = arcsOf([
    { value: 1, rgb: GREEN },
    { value: 1, rgb: BLUE },
    { value: 2, rgb: ORANGE },
  ]);
  const ring = 0.36; // between the inner (0.27) and outer (0.46) radius
  assertEquals(colourAt(0.5 + ring * 0.7, 0.5 - ring * 0.7, arcs), GREEN); // 1:30
  assertEquals(colourAt(0.5 + ring * 0.7, 0.5 + ring * 0.7, arcs), BLUE); // 4:30
  assertEquals(colourAt(0.5 - ring, 0.5, arcs), ORANGE); // 9 o'clock
  assertEquals(colourAt(0.5, 0.5, arcs), BACKGROUND); // the hole
  assertEquals(colourAt(0.01, 0.01, arcs), BACKGROUND); // a corner
  assertEquals(colourAt(0.5, 0.15, []), BACKGROUND); // nothing to draw
});

Deno.test('pie › crc32 matches the standard check value', () => {
  assertEquals(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

Deno.test('pie › a valid PNG: signature, size, checksums, and the pixels read back', async () => {
  const size = 40;
  const png = await piePng([{ value: 1, rgb: GREEN }], size);
  assertEquals([...png.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer);
  assertEquals(new TextDecoder().decode(png.slice(12, 16)), 'IHDR');
  assertEquals([view.getUint32(16), view.getUint32(20)], [size, size]);
  assertEquals(view.getUint32(29), crc32(png.slice(12, 29)));
  const idatLength = view.getUint32(33);
  assertEquals(new TextDecoder().decode(png.slice(37, 41)), 'IDAT');
  const raw = await inflate(png.slice(41, 41 + idatLength));
  assertEquals(raw.length, size * (1 + size * 3));
  const pixel = (x: number, y: number): number[] => {
    const at = y * (1 + size * 3) + 1 + x * 3;
    return [...raw.slice(at, at + 3)];
  };
  assertEquals(pixel(0, 0), [...BACKGROUND]);
  assertEquals(pixel(20, 6), [...GREEN]); // top of the ring
  assertEquals(new TextDecoder().decode(png.slice(-8, -4)), 'IEND');
});

Deno.test('pie › the default chart is 480 × 480 and small enough for WhatsApp', async () => {
  const png = await piePng([{ value: 3, rgb: GREEN }, { value: 2, rgb: BLUE }, {
    value: 1,
    rgb: ORANGE,
  }]);
  assertEquals(new DataView(png.buffer).getUint32(16), 480);
  assert(png.length < 200_000, `${png.length} bytes`);
});
