// supabase/functions/_shared/brain/language.ts
// Which language to reply in (M4 Decision 8): the language of the owner's message. Script decides
// first (Telugu or Devanagari letters); Latin-letter Telugu and Hindi are spotted by common words.
import type { Language } from '../schemas/shopkeeper.ts';

export const TELUGU_SCRIPT = /[ఀ-౿]/;
export const DEVANAGARI_SCRIPT = /[ऀ-ॿ]/;

/** Words that only appear in Latin-letter Telugu / Hindi owner messages (kept disjoint). */
export const TELUGU_WORDS: ReadonlySet<string> = new Set([
  'kattadu',
  'kattindi',
  'kattaru',
  'kattesadu',
  'ichadu',
  'icchadu',
  'ichindi',
  'icchindi',
  'ichaadu',
  'chellinchadu',
  'appu',
  'icchanu',
  'ichanu',
  'enta',
  'entha',
  'ivvali',
  'garu',
  'gaaru',
  'lopu',
  'rojullo',
  'rojulu',
  'repu',
  'bakilu',
  'evaru',
  'vela',
  'veyyi',
  'ku',
]);

export const HINDI_WORDS: ReadonlySet<string> = new Set([
  'ne',
  'ko',
  'diye',
  'diya',
  'udhaar',
  'udhar',
  'udhaari',
  'jama',
  'chukaya',
  'chukaye',
  'kitna',
  'kitne',
  'hai',
  'hain',
  'nahi',
  'rupaye',
  'din',
  'tak',
  'mein',
  'baaki',
  'bakaya',
  'hazaar',
  'hazar',
  'kaun',
  'kisne',
  'bhare',
]);

function countIn(words: readonly string[], set: ReadonlySet<string>): number {
  return words.filter((word) => set.has(word)).length;
}

export function detectLanguage(text: string): Language {
  if (TELUGU_SCRIPT.test(text)) return 'te';
  if (DEVANAGARI_SCRIPT.test(text)) return 'hi';
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const telugu = countIn(words, TELUGU_WORDS);
  const hindi = countIn(words, HINDI_WORDS);
  if (telugu === 0 && hindi === 0) return 'en';
  return telugu >= hindi ? 'te' : 'hi';
}

/** True when the text has Telugu or Hindi script, which only the LLM path reads. */
export function hasIndicScript(text: string): boolean {
  return TELUGU_SCRIPT.test(text) || DEVANAGARI_SCRIPT.test(text);
}
