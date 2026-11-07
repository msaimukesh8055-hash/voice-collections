// supabase/functions/_shared/whatsapp/spoken-prompt.test.ts
// The spoken-summary prompt v1 (M7 Decision 3): every language fills its parts, every opening
// can be picked, and the user message lists the buttons.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { SUPPORTED_LANGUAGES } from '../schemas/shopkeeper.ts';
import {
  buildSpokenMessage,
  buildSpokenPrompt,
  OPENINGS,
  pickOpening,
  SPOKEN_PROMPT_VERSION,
} from './spoken-prompt.ts';

const FILLED: Readonly<Record<string, readonly string[]>> = {
  te: ['Write in Telugu, in Telugu script.', 'Anantapur', 'Call him Srinivas garu.', '"రూపాయలు"'],
  hi: ['Write in Hindi, in Devanagari.', 'Hindustani', 'Call him Srinivas ji.', '"रुपये"'],
  en: [
    'Write in simple Indian English.',
    'Short, plain sentences.',
    'Call him Srinivas.',
    '"rupees"',
  ],
};

Deno.test('spoken prompt › version v1', () => {
  assertEquals(SPOKEN_PROMPT_VERSION, 'v1');
});

Deno.test('spoken prompt › each language fills LANGUAGE, STYLE, ADDRESS and RUPEES; no {…} left', () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const prompt = buildSpokenPrompt({ language, opening: OPENINGS[0] });
    for (const part of FILLED[language] ?? []) assertStringIncludes(prompt, part);
    assert(!/\{[A-Z]+\}/.test(prompt), language);
    assertStringIncludes(
      prompt,
      'Answer with ONE JSON object only: {"say": "<the voice note text>"}',
    );
  }
});

Deno.test('spoken prompt › all 5 openings are reachable from the random number', () => {
  const picked = [0, 0.2, 0.4, 0.6, 0.8, 0.999999].map((value) => pickOpening(() => value));
  assertEquals(new Set(picked).size, OPENINGS.length);
  assertEquals(pickOpening(() => 1), OPENINGS[4]);
  const prompt = buildSpokenPrompt({ language: 'en', opening: OPENINGS[2] });
  assertStringIncludes(prompt, `- Opening for this note: ${OPENINGS[2]}.`);
});

Deno.test('spoken prompt › the user message: language, buttons (or none), then the reply', () => {
  const withButtons = buildSpokenMessage({
    language: 'te',
    source: { reply: 'బాకీ: ₹8,500', buttons: ['Save', 'Edit'] },
  });
  assertEquals(
    withButtons,
    'Reply language: te\nButtons he can tap: Save, Edit\n\nThe reply:\nబాకీ: ₹8,500',
  );
  const none = buildSpokenMessage({ language: 'en', source: { reply: 'x', buttons: [] } });
  assertStringIncludes(none, 'Buttons he can tap: none');
});
