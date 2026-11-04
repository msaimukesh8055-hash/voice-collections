// supabase/functions/_shared/whatsapp/fixed-english.test.ts
// Fixed English for the bot's own Telugu labels (approved by Saim 2026-11-04): which pairs are
// used, start-of-line only, and longer words left alone.
import { assert, assertEquals } from '@std/assert';
import { TELUGU_SCRIPT } from '../brain/language.ts';
import { FIXED_ENGLISH, withFixedEnglish } from './fixed-english.ts';
import { PHRASES } from './phrases.ts';

Deno.test('fixed english › every pair is one line, has Telugu, and differs from its English', () => {
  assert(FIXED_ENGLISH.length > 0);
  for (const pair of FIXED_ENGLISH) {
    assert(!pair.te.includes('\n') && !pair.en.includes('\n'), pair.te);
    assert(TELUGU_SCRIPT.test(pair.te), pair.te);
    assert(pair.te !== pair.en, pair.te);
  }
});

Deno.test('fixed english › pairs come from phrases.ts, nested objects too; functions and multi-line skipped', () => {
  const te = PHRASES.te;
  const en = PHRASES.en;
  const has = (t: string, e: string): boolean =>
    FIXED_ENGLISH.some((pair) => pair.te === t && pair.en === e);
  assert(has(te.heard, en.heard));
  assert(has(te.balanceAfter, en.balanceAfter));
  assert(has(te.voiceProblem.cap, en.voiceProblem.cap));
  assert(has(te.promiseStatus.kept, en.promiseStatus.kept));
  assert(!FIXED_ENGLISH.some((pair) => pair.te === te.help));
  assert(!FIXED_ENGLISH.some((pair) => pair.te === te.save)); // "Save" in both
});

Deno.test('fixed english › longest Telugu first', () => {
  const lengths = FIXED_ENGLISH.map((pair) => pair.te.length);
  assertEquals(lengths, [...lengths].sort((a, b) => b - a));
  assertEquals(withFixedEnglish('తర్వాత బాకీ: ₹3,500').text, 'Balance after: ₹3,500');
});

Deno.test('fixed english › a label starting a line is swapped and recorded', () => {
  assertEquals(withFixedEnglish('🎤 విన్నది: “Ramesh ki 5000 …”'), {
    text: '🎤 Heard: “Ramesh ki 5000 …”',
    labels: ['🎤 Heard'],
  });
  assertEquals(withFixedEnglish('బాకీ: ₹8,500\nగడువు: Sun 15 Nov'), {
    text: 'Balance: ₹8,500\ndue: Sun 15 Nov',
    labels: ['Balance', 'due'],
  });
});

Deno.test('fixed english › never in the middle of a line', () => {
  const sentence = 'Ramesh కి బాకీ ₹5,000 ఉంది';
  assertEquals(withFixedEnglish(sentence), { text: sentence, labels: [] });
});

Deno.test('fixed english › a longer word (a letter, combining mark or digit after) is not the label', () => {
  assertEquals(withFixedEnglish('బాకీలు: 3').text, 'బాకీలు: 3');
  assertEquals(withFixedEnglish('అప్పుని ఇచ్చాను').text, 'అప్పుని ఇచ్చాను');
  // ం (anusvara) is a combining mark (\p{M}), not a letter: "వద్దు" + "ం" is another word.
  assert(/^\p{M}$/u.test('ం'));
  assertEquals(withFixedEnglish('వద్దుం').text, 'వద్దుం');
  assertEquals(withFixedEnglish('వద్దు').text, 'No');
  assertEquals(withFixedEnglish('అప్పు2').text, 'అప్పు2');
});
