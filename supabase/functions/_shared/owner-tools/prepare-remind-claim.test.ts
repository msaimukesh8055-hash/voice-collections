// supabase/functions/_shared/owner-tools/prepare-remind-claim.test.ts
// prepare_remind and prepare_claim + confirm (M8 B4). Remind: the read-back promises a call after
// this one, confirm goes through queueCall (live) once, each pre-call block is told in plain
// words and queues nothing. Claims (money): received → confirmed and the balance drops; not
// received → rejected; several → which one; none → NO_OPEN_CLAIM; a WhatsApp card tap afterwards
// says "already done". Ramesh has one 2,000 rupee UPI claim on Sun 1 Nov. FAKE DATA ONLY.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { botSetup } from '../cards/__fixtures__/bot-context.ts';
import { handleClaimTap } from '../cards/claims.ts';
import type { QueueCallResult } from '../calls/queue-call.ts';
import { bookEntry, CLAIM_ID, fakeBookEntries, LATHA, RAMESH } from '../db/fake-book-repository.ts';
import { computeDues } from '../ledger/dues.ts';
import type { RemindBlock } from '../reminders/phrases.ts';
import { phrasesFor } from '../whatsapp/phrases.ts';
import { replyText } from '../whatsapp/replies.ts';
import { type CountedContext, later, ownerContext } from './__fixtures__/context.ts';
import { confirmAction } from './confirm-action.ts';
import { ALREADY_SETTLED_SAY, prepareClaim } from './prepare-claim.ts';
import { prepareRemind } from './prepare-remind.ts';

const YES_AFTER_MS = 5_000;

function confirm(context: CountedContext): ReturnType<typeof confirmAction> {
  return confirmAction(later(context, YES_AFTER_MS).ctx, { action_ref: 'r1' });
}

function claimStatus(context: CountedContext, id = CLAIM_ID): string | undefined {
  return context.book.entries.find((entry) => entry.id === id)?.status;
}

function outstanding(context: CountedContext): number {
  const entries = context.book.entries.filter((entry) => entry.shopkeeperId === RAMESH.id);
  return computeDues(entries, context.ctx.today).outstanding;
}

Deno.test('prepare_remind › reads back "Asha calls after this call", queues nothing yet', async () => {
  const context = ownerContext();

  const { result } = await prepareRemind(context.ctx, { name: 'Ramesh' });

  assert(result.ok);
  assertStringIncludes(result.say, 'Asha will call Ramesh right after this call ends.');
  assertEquals(context.queued, []);
  assertEquals(context.calls, [
    'listShopkeepers',
    'countVoiceActions',
    'cancelOpenVoiceActions',
    'createVoiceAction',
    'cancelOpenVoiceActions',
  ]);
});

Deno.test('prepare_remind › unclear and unknown names store nothing', async () => {
  const context = ownerContext();

  const unclear = await prepareRemind(context.ctx, { name: 'Praveen' });
  const unknown = await prepareRemind(context.ctx, { name: 'Zebulon' });

  assertStringIncludes(unclear.result.say, 'More than one shopkeeper fits');
  assertEquals(unknown.result.ok ? 'ok' : unknown.result.code, 'NOT_FOUND');
  assertEquals(context.actions.actions, []);
});

Deno.test('confirm remind › one live call queued for him; says Asha calls after this call', async () => {
  const context = ownerContext();
  await prepareRemind(context.ctx, { name: 'Ramesh' });

  const { result } = await confirm(context);

  assert(result.ok);
  assertEquals(context.queued, [RAMESH.id]);
  assertStringIncludes(result.say, 'Asha will call Ramesh right after this call ends.');
});

Deno.test('confirm remind › a call already waiting is not stacked', async () => {
  const context = ownerContext({
    queueCall: () =>
      Promise.resolve({ ok: true, callId: crypto.randomUUID(), alreadyQueued: true }),
  });
  await prepareRemind(context.ctx, { name: 'Ramesh' });

  const { result } = await confirm(context);

  assert(result.ok);
  assertStringIncludes(result.say, 'Asha is already set to call Ramesh');
});

const BLOCKS: ReadonlyArray<readonly [RemindBlock, string]> = [
  ['DO_NOT_CALL', 'Ramesh asked not to be called. No call made.'],
  ['OUTSIDE_CALLING_HOURS', 'Calls are made only between 8 am and 7 pm. No call made.'],
  ['ATTEMPT_LIMIT_REACHED', 'Ramesh has had the most calls allowed for now. No call made.'],
  ['RATE_LIMITED', 'Too many calls to Ramesh just now.'],
  ['NOT_FOUND', 'No shopkeeper called Ramesh.'],
];

for (const [code, words] of BLOCKS) {
  Deno.test(`confirm remind › ${code} → CALL_BLOCKED in plain words, nothing queued`, async () => {
    const blocked: QueueCallResult = { ok: false, code };
    const context = ownerContext({ queueCall: () => Promise.resolve(blocked) });
    await prepareRemind(context.ctx, { name: 'Ramesh' });

    const { result } = await confirm(context);

    assertEquals(result.ok ? 'ok' : result.code, 'CALL_BLOCKED');
    assertStringIncludes(result.say, words);
    assertEquals(context.actions.actions[0]?.status, 'cancelled');
  });
}

