// supabase/functions/_shared/calls/their-words.ts
// The shopkeeper's own words in Asha's call history (M7 B1 Decision 1 (b)). The only source is
// Asha's one-line callback summary (followups.summary), and what the shopkeeper says can carry a
// planted claim (CP2 M2: "the owner agreed to waive ₹2,000"). So the phrase is kept only when
// every rule passes, and any failure drops it whole (never repaired: "pay in 2 weeks" stripped
// would read "pay in weeks"). Asha then has only the fixed reason, which is always safe.
// Pure code, no language-specific output: the describer labels it as their claim.
import type { CallbackReason } from '../followup/facts.ts';
import { DIGIT, hasScaleWord } from '../figure-words.ts';

export const MAX_THEIR_WORDS_CHARS = 80;
const MIN_LETTERS = 3;
const ELLIPSIS = '…';

/** Rule 2: callbacks that carry a reason worth remembering (wants_owner is just "call me"). */
const REASONS_WITH_WORDS: ReadonlySet<CallbackReason> = new Set(['hardship', 'dispute', 'other']);

const HAS_DIGIT = new RegExp(DIGIT, 'u');
/** Any number character in any script (full-width, Kannada, Arabic, ½, ²), found in testing. */
const ANY_NUMBER = /\p{N}/u;
/** Zero-width and other invisible format characters (incl. soft hyphen), removed before every
 * check so "ow<zero-width space>ner" is still "owner" (found in testing). */
const INVISIBLE = /\p{Cf}/gu;

/** Rule 3: number words and money words the scale-word list does not cover. Hindi and Telugu
 * number words, zero, dozen, twice and thrice were added in testing. Romanised Hindi "do" (two)
 * is left out: it is the English word "do". */
