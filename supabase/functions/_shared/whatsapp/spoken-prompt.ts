// supabase/functions/_shared/whatsapp/spoken-prompt.ts
// The spoken-summary prompt (M7 Decision 3, v1, approved by Saim 2026-11-07): sarvam-105b turns
// one bot reply into a short voice note for Srinivas. Code fills the language, style, address,
// rupee word and the opening (picked at random, so two notes in a row start differently). The
// model answers {"say": "…"}; spoken-check.ts decides whether it may be spoken.
// ⚠️ The prompt text is Saim's decision; the Telugu and Hindi parts need the native-speaker check.
import type { Language } from '../schemas/shopkeeper.ts';
import type { SpokenSource } from './spoken.ts';

export const SPOKEN_PROMPT_VERSION = 'v1';

interface LanguageParts {
  readonly language: string;
  readonly style: string;
  readonly address: string;
  readonly rupees: string;
}

const EVERYDAY_ENGLISH =
  'Everyday English words (credit, balance, pending, Save) may stay in English letters.';

const PARTS: Readonly<Record<Language, LanguageParts>> = {
  te: {
    language: 'Telugu, in Telugu script',
    style: 'Everyday spoken Telugu as people talk in Anantapur, not bookish Telugu. ' +
      EVERYDAY_ENGLISH,
    address: 'Srinivas garu',
    rupees: 'రూపాయలు',
  },
  hi: {
    language: 'Hindi, in Devanagari',
    style: 'Everyday spoken Hindi (Hindustani), not formal Hindi. ' + EVERYDAY_ENGLISH,
    address: 'Srinivas ji',
    rupees: 'रुपये',
  },
  en: {
    language: 'simple Indian English',
    style: 'Short, plain sentences.',
    address: 'Srinivas',
    rupees: 'rupees',
  },
};

/** One of these is picked for every note (Decision 3, option a). */
export const OPENINGS = [
  'begin with his name',
  'begin with the main figure',
  'begin with a short friendly word, like "OK", "Sare" (Telugu) or "Achha" (Hindi)',
  'begin with the key point in a few words',
  'begin by saying what you just did for him (checked the book, made the card)',
] as const;
export type Opening = (typeof OPENINGS)[number];

/** `random` returns [0, 1), like Math.random; injected so tests are fixed. */
export function pickOpening(random: () => number): Opening {
  const index = Math.min(OPENINGS.length - 1, Math.floor(random() * OPENINGS.length));
  return OPENINGS[index] ?? OPENINGS[0];
}

export function buildSpokenPrompt(input: { language: Language; opening: Opening }): string {
  const parts = PARTS[input.language];
  return [
    'You turn one WhatsApp reply from the Easy Recovery AI bot into a short voice note for',
    'Srinivas Reddy, a wholesale trader in Anantapur who keeps his credit book on WhatsApp.',
    'He will hear it, not read it. The full text with every figure is already on his screen.',
    '',
    `Write in ${parts.language}. ${parts.style}`,
    'Talk to him the way a helpful shop assistant talks to the owner: casual, warm, natural.',
    `Call him ${parts.address}.`,
    '',
    'Rules:',
    '- 20 to 30 seconds when spoken: 2 to 4 short sentences, at most 500 characters.',
    `- Opening for this note: ${input.opening}. Do not start with "Here is" or "This is".`,
    '- Say only what is in the reply. Never add a name, an amount, a date or any number that is',
    '  not in it. Never work out a new figure: no totals, no differences, no counting.',
    `- Write every amount in digits exactly as in the reply, then the word "${parts.rupees}".`,
    '  Never write a number in words.',
    '- Write every name exactly as in the reply, in English letters.',
    "- A long list: give the headline and at most the first 3 people, in the reply's order.",
    "- If the reply has buttons, end by telling him which one to tap, using the button's name.",
    '- No links, no emoji, no symbols such as * or ₹.',
    '',
    'Answer with ONE JSON object only: {"say": "<the voice note text>"}',
  ].join('\n');
}

/** The user message: language, the buttons he can tap, then the reply itself. */
export function buildSpokenMessage(input: { language: Language; source: SpokenSource }): string {
  const buttons = input.source.buttons.length > 0 ? input.source.buttons.join(', ') : 'none';
  return [
    `Reply language: ${input.language}`,
    `Buttons he can tap: ${buttons}`,
    '',
    'The reply:',
    input.source.reply,
  ].join('\n');
}
