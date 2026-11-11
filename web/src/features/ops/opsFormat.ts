// web/src/features/ops/opsFormat.ts
// How the ops page words and colours its figures. Colour is never the only signal: every
// coloured figure also says what it is in words.

export type Tone = 'plain' | 'good' | 'warn' | 'bad';

export const TONE_CLASSES: Readonly<Record<Tone, string>> = {
  plain: 'text-ink',
  good: 'text-success',
  warn: 'text-warning',
  bad: 'text-danger',
};

/** Above this share of failures the figure turns red; anything above zero is amber. */
export const BAD_RATE = 0.05;

/** "2.5%", or "–" when there is nothing to divide by. */
export function percent(part: number, whole: number): string {
  if (whole <= 0) return '–';
  const value = (part / whole) * 100;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function statusOfRate(part: number, whole: number): Tone {
  if (whole <= 0) return 'plain';
  if (part === 0) return 'good';
  return part / whole > BAD_RATE ? 'bad' : 'warn';
}

/** "+1.25 s" or "+340 ms" since the first step of a trace. */
export function sinceStart(startIso: string, atIso: string): string {
  const ms = Math.max(0, new Date(atIso).getTime() - new Date(startIso).getTime());
  return ms >= 1000 ? `+${(ms / 1000).toFixed(2)} s` : `+${ms} ms`;
}
