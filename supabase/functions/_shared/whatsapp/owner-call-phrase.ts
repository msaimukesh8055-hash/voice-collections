// supabase/functions/_shared/whatsapp/owner-call-phrase.ts
// "call Munshi" typed or said mid-conversation (2026-11-08 bug fix): matched in code before any
// name lookup or LLM, so Munshi is never read as a shopkeeper's name. A message is a Munshi
// request when it names Munshi and every other word is a short "call / now / please" word, in
// English, Latin-letter Hindi or Telugu, Devanagari or Telugu script. Anything else (a sentence
// with a shopkeeper or an amount in it) is not, and takes the usual path.

/** Munshi, as the owner might write it. */
const MUNSHI_WORDS: ReadonlySet<string> = new Set([
  'munshi',
  'munshee',
  'munshiji',
  'munshiko',
  'munshiki',
  'मुंशी',
  'मुनशी',
  'मुन्शी',
  'మున్షీ',
  'మున్షి',
  'మున్షీకి',
  'మున్షికి',
  'మున్షీని',
]);

/** Words that may sit around "Munshi" in a request to call him. */
const CALL_WORDS: ReadonlySet<string> = new Set([
  'call',
  'phone',
  'ring',
  'open',
  'start',
  'talk',
  'speak',
  'to',
  'with',
  'now',
  'please',
  'pls',
  'plz',
  'ji',
  'ko',
  'se',
  'karo',
  'kar',
  'karein',
  'baat',
  'cheyi',
  'cheyyi',
  'cheyandi',
  'కి',
  'కాల్',
  'చేయి',
  'చేయండి',
  'చెయ్యి',
  'को',
  'से',
  'कॉल',
  'करो',
  'करें',
  'कर',
  'जी',
  'बात',
]);

/** Up to this many words in all: a request is short. */
const MAX_WORDS = 5;

/** Zero-width joiners (format characters) are dropped, so "కాల్" matches however it is typed. */
function withoutJoiners(word: string): string {
  return word.replace(/\p{Cf}/gu, '');
}

/** Words split on spaces, punctuation and symbols (emoji). */
function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/[\s\p{P}\p{S}]+/u).map(withoutJoiners).filter(Boolean);
}

/** True when the whole message asks for a Munshi call ("call Munshi", "मुंशी", "మున్షీ"). */
export function isOwnerCallRequest(text: string): boolean {
  const words = wordsOf(text);
  if (words.length === 0 || words.length > MAX_WORDS) return false;
  const munshi = words.filter((word) => MUNSHI_WORDS.has(word));
  return munshi.length === 1 &&
    words.every((word) => MUNSHI_WORDS.has(word) || CALL_WORDS.has(word));
}
