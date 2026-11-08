// supabase/functions/_shared/whatsapp/slash-phrases.test.ts
// Every "/" command line exists in English, Hindi and Telugu (a missing one is a type error),
// fills in its figures, and the help lists every registered command once, in order.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { SUPPORTED_LANGUAGES } from '../schemas/shopkeeper.ts';
import { SLASH_COMMANDS } from './slash-commands.ts';
import { slashPhrasesFor } from './slash-phrases.ts';

Deno.test('slash phrases › every line, every language, with its figures filled in', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const phrases = slashPhrasesFor(language);
    for (const prompt of Object.values(phrases.prompts)) assertEquals(prompt.length, 2, language);
    assertStringIncludes(phrases.claimsTitle(3, '₹4,500'), '3', language);
    assertStringIncludes(phrases.claimsTitle(3, '₹4,500'), '₹4,500', language);
    assertStringIncludes(phrases.weekSection(2), '2', language);
    assertStringIncludes(phrases.brokenSection(4), '4', language);
    for (const line of [phrases.promisedBy, phrases.brokenOn]) {
      const text = line('Ramesh', '₹2,000', 'Wed 4 Nov');
      for (const part of ['Ramesh', '₹2,000', 'Wed 4 Nov']) assertStringIncludes(text, part);
    }
    for (const text of [phrases.helpTitle, phrases.noClaims, phrases.claimsNote, phrases.none]) {
      assert(text.length > 0, language);
    }
    assert(phrases.noPromises.length > 0 && phrases.promisesTitle.length > 0, language);
  }
});

Deno.test('slash phrases › the help lists every registered command once, in order', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const lines = slashPhrasesFor(language).helpLines;
    assertEquals(lines.map((line) => line.split(' ')[0]), SLASH_COMMANDS.map((c) => `/${c.name}`));
  }
  assertEquals(slashPhrasesFor('en').helpLines[0], '/munshi · Call Munshi: talk to your book');
});
