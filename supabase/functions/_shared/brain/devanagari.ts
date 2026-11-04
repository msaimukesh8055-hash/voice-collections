// supabase/functions/_shared/brain/devanagari.ts
// Just enough Devanagari → English letters for a shopkeeper's name and for figures (dry-run
// fix 3): "सलीम" → "salim", "रमेश" → "ramesh", "१,०००" → "1,000". Names are then matched with
// the usual typo allowance (match.ts), so a near spelling ("salman" for "salaman") still finds
// the one shopkeeper. Not a general transliterator: anything it does not know is left out.

const CONSONANTS: Readonly<Record<string, string>> = {
  'क': 'k',
  'ख': 'kh',
  'ग': 'g',
  'घ': 'gh',
  'ङ': 'n',
  'च': 'ch',
  'छ': 'chh',
  'ज': 'j',
  'झ': 'jh',
  'ञ': 'n',
  'ट': 't',
  'ठ': 'th',
  'ड': 'd',
  'ढ': 'dh',
  'ण': 'n',
  'त': 't',
  'थ': 'th',
  'द': 'd',
  'ध': 'dh',
  'न': 'n',
  'प': 'p',
  'फ': 'ph',
  'ब': 'b',
  'भ': 'bh',
  'म': 'm',
  'य': 'y',
  'र': 'r',
  'ल': 'l',
  'व': 'v',
  'श': 'sh',
  'ष': 'sh',
  'स': 's',
  'ह': 'h',
};

/** A consonant with the nukta dot under it (क़, ज़, फ़…). */
const WITH_NUKTA: Readonly<Record<string, string>> = {
  'क': 'q',
  'ख': 'kh',
  'ग': 'g',
  'ज': 'z',
  'ड': 'r',
  'ढ': 'rh',
  'फ': 'f',
};

const VOWEL_SIGNS: Readonly<Record<string, string>> = {
  'ा': 'a',
  'ि': 'i',
  'ी': 'i',
  'ु': 'u',
  'ू': 'u',
  'ृ': 'ri',
  'े': 'e',
  'ै': 'ai',
  'ो': 'o',
  'ौ': 'au',
  'ॉ': 'o',
};

const VOWELS: Readonly<Record<string, string>> = {
  'अ': 'a',
  'आ': 'a',
  'इ': 'i',
  'ई': 'i',
  'उ': 'u',
  'ऊ': 'u',
  'ऋ': 'ri',
  'ए': 'e',
  'ऐ': 'ai',
  'ओ': 'o',
  'औ': 'au',
};

const NASAL: Readonly<Record<string, string>> = { 'ं': 'n', 'ँ': 'n', 'ः': 'h' };
const NUKTA = '़';
const VIRAMA = '्';
const DEVANAGARI_ZERO = 0x0966;

/** "१,०००" → "1,000"; other characters are left as they are. */
export function asciiDigits(text: string): string {
  return text.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - DEVANAGARI_ZERO));
}

/** One consonant (with its nukta, if any) and the vowel that follows it. */
function syllable(letters: readonly string[], index: number): { text: string; next: number } {
  const letter = letters[index] ?? '';
  const hasNukta = letters[index + 1] === NUKTA;
  const base = hasNukta ? WITH_NUKTA[letter] ?? CONSONANTS[letter] ?? '' : CONSONANTS[letter] ?? '';
  const after = hasNukta ? index + 2 : index + 1;
  const mark = letters[after] ?? '';
  if (mark === VIRAMA) return { text: base, next: after + 1 };
  const sign = VOWEL_SIGNS[mark];
  if (sign !== undefined) return { text: base + sign, next: after + 1 };
  // The silent final "a": "रमेश" is "ramesh", not "ramesha".
  const isLast = after >= letters.length;
  return { text: isLast ? base : `${base}a`, next: after };
}

/** One Devanagari word in English letters, lower case ("सलीम" → "salim"). */
export function devanagariWord(word: string): string {
  const letters = [...word];
  let out = '';
  let index = 0;
  while (index < letters.length) {
    const letter = letters[index] ?? '';
    if (letter in CONSONANTS) {
      const step = syllable(letters, index);
      out += step.text;
      index = step.next;
      continue;
    }
    out += VOWELS[letter] ?? NASAL[letter] ?? (/[a-z]/.test(letter) ? letter : '');
    index += 1;
  }
  return out;
}
