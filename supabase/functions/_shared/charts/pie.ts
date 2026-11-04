// supabase/functions/_shared/charts/pie.ts
// The insights pie chart as a PNG, drawn in our own code (SPEC D3: no data leaves our stack; M6
// Decision 8 option (b), chosen because the WebAssembly renderer can't be checked on Supabase's
// runtime from here). A ring ("donut") on the app's light-blue background, slices clockwise from
// 12 o'clock; edges smoothed by 4 samples a pixel. No text in the image: the caption carries the
// labels and figures, each next to a WhatsApp square of the same colour (🟩 🟦 🟧).

export type Rgb = readonly [number, number, number];

/** The three slices, in order, with the emoji square that matches each colour in the caption. */
export const SLICE_COLOURS = {
  collected: { rgb: [46, 158, 91] as Rgb, square: '🟩' },
  notYetDue: { rgb: [59, 130, 246] as Rgb, square: '🟦' },
  overdue: { rgb: [232, 89, 12] as Rgb, square: '🟧' },
} as const;

/** The app's very light blue (CLAUDE.md theme rule). */
export const BACKGROUND: Rgb = [234, 244, 255];
export const CHART_SIZE = 480;
const OUTER = 0.46;
const INNER = 0.27;
const SAMPLES = [0.25, 0.75] as const;

/** The insights split as the three slices, in the fixed order and colours. */
export function pieSlices(
  split: { readonly collected: number; readonly notYetDue: number; readonly overdue: number },
): readonly Slice[] {
  return [
    { value: split.collected, rgb: SLICE_COLOURS.collected.rgb },
    { value: split.notYetDue, rgb: SLICE_COLOURS.notYetDue.rgb },
    { value: split.overdue, rgb: SLICE_COLOURS.overdue.rgb },
  ];
}

export interface Slice {
  readonly value: number;
  readonly rgb: Rgb;
}

interface Arc {
  readonly end: number;
  readonly rgb: Rgb;
}

/** Cumulative slice ends as a share of the turn (0..1); zero slices are left out. */
export function arcsOf(slices: readonly Slice[]): readonly Arc[] {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
  if (total <= 0) return [];
  let at = 0;
  const shown = slices.filter((slice) => slice.value > 0);
  return shown.map((slice, index) => {
    at += slice.value / total;
    // The last slice closes the ring exactly (no rounding gap at 12 o'clock).
    return { end: index === shown.length - 1 ? 1 : at, rgb: slice.rgb };
  });
}

/** Colour at a point (0..1 across, 0..1 down): a slice inside the ring, else the background. */
export function colourAt(x: number, y: number, arcs: readonly Arc[]): Rgb {
  const dx = x - 0.5;
  const dy = y - 0.5;
  const r = Math.hypot(dx, dy);
  if (r > OUTER || r < INNER || arcs.length === 0) return BACKGROUND;
  // 0 at 12 o'clock, growing clockwise (y grows downwards in an image).
  const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
  // The last arc ends at 1 and turn < 1, so a slice is always found.
  return arcs.find((arc) => turn < arc.end)!.rgb;
}

/** Raw PNG scanlines (filter byte 0 + RGB), with 2×2 samples averaged per pixel. */
export function pixels(arcs: readonly Arc[], size: number): Uint8Array<ArrayBuffer> {
  const row = 1 + size * 3;
  const out = new Uint8Array(row * size);
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let [red, green, blue] = [0, 0, 0];
      for (const sy of SAMPLES) {
        for (const sx of SAMPLES) {
          const [r, g, b] = colourAt((px + sx) / size, (py + sy) / size, arcs);
          red += r;
          green += g;
          blue += b;
        }
      }
      const at = py * row + 1 + px * 3;
      out.set([Math.round(red / 4), Math.round(green / 4), Math.round(blue / 4)], at);
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A square PNG of the ring chart. */
export async function piePng(
  slices: readonly Slice[],
  size = CHART_SIZE,
): Promise<Uint8Array<ArrayBuffer>> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit, RGB, deflate, no filter method, no interlace
  const image = await deflate(pixels(arcsOf(slices), size));
  return concat([
    new Uint8Array(PNG_SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', image),
    chunk('IEND', new Uint8Array(0)),
  ]);
}
