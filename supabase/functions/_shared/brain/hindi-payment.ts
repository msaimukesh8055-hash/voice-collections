// supabase/functions/_shared/brain/hindi-payment.ts
// "सलीम ने 1,000 रुपये दिए" (Salim paid ₹1,000) read in code (dry-run fix 3): Hindi "X ने N
// दिए" means X paid N. Only this one clear shape is read here; anything else in Telugu or
// Devanagari script still goes to the LLM. The name comes back in English letters; the caller
// trusts it only when it matches a shopkeeper. The amount is cut from the text, never guessed.
import { findAmount } from './amounts.ts';
import type { Command } from './commands.ts';
import { asciiDigits, devanagariWord } from './devanagari.ts';

const MAX_NAME_WORDS = 3;

/** Words for "rupees" and "thousand" in Devanagari, swapped for the Latin ones amounts.ts reads. */
const AMOUNT_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?:रुपये|रुपए|रूपये|रूपए|रुपया|रुपैया|रु\.?)(?=\s|$)/gu, 'rupaye'],
  [/(?:हज़ार|हजार)(?=\s|$)/gu, 'hazaar'],
  [/₹\s*/gu, '₹'],
];

/** <name> ने <amount> [rupees] [दे] दिए / दिये / दिया, and nothing else. */
const PAID_SHAPE =
  /^(.+?) (?:ने|ne) (₹?[\d,.]+(?: (?:hazaar|k|thousand))?(?: (?:rupaye|rupees|rs))?)(?: (?:de|दे))? (?:दिए|दिये|दिया|diye|diya)$/u;

function nameOf(raw: string): string | null {
  const words = raw.trim().split(' ');
  if (words.length === 0 || words.length > MAX_NAME_WORDS) return null;
  const latin = words.map(function wordInLatin(word): string {
    return /^[a-z]+$/.test(word) ? word : devanagariWord(word);
  });
  if (latin.some((word) => !/^[a-z]+$/.test(word))) return null;
  return latin.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

/** A payment command for the one clear Hindi shape, or null (the LLM reads it instead). */
export function devanagariPayment(clean: string): Command | null {
  const text = AMOUNT_WORDS.reduce(
    (current, [pattern, latin]) => current.replace(pattern, latin),
    asciiDigits(clean).replace(/[।]/gu, ' ').replace(/\s+/g, ' ').trim(),
  );
  const shape = PAID_SHAPE.exec(text);
  if (!shape?.[1] || !shape[2]) return null;
  const amount = findAmount(shape[2]);
  const name = nameOf(shape[1]);
  if (!amount || !name) return null;
  return { kind: 'mark_paid', name, amount: amount.amount };
}
