// supabase/functions/_shared/whatsapp/owner-call-phrase.test.ts
// "call Munshi" in any of the owner's words (2026-11-08 bug: it was read as a shopkeeper name):
// English, Latin-letter Hindi and Telugu, Devanagari and Telugu script, any case or punctuation.
// Anything with other words in it (a real sentence about a shopkeeper) is not a Munshi request.
import { assert, assertFalse } from '@std/assert';
import { isOwnerCallRequest } from './owner-call-phrase.ts';

const MUNSHI_PHRASES = [
  'Munshi',
  'munshi',
  'MUNSHI',
  'call Munshi',
  'Call munshi',
  'call munshi now',
  'Call Munshi please',
  'please call munshi',
  'munshi call',
  'Munshi ko call karo',
  'munshi ji',
  'talk to munshi',
  'open munshi',
  'munshee',
  '📞 Call Munshi',
  'call Munshi!',
  '  munshi.  ',
  'मुंशी',
  'मुनशी',
  'मुन्शी',
  'मुंशी को कॉल करो',
  'మున్షీ',
  'మున్షి',
  'మున్షీకి కాల్',
  'మున్షీకి కాల్ చేయి',
];

const NOT_MUNSHI = [
  '',
  'call',
  'call Ramesh',
  'Ramesh',
  'munshi Ramesh 5000',
  'Ramesh paid munshi 2000',
  'who is munshi and why does he call me every day',
  'munshipalli',
  'munshi munshi munshi munshi munshi munshi',
];

Deno.test('owner call phrase › every Munshi phrase is a request for the owner call link', () => {
  for (const phrase of MUNSHI_PHRASES) assert(isOwnerCallRequest(phrase), phrase);
});

Deno.test('owner call phrase › a zero-width joiner typed inside a word changes nothing', () => {
  const joiner = String.fromCodePoint(0x200c);
  assert(isOwnerCallRequest(`మున్షీకి కాల్${joiner}`));
  assertFalse(isOwnerCallRequest(`munshi 2000${joiner}`));
});

Deno.test('owner call phrase › other words, names and sentences are not', () => {
  for (const phrase of NOT_MUNSHI) assertFalse(isOwnerCallRequest(phrase), phrase);
});
