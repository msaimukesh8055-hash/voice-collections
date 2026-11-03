// supabase/functions/_shared/brain/language.test.ts
import { assertEquals } from '@std/assert';
import { detectLanguage, hasIndicScript } from './language.ts';

Deno.test('language › Telugu and Devanagari script decide first', () => {
  assertEquals(detectLanguage('రమేష్ 2000 కట్టాడు'), 'te');
  assertEquals(detectLanguage('रमेश ने 2000 दिए'), 'hi');
});

Deno.test('language › Latin-letter Telugu and Hindi are spotted by their words', () => {
  assertEquals(detectLanguage('Ramesh 2000 kattadu'), 'te');
  assertEquals(detectLanguage('Ramesh ne 2000 diye'), 'hi');
});

Deno.test('language › anything else is English', () => {
  assertEquals(detectLanguage('Ramesh paid 2000'), 'en');
  assertEquals(detectLanguage('pending'), 'en');
});

Deno.test('language › Indic script is flagged for the LLM path', () => {
  assertEquals([hasIndicScript('రమేష్'), hasIndicScript('Ramesh')], [true, false]);
});
