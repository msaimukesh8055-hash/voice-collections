// supabase/functions/_shared/whatsapp/fixed-english.ts
// Fixed English for the bot's own Telugu labels in the "English under Telugu" twin (approved by
// Saim 2026-11-04). Translate turned "🎤 విన్నది" into "🎤 Heard of:" and "తర్వాత బాకీ" into
// "Then, the outstanding", although phrases.ts already has the right English for both. So a line
// that starts with one of our Telugu labels gets that label's English from phrases.ts, and only
// what is left (free Telugu, e.g. what Saaras heard) still goes to Translate.
import { TELUGU_SCRIPT } from '../brain/language.ts';
import { PHRASES } from './phrases.ts';

export interface FixedPair {
  readonly te: string;
  readonly en: string;
}

/** After a label, a letter, Telugu vowel sign (\p{M}) or digit means a longer word, not the label. */
const WORD_GOES_ON = /^[\p{L}\p{M}\p{N}]/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** Plain strings at the same place in both trees; nested objects followed; functions skipped. */
function collect(te: unknown, en: unknown, out: FixedPair[]): void {
  if (typeof te === 'string' && typeof en === 'string') {
    out.push({ te, en });
    return;
  }
  if (!isRecord(te) || !isRecord(en)) return;
  for (const key of Object.keys(te)) collect(te[key], en[key], out);
}

function isUsable(pair: FixedPair): boolean {
  const oneLine = !pair.te.includes('\n') && !pair.en.includes('\n');
  return oneLine && TELUGU_SCRIPT.test(pair.te) && pair.te !== pair.en;
}

function buildPairs(): readonly FixedPair[] {
  const all: FixedPair[] = [];
  collect(PHRASES.te, PHRASES.en, all);
  // Longest Telugu first, so "తర్వాత బాకీ" wins over "బాకీ".
  return all.filter(isUsable).sort((a, b) => b.te.length - a.te.length);
}

/** Every Telugu label with its English, longest Telugu first. */
export const FIXED_ENGLISH: readonly FixedPair[] = buildPairs();

export interface FixedEnglish {
  /** The text with each line's leading Telugu label swapped for its English. */
  readonly text: string;
  /** The English labels put in, for Translate to keep exactly. */
  readonly labels: readonly string[];
}

/** Only at the start of a line, never in the middle of a sentence. */
export function withFixedEnglish(text: string): FixedEnglish {
  const labels = new Set<string>();
  const lines = text.split('\n').map(function fixLine(line): string {
    const pair = FIXED_ENGLISH.find(function startsLine(candidate): boolean {
      return line.startsWith(candidate.te) &&
        !WORD_GOES_ON.test(line.slice(candidate.te.length));
    });
    if (!pair) return line;
    labels.add(pair.en);
    return pair.en + line.slice(pair.te.length);
  });
  return { text: lines.join('\n'), labels: [...labels] };
}
