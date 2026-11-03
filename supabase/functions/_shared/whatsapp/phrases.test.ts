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
