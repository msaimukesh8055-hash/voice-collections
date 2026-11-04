// supabase/functions/_shared/whatsapp/phrases.test.ts
import { assert, assertEquals } from '@std/assert';
import { parseCommand } from '../brain/commands.ts';
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

/** Each bold example in the help message, e.g. "*remind all*". */
function helpExamples(help: string): string[] {
  return [...help.matchAll(/\*([^*]+)\*/g)].map((found) => found[1] ?? '');
}

Deno.test('phrases › help is short: five commands, the same in every language, no sample names', () => {
  const english = helpExamples(phrasesFor('en').help);
  assertEquals(english, ['pending', 'due', 'closed', 'insights', 'dashboard']);
  for (const language of SUPPORTED_LANGUAGES) {
    const help = phrasesFor(language).help;
    assertEquals(helpExamples(help), english, language);
    assert(!help.includes('Ramesh'), language);
    assert(help.includes('🎤'), language);
    assert(help.includes('Save'), language);
  }
});

Deno.test('phrases › every help example really is a command the bot understands', () => {
  const kinds = helpExamples(phrasesFor('en').help).map((example) =>
    parseCommand(example, '2026-11-02')?.kind ?? `not understood: ${example}`
  );
  assertEquals(kinds, ['pending', 'due_alert', 'closed', 'insights', 'dashboard']);
});
