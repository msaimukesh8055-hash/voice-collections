// supabase/functions/_shared/whatsapp/fixed-english.ts
// Fixed English for the bot's own Telugu labels in the "English under Telugu" twin (approved by
// Saim 2026-11-04). Translate turned "🎤 విన్నది" into "🎤 Heard of:" and "తర్వాత బాకీ" into
// "Then, the outstanding", although phrases.ts already has the right English for both. So a line
// that is one of our Telugu labels, or starts with one and a ":", gets its English from phrases.ts; only
// what is left (free Telugu, e.g. what Saaras heard) still goes to Translate.
import { TELUGU_SCRIPT } from '../brain/language.ts';
import { PHRASES } from './phrases.ts';

export interface FixedPair {
  readonly te: string;
  readonly en: string;
}

/** What may follow a label (Saim, 2026-11-04): ":" (optionally after a closing "*"), or the end
 * of the line (optionally a closing "*" and spaces). Anything else, e.g. a space and more words,
 * means the label is the first word of a free sentence ("లేదు ఇంకా రాలేదు"), so it is not
 * swapped. A letter, Telugu vowel sign or digit right after can never match, so a longer word
 * ("బాకీలు") is never taken for the label. */
const LABEL_ENDS = /^\*?(?::|\s*$)/u;

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

/** A bold opening "*" before a label that has none of its own ("*బాకీ*: …"). */
function boldOpening(line: string, pair: FixedPair): string {
  return line.startsWith('*') && !pair.te.startsWith('*') ? '*' : '';
}

/** Only a whole line or "label: …" at the start of a line; never inside a sentence. */
export function withFixedEnglish(text: string): FixedEnglish {
  const labels = new Set<string>();
  const lines = text.split('\n').map(function fixLine(line): string {
    const pair = FIXED_ENGLISH.find(function labelsLine(candidate): boolean {
      const start = boldOpening(line, candidate) + candidate.te;
      return line.startsWith(start) && LABEL_ENDS.test(line.slice(start.length));
    });
    if (!pair) return line;
    labels.add(pair.en);
    const start = boldOpening(line, pair) + pair.te;
    return boldOpening(line, pair) + pair.en + line.slice(start.length);
  });
  return { text: lines.join('\n'), labels: [...labels] };
}
