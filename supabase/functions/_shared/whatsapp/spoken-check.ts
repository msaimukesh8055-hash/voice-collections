// supabase/functions/_shared/whatsapp/spoken-check.ts
// Safety checks on the spoken summary written by sarvam-105b (M7 Decision 4): the voice note
// must never say a figure or a name that is not in the reply on his screen. Pure code, no LLM.
// Any failure → the caller speaks today's spokenText instead ("better a flat voice than a wrong
// figure"). Only the reason is logged, never the text.
import { DEVANAGARI_SCRIPT, TELUGU_SCRIPT } from '../brain/language.ts';
import type { Language } from '../schemas/shopkeeper.ts';
import { MAX_SPOKEN_CHARS } from './spoken.ts';

export type SpokenCheckReason =
  | 'bad_json'
  | 'too_long'
  | 'link'
  | 'script'
  | 'number'
  | 'number_word'
  | 'name';

export type SpokenCheck = { readonly ok: true } | {
  readonly ok: false;
  readonly reason: SpokenCheckReason;
};

export interface SpokenCheckInput {
  /** Exactly what the LLM was given: the reply text and the button titles. */
  readonly source: string;
  readonly language: Language;
  /** Shopkeeper names, shop names and the owner's name. */
  readonly names: readonly string[];
}

const LINK = /https?:\/\/|www\./i;
const DIGIT = '[0-9०-९౦-౯]';
const NUMBER = new RegExp(`${DIGIT}+(?:[,.]${DIGIT}+)*`, 'gu');
const DEVANAGARI_ZERO = 0x0966;
const TELUGU_ZERO = 0x0c66;
const LATIN_WORD = /[A-Za-z]+/g;
/** Letter runs only, so a scale word glued to a digit ("5thousand", "5వేలు") is still a word. */
const TOKEN_SPLIT = /[^\p{L}\p{M}]+/u;

/** Scale words that hide a figure (Decision 4, check 5). Latin and Hindi: the whole word.
 * "lac", "lacs" (Indian spelling of lakh) and "k" ("5k") were added in testing. */
const SCALE_WORDS = new Set(
  [
    'thousand',
    'thousands',
    'hundred',
    'hundreds',
    'lakh',
    'lakhs',
    'crore',
    'crores',
    'lac',
    'lacs',
    'k',
    'hazaar',
    'hazar',
    'hajar',
    'vela',
    'velu',
    'हज़ार',
    'हजार',
    'हज़ारों',
    'हजारों',
    'सौ',
    'लाख',
    'लाखों',
    'करोड़',
    'करोड़ों',
  ].map((word) => word.normalize('NFC')),
);
/** Telugu joins endings to the word (వేలు, వేల, లక్షలు), so these are word starts. */
const TELUGU_SCALE_STARTS = ['వంద', 'వేల', 'లక్ష', 'కోటి', 'కోట్ల'];

/** Words any summary may use although the reply does not (Decision 4, check 7). Days and months
 * are added so "Sunday 15 November" passes for a reply that says "Sun 15 Nov". */
const ALLOWED_WORDS = new Set([
  'srinivas',
  'garu',
  'ji',
  'asha',
  'rupees',
  'save',
  'edit',
  'cancel',
  'menu',
  'remind',
  'credit',
  'balance',
  'pending',
  'due',
  'overdue',
  'insights',
  'dashboard',
  'ok',
  'voice',
  'note',
  'call',
  'payment',
  'card',
  'i',
  ...['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
  ...['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august'],
  ...['september', 'october', 'november', 'december'],
]);

function plainNumber(token: string): string {
  const ascii = token.replace(/[०-९౦-౯]/gu, function toAscii(digit): string {
    const code = digit.charCodeAt(0);
    return String(code - (code >= TELUGU_ZERO ? TELUGU_ZERO : DEVANAGARI_ZERO));
  });
  return String(Number(ascii.replace(/,/g, '')));
}

function numbersIn(text: string): readonly string[] {
  return (text.match(NUMBER) ?? []).map(plainNumber);
}

function hasRightScript(say: string, language: Language): boolean {
  if (language === 'te') return TELUGU_SCRIPT.test(say);
  if (language === 'hi') return DEVANAGARI_SCRIPT.test(say);
  return !TELUGU_SCRIPT.test(say) && !DEVANAGARI_SCRIPT.test(say);
}

function hasScaleWord(say: string): boolean {
  return say.normalize('NFC').split(TOKEN_SPLIT).some(function isScale(token): boolean {
    if (SCALE_WORDS.has(token.toLowerCase())) return true;
    return TELUGU_SCALE_STARTS.some((start) => token.startsWith(start));
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A name as a whole word in English letters ("Rameshకి" counts; "Ramesh" is not "Ram"). */
function mentions(text: string, name: string): boolean {
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(name)}(?![A-Za-z0-9])`, 'i');
  return pattern.test(text);
}

function latinWords(text: string): ReadonlySet<string> {
  return new Set((text.match(LATIN_WORD) ?? []).map((word) => word.toLowerCase()));
}

/** True when the word at `index` starts the text or follows a sentence end. */
function startsSentence(say: string, index: number): boolean {
  const before = say.slice(0, index).replace(/["'“‘(\s]+$/u, '');
  return before === '' || /[.!?।]$/u.test(before);
}

/** Check 7: words in English letters that could be an invented name. */
function hasUnknownWord(say: string, input: SpokenCheckInput): boolean {
  const known = latinWords(input.source);
  const isKnown = (word: string): boolean =>
    known.has(word.toLowerCase()) || ALLOWED_WORDS.has(word.toLowerCase());
  return [...say.matchAll(LATIN_WORD)].some(function isUnknown(match): boolean {
    const word = match[0];
    if (isKnown(word)) return false;
    if (input.language !== 'en') return true;
    return /^[A-Z]/.test(word) && !startsSentence(say, match.index);
  });
}

function hasUnseenName(say: string, input: SpokenCheckInput): boolean {
  return input.names.some((name) => mentions(say, name) && !mentions(input.source, name));
}

/** Every check in Decision 4, cheapest first; the first failure is the reason. */
export function checkSpoken(say: string, input: SpokenCheckInput): SpokenCheck {
  const text = say.trim();
  const fail = (reason: SpokenCheckReason): SpokenCheck => ({ ok: false, reason });
  if (text === '') return fail('bad_json');
  if (text.length > MAX_SPOKEN_CHARS) return fail('too_long');
  if (LINK.test(text)) return fail('link');
  if (!hasRightScript(text, input.language)) return fail('script');
  // Words before digits, so "5 thousand" is reported as a number word.
  if (hasScaleWord(text)) return fail('number_word');
  const allowed = new Set(numbersIn(input.source));
  if (numbersIn(text).some((number) => !allowed.has(number))) return fail('number');
  if (hasUnseenName(text, input) || hasUnknownWord(text, input)) return fail('name');
  return { ok: true };
}
