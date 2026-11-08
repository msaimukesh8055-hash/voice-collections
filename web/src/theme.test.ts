// web/src/theme.test.ts
// The beige / brown / gold theme (M7 B2): every text colour passes WCAG AA (4.5:1) on every
// background it is used on, the faint logo watermark included; the meaningful gold (the active
// arrow) passes 3:1; and no screen sneaks in raw colours, white text or gold text.
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read from disk: Vitest empties CSS imports, even with ?raw.
const css = readFileSync(resolve(import.meta.dirname, 'index.css'), 'utf8');

const SOURCES = import.meta.glob<string>('./**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The ring chart's green / blue / orange match the WhatsApp chart (Saim, Decision 3 (a)). */
const RAW_COLOUR_ALLOWED = ['./features/dashboard/Donut.tsx'];
/** How strong the watermark logo is (Watermark.tsx) and how see-through the cards are. */
const WATERMARK_OPACITY = 0.05;
const CARD_OPACITY = 0.95;

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!match?.[1]) throw new Error(`No --color-${name} in index.css`);
  return match[1];
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = rgb(hex).map(function linear(value) {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

/** `top` laid over `bottom` at `alpha`. */
function over(bottom: string, top: string, alpha: number): string {
  const [b, t] = [rgb(bottom), rgb(top)];
  const mixed = b.map((value, i) => Math.round(value * (1 - alpha) + (t[i] ?? 0) * alpha));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

// The logo's darkest colour is ink, so the worst case is ink at the watermark's strength.
const canvasWithLogo = over(token('canvas'), token('ink'), WATERMARK_OPACITY);
const BACKGROUNDS = {
  canvas: token('canvas'),
  'canvas + watermark': canvasWithLogo,
  surface: token('surface'),
  'card (95%) over watermark': over(canvasWithLogo, token('surface'), CARD_OPACITY),
  'brand-soft': token('brand-soft'),
};
const TEXT = ['ink', 'ink-muted', 'brand', 'warning', 'danger', 'success'];

describe('theme › contrast (WCAG AA)', () => {
  for (const text of TEXT) {
    for (const [name, background] of Object.entries(BACKGROUNDS)) {
      it(`${text} on ${name} ≥ 4.5:1`, () => {
        expect(contrast(token(text), background)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it.each(['success', 'warning', 'danger'])('%s on its own 10%% tint pill ≥ 4.5:1', (name) => {
    const pill = over(token('surface'), token(name), 0.1);
    expect(contrast(token(name), pill)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['brand', 'brand-strong', 'success', 'success-strong', 'danger', 'danger-strong'])(
    'on-brand text on %s buttons ≥ 4.5:1',
    (name) => {
      expect(contrast(token('on-brand'), token(name))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['canvas', 'surface'])('the active arrow (gold-deep) on %s ≥ 3:1', (name) => {
    expect(contrast(token('gold-deep'), token(name))).toBeGreaterThanOrEqual(3);
  });
});

describe('theme › no stray colours in the screens', () => {
  const files = Object.entries(SOURCES).filter(([path]) => !path.includes('.test.'));

  it('finds the screens to scan', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)('%s: no white text, no gold text, no blue', (_path, source) => {
    expect(source).not.toMatch(/\btext-white\b/);
    expect(source).not.toMatch(/\btext-gold/);
    expect(source).not.toMatch(/-(blue|sky|indigo|slate|gray)-\d/);
  });

  it.each(files.filter(([path]) => !RAW_COLOUR_ALLOWED.includes(path)))(
    '%s: colours only through theme tokens (no #hex)',
    (_path, source) => {
      expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/);
    },
  );
});
