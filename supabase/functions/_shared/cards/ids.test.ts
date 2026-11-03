// supabase/functions/_shared/cards/ids.test.ts
import { assertEquals } from '@std/assert';
import { cardButtonId, claimButtonId, lookupRowId, parseTap, pickRowId } from './ids.ts';

const ID = 'ac000000-0000-4000-8000-000000000001';

Deno.test('ids › card, pick, claim and lookup ids round-trip', () => {
  assertEquals(parseTap(cardButtonId(ID, 'save')), { kind: 'card', actionId: ID, verb: 'save' });
  assertEquals(parseTap(pickRowId(ID, 3)), { kind: 'pick', actionId: ID, index: 3 });
  assertEquals(parseTap(claimButtonId(ID, true, 'te')), {
    kind: 'claim',
    entryId: ID,
    confirm: true,
    language: 'te',
  });
  assertEquals(parseTap(claimButtonId(ID, false, 'en'))?.kind, 'claim');
  assertEquals(parseTap(lookupRowId(ID, 'hi')), {
    kind: 'lookup',
    shopkeeperId: ID,
    language: 'hi',
  });
});

Deno.test('ids › ids we never sent are rejected', () => {
  for (
    const id of [
      '',
      'c:not-a-uuid:save',
      `c:${ID}:delete`,
      `c:${ID}:p10`,
      `cl:${ID}:ok:fr`,
      `cl:${ID}:maybe:en`,
      `lk:${ID}:xx`,
      `x:${ID}`,
    ]
  ) {
    assertEquals(parseTap(id), null, id);
  }
});
