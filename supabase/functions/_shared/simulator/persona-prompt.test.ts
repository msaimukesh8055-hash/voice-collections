// supabase/functions/_shared/simulator/persona-prompt.test.ts
// The simulated shopkeeper's draft prompt: the seeded persona picks the behaviour, an unknown or
// missing one plays "cooperative", the language rule follows the shopkeeper, figures are given.
import { assertEquals, assertStringIncludes } from '@std/assert';
import {
  buildPersonaPrompt,
  PERSONA_PROMPT_VERSION,
  type PersonaFacts,
  personaKey,
  PERSONAS,
} from './persona-prompt.ts';

const FACTS: PersonaFacts = {
  persona: 'slow_payer',
  shopkeeperName: 'Latha',
  shopName: 'Latha General Stores',
  ownerName: 'Srinivas Reddy',
  businessName: 'Sri Lakshmi Traders',
  language: 'hi',
  outstanding: '₹2,000',
  overdue: '₹2,000',
  daysOverdue: 8,
};

Deno.test('persona › draft version and the seeded personas', () => {
  assertEquals(PERSONA_PROMPT_VERSION, 'v1');
  for (const key of ['cooperative', 'slow_payer', 'avoids_commitment', 'new_customer']) {
    assertEquals(personaKey(key), key);
  }
  assertEquals([personaKey(null), personaKey('pirate')], ['cooperative', 'cooperative']);
});

Deno.test('persona › the prompt carries names, figures, behaviour, language and the JSON shape', () => {
  const prompt = buildPersonaPrompt(FACTS);
  assertStringIncludes(prompt, 'The call is for Latha, owner of Latha General Stores');
  assertStringIncludes(prompt, 'about ₹2,000 is owed. ₹2,000 of it is 8 days late.');
  assertStringIncludes(prompt, PERSONAS.slow_payer);
  assertStringIncludes(prompt, 'Devanagari');
  assertStringIncludes(prompt, '{"say": "...", "hang_up": false}');
});

Deno.test('persona › nothing late and an unknown persona', () => {
  const prompt = buildPersonaPrompt({ ...FACTS, persona: null, daysOverdue: 0, language: 'en' });
  assertStringIncludes(prompt, 'None of it is late yet.');
  assertStringIncludes(prompt, PERSONAS.cooperative);
  assertStringIncludes(prompt, 'simple Indian English');
});
