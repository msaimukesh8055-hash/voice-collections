// supabase/functions/_shared/cards/claims.test.ts
import { assertEquals, assertStringIncludes } from '@std/assert';
import { CLAIM_ID } from '../db/fake-book-repository.ts';
import { computeDues } from '../ledger/dues.ts';
import { replyText } from '../whatsapp/replies.ts';
import { handleClaimTap } from './claims.ts';
import { botSetup } from './__fixtures__/bot-context.ts';

function claimStatus(setup: ReturnType<typeof botSetup>): string | undefined {
  return setup.state.entries.find((entry) => entry.id === CLAIM_ID)?.status;
}

function rameshBalance(setup: ReturnType<typeof botSetup>): number {
  const ramesh = setup.state.entries.filter((e) => e.shopkeeperId === setup.ctx.shopkeepers[0]?.id);
  return computeDues(ramesh, setup.ctx.today).outstanding;
}

Deno.test('claim › Confirm received makes it a confirmed payment and the balance drops', async () => {
  const setup = botSetup();
  const replies = await handleClaimTap({
    kind: 'claim',
    entryId: CLAIM_ID,
    confirm: true,
    language: 'en',
  }, setup.ctx);
  assertEquals(replyText(replies), 'Confirmed. Ramesh now owes ₹6,500.');
  assertEquals([claimStatus(setup), rameshBalance(setup)], ['confirmed', 6500]);
});

Deno.test('claim › Not received marks it rejected and the balance stays', async () => {
  const setup = botSetup();
  const replies = await handleClaimTap({
    kind: 'claim',
    entryId: CLAIM_ID,
    confirm: false,
    language: 'en',
  }, setup.ctx);
  assertEquals(
    replyText(replies),
    'Marked not received. Asha will ask Ramesh about it on the next call.',
  );
  assertEquals([claimStatus(setup), rameshBalance(setup)], ['rejected', 8500]);
});

Deno.test('claim › tapped twice is handled once', async () => {
  const setup = botSetup();
  const confirm = { kind: 'claim', entryId: CLAIM_ID, confirm: true, language: 'hi' } as const;
  await handleClaimTap(confirm, setup.ctx);
  const second = await handleClaimTap({ ...confirm, confirm: false }, setup.ctx);
  assertEquals(replyText(second), 'पहले ही हो चुका है।');
  assertEquals([claimStatus(setup), rameshBalance(setup)], ['confirmed', 6500]);
});

Deno.test('claim › still answers when the shopkeeper list is stale', async () => {
  const setup = botSetup();
  const ctx = { ...setup.ctx, shopkeepers: [] };
  const replies = await handleClaimTap({
    kind: 'claim',
    entryId: CLAIM_ID,
    confirm: true,
    language: 'en',
  }, ctx);
  assertStringIncludes(replyText(replies), 'now owes ₹6,500.');
});
