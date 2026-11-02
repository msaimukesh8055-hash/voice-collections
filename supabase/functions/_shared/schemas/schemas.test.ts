// supabase/functions/_shared/schemas/schemas.test.ts
import { assertEquals } from '@std/assert';
import { LedgerEntrySchema } from './ledger.ts';
import { LanguageSchema, SARVAM_LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from './shopkeeper.ts';

Deno.test('schemas › Telugu, Hindi and English, each with a Sarvam language name', () => {
  assertEquals([...SUPPORTED_LANGUAGES], ['te', 'hi', 'en']);
  assertEquals(SARVAM_LANGUAGE_NAMES.te, 'Telugu');
  assertEquals(LanguageSchema.safeParse('ta').success, false);
});

Deno.test('schemas › a ledger entry needs a positive amount and ISO dates', () => {
  const entry = {
    kind: 'credit',
    amount: '5000',
    entryDate: '2026-10-06',
    dueDate: '2026-10-21',
    status: 'confirmed',
  };
  assertEquals(LedgerEntrySchema.parse(entry).amount, 5000);
  assertEquals(LedgerEntrySchema.safeParse({ ...entry, amount: 0 }).success, false);
  assertEquals(LedgerEntrySchema.safeParse({ ...entry, dueDate: '21/10/2026' }).success, false);
});
