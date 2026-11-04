// supabase/functions/_shared/brain/notes.ts
// A credit card's note carries real content only, e.g. "rice bags" (dry run, 2026-11-04): the
// LLM liked to fill it with "Given today" or "credit given", which says nothing the card does
// not already say. A note made only of such words (English, Hindi, Telugu, any script) is dropped.

/** Words that only restate "credit given today"; lower case, punctuation already removed. */
const EMPTY_NOTE_WORDS: ReadonlySet<string> = new Set([
  // English
  'given',
  'gave',
  'give',
  'credit',
  'credited',
  'today',
  'on',
  'for',
  'goods',
  'items',
  'item',
  'entry',
  'new',
  'added',
  'add',
  'loan',
  'the',
  'a',
  'is',
  'was',
  // Hindi, Latin letters
  'udhaar',
  'udhar',
  'udaar',
  'udhaari',
  'diya',
  'diye',
  'di',
  'de',
  'aaj',
  'maal',
  'saman',
  // Hindi, Devanagari
  'उधार',
  'दिया',
  'दिए',
  'दिये',
  'दी',
  'आज',
  'माल',
  'सामान',
  // Telugu, Latin letters
  'appu',
  'ichanu',
  'icchanu',
  'ichchaanu',
  'ichchanu',
  'ichaanu',
  'ivala',
  'eeroju',
  'iroju',
  'eevala',
  'saruku',
  // Telugu script
  'అప్పు',
  'ఇచ్చాను',
  'ఇచ్చారు',
  'ఇచ్చింది',
  'ఈరోజు',
  'ఇవాళ',
  'ఈ',
  'రోజు',
  'సరుకు',
  'క్రెడిట్',
]);

function wordsOf(note: string): string[] {
  return note.toLowerCase().split(/[\s.,!?;:()"'“”‘’-]+/u).filter((word) => word !== '');
}

/** The note when it says something real; null when it only restates "credit given today". */
export function meaningfulNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? '').trim();
  if (trimmed === '') return null;
  const real = wordsOf(trimmed).filter((word) => !EMPTY_NOTE_WORDS.has(word));
  return real.length > 0 ? trimmed : null;
}
