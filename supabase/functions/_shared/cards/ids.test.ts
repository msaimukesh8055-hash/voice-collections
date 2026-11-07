// supabase/functions/_shared/cards/ids.test.ts
import { assertEquals } from '@std/assert';
import {
  cardButtonId,
  claimButtonId,
  fullPaymentButtonId,
  lookupRowId,
  MENU_TARGETS,
  menuRowId,
  noCallButtonId,
  parseTap,
  partPaymentButtonId,
  pickRowId,
  remindAllButtonId,
  remindButtonId,
} from './ids.ts';

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

Deno.test('ids › remind one and remind all round-trip (M5)', () => {
  assertEquals(parseTap(remindButtonId(ID, 'te')), {
    kind: 'remind',
    shopkeeperId: ID,
    language: 'te',
  });
  assertEquals(parseTap(remindAllButtonId('en')), { kind: 'remind_all', language: 'en' });
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
      `rm:${ID}:xx`,
      'rm:not-a-uuid:en',
      'ra:fr',
      'ra:',
      `x:${ID}`,
      'mn:pending:fr',
      'mn:delete:en',
      'mn::en',
      'mn:pending',
      'mn:Pending:en',
      `pf:${ID}:xx`,
      'pf:not-a-uuid:en',
      `pf:${ID}`,
      `pp:${ID}:fr`,
      'pp:12345:en',
      `pf:${ID}:en:5000`,
      // Tests — Build A (tester): tampered ids
      'mn:__proto__:en',
      'mn:constructor:en',
      'mn:pending:en:5000',
      `pf:${ID.toUpperCase()}:en`,
      `pf:5000:${ID}:en`,
      `pf:${ID}:en
`,
      ` pf:${ID}:en`,
      `pp:${ID}:en:5000`,
      `pf:${ID}x:en`,
    ]
  ) {
    assertEquals(parseTap(id), null, id);
  }
});

Deno.test('ids › the "no call" Cancel id round-trips; a bad language is rejected', () => {
  assertEquals(parseTap(noCallButtonId('te')), { kind: 'no_call', language: 'te' });
  assertEquals(parseTap('nc:fr'), null);
});

Deno.test('ids › M7: every menu row and the [Menu] button round-trip', () => {
  assertEquals(MENU_TARGETS, [
    'pending',
    'due',
    'add',
    'paid',
    'closed',
    'insights',
    'dashboard',
    'remind_all',
    'menu',
  ]);
  for (const item of MENU_TARGETS) {
    for (const language of ['en', 'hi', 'te'] as const) {
      assertEquals(parseTap(menuRowId(item, language)), { kind: 'menu', item, language });
    }
  }
  assertEquals(menuRowId('remind_all', 'te'), 'mn:remind_all:te');
});

Deno.test('ids › M7: Paid in full and Part payment carry only a shopkeeper id and a language', () => {
  assertEquals(fullPaymentButtonId(ID, 'hi'), `pf:${ID}:hi`);
  assertEquals(parseTap(fullPaymentButtonId(ID, 'hi')), {
    kind: 'full_payment',
    shopkeeperId: ID,
    language: 'hi',
  });
  assertEquals(parseTap(partPaymentButtonId(ID, 'te')), {
    kind: 'part_payment',
    shopkeeperId: ID,
    language: 'te',
  });
});
