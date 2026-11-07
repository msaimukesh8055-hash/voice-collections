// supabase/functions/_shared/figure-words.ts
// What counts as a figure in free text: digits in any script and scale words in English, Hindi
// and Telugu. One list, used by the spoken-summary checks (M7 Decision 4) and the their-words
// sanitiser for Asha's call history (M7 B1 Decision 1). Moved here from whatsapp/spoken-check.ts
// so the call history does not depend on WhatsApp code.

/** A digit: ASCII, Devanagari or Telugu. */
export const DIGIT = '[0-9०-९౦-౯]';
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

/** True when the text has a scale word ("thousand", "5k", "हज़ार", "వేలు"). */
export function hasScaleWord(say: string): boolean {
  return say.normalize('NFC').split(TOKEN_SPLIT).some(function isScale(token): boolean {
    if (SCALE_WORDS.has(token.toLowerCase())) return true;
    return TELUGU_SCALE_STARTS.some((start) => token.startsWith(start));
  });
}