Deno.test('prepare_claim › one open claim: reads back amount, date, mode and the balance', async () => {
  const { result } = await prepareClaim(ownerContext().ctx, {
    name: 'Ramesh',
    decision: 'received',
  });

  assert(result.ok);
  assertStringIncludes(
    result.say,
    'Ramesh told Asha he paid 2,000 rupees on Sun 1 Nov by upi.',
  );
  assertStringIncludes(result.say, 'Mark it as received.');
  assertStringIncludes(result.say, 'from 8,500 rupees to 6,500 rupees');
});

Deno.test('prepare_claim › not received: the balance stays', async () => {
  const { result } = await prepareClaim(ownerContext().ctx, {
    name: 'Ramesh',
    decision: 'not_received',
  });

  assert(result.ok);
  assertStringIncludes(result.say, 'Mark it as not received.');
  assertStringIncludes(result.say, 'His balance stays 8,500 rupees.');
});

Deno.test('prepare_claim › no open claim → NO_OPEN_CLAIM; names unclear or unknown store nothing', async () => {
  const context = ownerContext();

  const none = await prepareClaim(context.ctx, { name: 'Latha', decision: 'received' });
  const unclear = await prepareClaim(context.ctx, { name: 'Praveen', decision: 'received' });
  const unknown = await prepareClaim(context.ctx, { name: 'Zebulon', decision: 'received' });

  assertEquals(none.result.ok ? 'ok' : none.result.code, 'NO_OPEN_CLAIM');
  assertStringIncludes(unclear.result.say, 'More than one shopkeeper fits');
  assertEquals(unknown.result.ok ? 'ok' : unknown.result.code, 'NOT_FOUND');
  assertEquals(context.actions.actions, []);
});

Deno.test('prepare_claim › several claims → which one; the amount or date then picks one', async () => {
  const second = bookEntry({
    kind: 'payment',
    amount: 500,
    entryDate: '2026-11-02',
    status: 'claimed',
    paymentMode: 'cash',
  });
  const context = ownerContext({ entries: [...fakeBookEntries(), second] });

  const several = await prepareClaim(context.ctx, { name: 'Ramesh', decision: 'received' });
  const byAmount = await prepareClaim(context.ctx, {
    name: 'Ramesh',
    decision: 'received',
    amount: 500,
  });
  const byDay = await prepareClaim(context.ctx, {
    name: 'Ramesh',
    decision: 'received',
    entry_date: '2026-11-01',
  });

  assertStringIncludes(several.result.say, 'more than one payment claim');
  assertEquals(several.result.ok && several.result.data['choice_count'], 2);
  assertStringIncludes(byAmount.result.say, 'he paid 500 rupees on Mon 2 Nov by cash');
  assertStringIncludes(byDay.result.say, '2,000 rupees');
});

Deno.test('confirm claim › received → confirmed and the balance drops', async () => {
  const context = ownerContext();
  await prepareClaim(context.ctx, { name: 'Ramesh', decision: 'received' });

  const { result } = await confirm(context);

  assert(result.ok);
  assertEquals([claimStatus(context), outstanding(context), result.data['outstanding']], [
    'confirmed',
    6500,
    6500,
  ]);
});

Deno.test('confirm claim › not received → rejected and the balance stays', async () => {
  const context = ownerContext();
  await prepareClaim(context.ctx, { name: 'Ramesh', decision: 'not_received' });

  const { result } = await confirm(context);

  assert(result.ok);
  assertEquals([claimStatus(context), outstanding(context)], ['rejected', 8500]);
  assertStringIncludes(result.say, 'marked not received');
});

Deno.test('confirm claim › settled on WhatsApp meanwhile → refused, nothing changed twice', async () => {
  const context = ownerContext();
  await prepareClaim(context.ctx, { name: 'Ramesh', decision: 'received' });
  await context.ctx.writes.book.settleClaim(CLAIM_ID, 'rejected');

  const { result } = await confirm(context);

  assertEquals([result.ok ? 'ok' : result.code, result.say], [
    'NO_OPEN_CLAIM',
    ALREADY_SETTLED_SAY,
  ]);
  assertEquals(claimStatus(context), 'rejected');
});

Deno.test('confirm claim › a later WhatsApp tap on that claim card says "already done"', async () => {
  const context = ownerContext();
  await prepareClaim(context.ctx, { name: 'Ramesh', decision: 'received' });
  await confirm(context);
  const whatsapp = botSetup({ state: { entries: context.book.entries } });

  const replies = await handleClaimTap(
    { kind: 'claim', entryId: CLAIM_ID, confirm: false, language: 'en' },
    whatsapp.ctx,
  );

  assertEquals(replyText(replies), phrasesFor('en').alreadyHandled);
  assertEquals(whatsapp.state.entries.find((entry) => entry.id === CLAIM_ID)?.status, 'confirmed');
});

Deno.test("prepare_claim › only Ramesh's own claims are considered", async () => {
  const lathaClaim = bookEntry({
    shopkeeperId: LATHA.id,
    kind: 'payment',
    amount: 900,
    entryDate: '2026-11-01',
    status: 'claimed',
  });
  const context = ownerContext({ entries: [...fakeBookEntries(), lathaClaim] });

  const { result } = await prepareClaim(context.ctx, { name: 'Latha', decision: 'received' });

  assertStringIncludes(result.say, '900 rupees');
});
