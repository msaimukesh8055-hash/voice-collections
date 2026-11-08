// supabase/functions/_shared/owner-tools/read-back.test.ts
// Munshi's read-backs talk about women and men shopkeepers (Radha, Sujatha, Ramesh…), so the
// words about the shopkeeper never assume "he" or "his" (M7 B2 wording fix).
import { assert, assertEquals } from '@std/assert';
import { balanceChange, balanceNow } from './read-back.ts';
import { OWNER_TOOL_ERRORS } from './types.ts';

const GENDERED = /\b(he|his|him|she|her|hers)\b/i;

Deno.test('read-back › balance lines name no gender', () => {
  assertEquals(balanceChange(8500, 13500), 'Balance goes from 8,500 rupees to 13,500 rupees.');
  assertEquals(balanceChange(8500, 8500), 'Balance stays 8,500 rupees.');
  assertEquals(balanceNow(13500), 'Balance is now 13,500 rupees.');
});

Deno.test('read-back › errors about the shopkeeper name no gender', () => {
  const aboutTheShopkeeper = [
    OWNER_TOOL_ERRORS.NOTHING_TO_DELETE.split('. Ask')[0] ?? '',
    OWNER_TOOL_ERRORS.NO_OPEN_CLAIM,
    OWNER_TOOL_ERRORS.CALL_BLOCKED,
    OWNER_TOOL_ERRORS.NOTHING_OWED,
    OWNER_TOOL_ERRORS.BOOK_CHANGED,
  ];
  for (const text of aboutTheShopkeeper) assert(!GENDERED.test(text), text);
});
