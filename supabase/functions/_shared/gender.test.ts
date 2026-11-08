// supabase/functions/_shared/gender.test.ts
import { assertEquals } from '@std/assert';
import { genderOf } from './gender.ts';

Deno.test('gender › listed first names, any case, first word of a full name', () => {
  assertEquals(genderOf('Radha'), 'female');
  assertEquals(genderOf('sujatha'), 'female');
  assertEquals(genderOf('Ramesh'), 'male');
  assertEquals(genderOf('  Srinivas Reddy '), 'male');
});

Deno.test('gender › names for either, unknown names and blanks → neutral', () => {
  assertEquals(genderOf('Kiran'), 'neutral');
  assertEquals(genderOf('Zorawar'), 'neutral');
  assertEquals(genderOf('You'), 'neutral');
  assertEquals(genderOf(''), 'neutral');
});
