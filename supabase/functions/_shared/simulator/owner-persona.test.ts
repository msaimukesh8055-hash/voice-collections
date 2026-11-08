// supabase/functions/_shared/simulator/owner-persona.test.ts
// The simulated owner's prompt (M8 C1): approved v1 text with language, goals and fixed lines
// filled in; no lines → "none".
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { buildOwnerPersonaPrompt, OWNER_PERSONA_VERSION } from './owner-persona.ts';

Deno.test('owner persona › language, numbered goals and quoted fixed lines', () => {
  const prompt = buildOwnerPersonaPrompt({
    language: 'hi',
    goals: ['Ask about Ramesh.', 'End the call.'],
    scriptedLines: ['रमेश का क्या हुआ?'],
  });
  assertStringIncludes(prompt, 'Language: Hindi, in Devanagari script');
  assertStringIncludes(prompt, 'in order: 1. Ask about Ramesh. 2. End the call.');
  assertStringIncludes(prompt, 'when the moment comes: "रमेश का क्या हुआ?"');
  assertStringIncludes(prompt, '{"say": "<your words>", "hang_up": false}');
  assert(!prompt.includes('{LANGUAGE}') && !prompt.includes('{GOALS}'));
});

Deno.test('owner persona › no fixed lines says none; English and Telugu styles; v1', () => {
  const english = buildOwnerPersonaPrompt({ language: 'en', goals: ['Ask.'], scriptedLines: [] });
  assertStringIncludes(english, 'Fixed lines you must say when the moment comes: none');
  assertStringIncludes(english, 'Language: simple Indian English.');
  const telugu = buildOwnerPersonaPrompt({ language: 'te', goals: ['Ask.'], scriptedLines: [] });
  assertStringIncludes(telugu, 'Telugu, in Telugu script');
  assertEquals(OWNER_PERSONA_VERSION, 'v1');
});