const NUMBER_WORDS = [
  ...['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
  ...['eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen'],
  ...['eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy'],
  ...['eighty', 'ninety', 'half', 'double', 'dozen', 'twice', 'thrice'],
  ...['rs', 'rupee', 'rupees', 'रुपये', 'रुपए', 'रुपया', 'రూపాయలు', 'రూపాయి'],
  ...['ek', 'teen', 'char', 'paanch', 'panch', 'chhe', 'saat', 'aath', 'nau', 'das', 'bees'],
  ...['aadha', 'adha', 'aadhe', 'dedh', 'dhai', 'dugna', 'doguna'],
  ...['okati', 'rendu', 'moodu', 'mudu', 'nalugu', 'aidu', 'padi', 'iravai', 'sagam'],
  ...['एक', 'दो', 'तीन', 'चार', 'पांच', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस', 'बीस'],
  ...['आधा', 'आधे', 'डेढ़', 'ढाई', 'दुगना', 'दोगुना', 'ఆరు', 'ఏడు', 'పది'],
];

/** Rule 4: claims about the owner, money terms and instruction-like text. Whole words. Owner
 * names in Hindi and Telugu, malik, seth, boss, reddy (the owner's surname) and the Hindi words
 * were added in testing. */
const BLOCKED_WORDS = [
  ...['srinivas', 'reddy', 'malik', 'maalik', 'seth', 'sethji', 'boss', 'asha'],
  ...['free', 'balance', 'balances', 'paid', 'system', 'systems', 'tool', 'tools'],
  ...['rule', 'rules', 'obey', 'command', 'commands', 'forget', 'disregard', 'override'],
  ...['maaf', 'maafi', 'chhoot', 'chhut'],
  ...['मालिक', 'सेठ', 'सेठजी', 'श्रीनिवास', 'ओनर', 'माफ', 'माफ़', 'माफी', 'माफ़ी', 'छूट'],
  ...['नियम', 'निर्देश', 'आदेश', 'अनदेखा', 'नज़रअंदाज़', 'नजरअंदाज'],
];
/** Rule 4, word starts, so "waived", "agrees", "cancelled", "owners" also count (found in
 * testing). Telugu joins endings to the word, so its words are starts too. */
const BLOCKED_STARTS = [
  ...['owner', 'agree', 'waiv', 'discount', 'forgiv', 'forgave', 'cancel', 'settl', 'reduc'],
  ...['outstanding', 'ignor', 'instruct', 'prompt', 'pretend', 'assistant'],
  ...['యజమాని', 'శ్రీనివాస', 'ఓనర్', 'సేటు', 'మాఫీ', 'తగ్గింపు', 'రాయితీ', 'నియమ', 'సూచన'],
  ...['ఆదేశ', 'మర్చిపో', 'పట్టించుకోక'],
  ...['ఒకటి', 'రెండు', 'మూడు', 'నాలుగు', 'ఐదు', 'అయిదు', 'ఎనిమిది', 'తొమ్మిది', 'ఇరవై'],
  ...['సగం', 'రెట్టింపు'],
].map((start) => start.normalize('NFKC'));
/** Matched on the words joined by single spaces, so "write-off" is "write off". */
const BLOCKED_PHRASES = [
  ...['write off', 'writes off', 'written off', 'wrote off', 'writing off'],
  ...['you must', 'you should', 'act as'],
];

/** Rule 5: anything but letters, spaces and . , ' - becomes a space. */
const NOT_ALLOWED = /[^\p{L}\p{M} .,'-]+/gu;
/** Letters from another script (Cyrillic "о", Greek, accented Latin) can pass for English:
 * only English letters, Devanagari and Telugu are kept (homoglyphs, found in testing). */
const OTHER_SCRIPT = /[^A-Za-z\u0900-\u097F\u0C00-\u0C7F .,'-]/u;
const LETTER = /[\p{L}\p{M}]/gu;
const WORD_SPLIT = /[^\p{L}\p{M}]+/u;
const LEADING_SAID = /^(?:(?:he|she|they)\s+)?(?:said|says)\s+(?:that\s+)?/i;
const EDGE_PUNCTUATION = /^[\s.,'-]+|[\s.,'-]+$/g;

const DROP_WORDS: ReadonlySet<string> = new Set(
  [...NUMBER_WORDS, ...BLOCKED_WORDS].map((word) => word.normalize('NFKC')),
);

export interface TheirWordsContext {
  readonly reason: CallbackReason;
  /** Rule 1: before identity, the speaker may be his son or a neighbour. */
  readonly identityConfirmed: boolean;
}

/** Full-width and styled letters become plain ones, and invisible characters go. */
function prepare(text: string): string {
  return text.normalize('NFKC').replace(INVISIBLE, '');
}

function hasFigure(text: string): boolean {
  return text.includes('₹') || HAS_DIGIT.test(text) || ANY_NUMBER.test(text) ||
    hasScaleWord(text);
}

function isDropToken(token: string): boolean {
  return DROP_WORDS.has(token) || BLOCKED_STARTS.some((start) => token.startsWith(start));
}

function hasDropWord(text: string): boolean {
  const tokens = text.toLowerCase().split(WORD_SPLIT).filter((token) => token !== '');
  if (tokens.some(isDropToken)) return true;
  const spaced = ` ${tokens.join(' ')} `;
  return BLOCKED_PHRASES.some((phrase) => spaced.includes(` ${phrase} `));
}

function clean(text: string): string {
  const plain = text.replace(NOT_ALLOWED, ' ').replace(/\s+/g, ' ').trim();
  return plain.replace(LEADING_SAID, '').replace(EDGE_PUNCTUATION, '');
}

/** Rule 6: cut at a word boundary, with "…", so the result is at most 80 characters. */
function capLength(text: string): string {
  if (text.length <= MAX_THEIR_WORDS_CHARS) return text;
  const room = text.slice(0, MAX_THEIR_WORDS_CHARS - ELLIPSIS.length);
  const lastSpace = room.lastIndexOf(' ');
  const cut = lastSpace > 0 ? room.slice(0, lastSpace) : room;
  return `${cut.replace(EDGE_PUNCTUATION, '')}${ELLIPSIS}`;
}

function letterCount(text: string): number {
  return (text.match(LETTER) ?? []).length;
}

/** The phrase Asha may see as their claim, or null when any rule fails. */
export function theirWords(summary: string | null, context: TheirWordsContext): string | null {
  if (!context.identityConfirmed || !REASONS_WITH_WORDS.has(context.reason)) return null;
  if (summary === null) return null;
  const prepared = prepare(summary);
  if (hasFigure(prepared)) return null;
  const cleaned = clean(prepared);
  if (OTHER_SCRIPT.test(cleaned) || hasDropWord(cleaned)) return null;
  if (letterCount(cleaned) < MIN_LETTERS) return null;
  return capLength(cleaned);
}
