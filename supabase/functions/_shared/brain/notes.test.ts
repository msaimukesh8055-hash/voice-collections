// supabase/functions/_shared/brain/notes.test.ts
// Empty-content notes are dropped; real ones are kept as written.
import { assertEquals } from '@std/assert';
import { meaningfulNote } from './notes.ts';

Deno.test('notes › "Given today", "credit given" and friends are dropped (EN/HI/TE)', () => {
  const empty = [
    'Given today',
    'credit given',
    'Credit given today.',
    'udhaar diya',
    'aaj udhaar',
    'आज उधार दिया',
    'appu ichanu',
    'ఈరోజు అప్పు ఇచ్చాను',
    '  ',
    '',
  ];
  for (const note of empty) assertEquals(meaningfulNote(note), null, note);
  assertEquals(meaningfulNote(null), null);
  assertEquals(meaningfulNote(undefined), null);
});

Deno.test('notes › a note with real content is kept, exactly as written', () => {
  assertEquals(meaningfulNote('rice bags'), 'rice bags');
  assertEquals(meaningfulNote('Given today: 2 rice bags'), 'Given today: 2 rice bags');
  assertEquals(meaningfulNote('चावल के बोरे'), 'चावल के बोरे');
  assertEquals(meaningfulNote(' బియ్యం బస్తాలు '), 'బియ్యం బస్తాలు');
});
