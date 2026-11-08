// supabase/functions/_shared/whatsapp/phrases.test.ts
import { assert, assertEquals } from '@std/assert';
import { SUPPORTED_LANGUAGES } from '../schemas/shopkeeper.ts';
import { PHRASES, phrasesFor } from './phrases.ts';

const BUTTON_KEYS = [
  'save',
  'edit',
  'cancel',
  'yes',
  'no',
  'confirmReceived',
  'notReceived',
  'choose',
  'tryAgain',
  'remindShort',
  'paidInFull',
  'partPayment',
  'menuButton',
  'pendingButton',
  'dueButton',
  'openButton',
] as const;
/** Meta cuts button titles at 20 characters; ours must fit uncut. */
const MAX_BUTTON_TITLE = 20;

Deno.test('phrases › every supported language has a table', () => {
  assertEquals(Object.keys(PHRASES).sort(), [...SUPPORTED_LANGUAGES].sort());
});

Deno.test('phrases › button titles fit WhatsApp without cutting, in every language', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    for (const key of BUTTON_KEYS) {
      const title = phrasesFor(language)[key];
      assert(title.length <= MAX_BUTTON_TITLE, `${language}.${key}`);
    }
  }
});

Deno.test('phrases › figures stay as digits in every language', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const line = phrasesFor(language).saved('Ramesh', '₹13,500');
    assert(line.includes('₹13,500') && line.includes('Ramesh'), language);
  }
});

Deno.test('phrases › every line renders to non-empty text in every language', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    for (const [key, value] of Object.entries(phrasesFor(language))) {
      const rendered = typeof value === 'function'
        ? (value as (...args: unknown[]) => string)('Ramesh', '₹500', 'Sun 15 Nov')
        : typeof value === 'string'
        ? value
        : Object.values(value as Record<string, string>).join(' ');
      assert(rendered.trim().length > 0, `${language}.${key}`);
    }
  }
});

/** M7 Decision 8: these titles start with their one emoji, in every language. */
const TITLE_EMOJI = [
  ['closedTitle', '✅ '],
  ['addCreditTitle', '🧾 '],
  ['paymentTitle', '💰 '],
  ['cancelled', '✖️ '],
] as const;

Deno.test('phrases › M7: each changed title starts with its emoji in every language', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const phrases = phrasesFor(language);
    for (const [key, emoji] of TITLE_EMOJI) assert(phrases[key].startsWith(emoji), key);
    assert(phrases.pendingTitle(2, '₹10').startsWith('📒 *'), language);
    assert(phrases.saved('Ramesh', '₹1').startsWith('✅ '), language);
  }
});

Deno.test('phrases › M7: next-step lines keep the name and the example in English letters', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const phrases = phrasesFor(language);
    assert(phrases.nextFor('Ramesh').includes('Ramesh'), language);
    assert(phrases.partHint('Ramesh').includes('*Ramesh paid 2000*'), language);
    assert(phrases.owesNothing('Ramesh').includes('Ramesh'), language);
    assert(phrases.dayCount(12).includes('12'), language);
  }
});
