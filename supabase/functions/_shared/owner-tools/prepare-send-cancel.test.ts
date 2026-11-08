// supabase/functions/_shared/owner-tools/prepare-send-cancel.test.ts
// prepare_send + confirm (M8 B5: nothing kicked before his yes, one kick with the action id after)
// and cancel_action (closes the open change in one round; nothing changes). FAKE DATA ONLY.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { RAMESH } from '../db/fake-book-repository.ts';
import { type CountedContext, later, ownerContext } from './__fixtures__/context.ts';
import { cancelAction, CANCELLED_SAY, NOTHING_WAITING_SAY } from './cancel-action.ts';
import { confirmAction } from './confirm-action.ts';
import { prepareSend, sendLabel, WHOSE_STATEMENT_SAY } from './prepare-send.ts';
import { checkedAmount, normaliseRef, refFor } from './actions.ts';

const YES_AFTER_MS = 5_000;

function confirm(context: CountedContext): ReturnType<typeof confirmAction> {
  return confirmAction(later(context, YES_AFTER_MS).ctx, { action_ref: 'r1' });
}

Deno.test('prepare_send › reads back what goes out; nothing is kicked before his yes', async () => {
  const context = ownerContext();

  const { result } = await prepareSend(context.ctx, { what: 'pending', name: undefined });

  assert(result.ok);
  assertStringIncludes(
    result.say,
    'send the pending list to you on WhatsApp. Nothing goes out until he says yes',
  );
  assertEquals(context.kicked, []);
  assertEquals(context.calls, [
    'countVoiceActions',
    'cancelOpenVoiceActions',
    'createVoiceAction',
    'cancelOpenVoiceActions',
  ]);
});

Deno.test('prepare_send › a statement needs a name, and resolves it', async () => {
  const context = ownerContext();

  const missing = await prepareSend(context.ctx, { what: 'statement', name: undefined });
  const ok = await prepareSend(context.ctx, { what: 'statement', name: 'Ramesh' });
  const unclear = await prepareSend(context.ctx, { what: 'statement', name: 'Praveen' });

  assertEquals([missing.result.ok ? 'ok' : missing.result.code, missing.result.say], [
    'INVALID_ARGS',
    WHOSE_STATEMENT_SAY,
  ]);
  assertStringIncludes(ok.result.say, "send Ramesh's statement");
  assertEquals(context.actions.actions[0]?.data, {
    what: 'statement',
    shopkeeperId: RAMESH.id,
    name: 'Ramesh',
  });
  assertStringIncludes(unclear.result.say, 'More than one shopkeeper fits');
});

Deno.test('confirm send › kicks /owner-send once with the action id, answers at once', async () => {
  const context = ownerContext();
  await prepareSend(context.ctx, { what: 'due', name: undefined });

  const first = await confirm(context);
  const again = await confirm(later(context, 1_000));

  assert(first.result.ok);
  assertStringIncludes(first.result.say, "Sending today's due list on WhatsApp now.");
  assertEquals(context.kicked, [context.actions.actions[0]?.id]);
  assertEquals(again.result.ok ? 'ok' : again.result.code, 'ALREADY_DONE');
});

Deno.test('sendLabel › every kind, and a statement without a name', () => {
  assertEquals(
    [
      sendLabel('pending', null),
      sendLabel('due', null),
      sendLabel('insights', null),
      sendLabel('statement', 'Latha'),
      sendLabel('statement', null),
    ],
    ['the pending list', "today's due list", 'the insights', "Latha's statement", 'the statement'],
  );
});

Deno.test('cancel_action › closes the open change; confirm then has nothing to run', async () => {
  const context = ownerContext();
  await prepareSend(context.ctx, { what: 'insights', name: undefined });

  const { result } = await cancelAction(later(context, 3_000).ctx, { action_ref: undefined });

  assertEquals(result.say, CANCELLED_SAY);
  assertEquals(context.actions.actions[0]?.status, 'cancelled');
  assertEquals(context.kicked, []);
});

Deno.test('cancel_action › with nothing waiting says so; one round only', async () => {
  const context = ownerContext();

  const { result } = await cancelAction(context.ctx, { action_ref: 'r1' });

  assertEquals(result.say, NOTHING_WAITING_SAY);
  assertEquals(context.calls, ['cancelOpenVoiceActions']);
});

Deno.test('actions › refs count up per call and are read loosely; amounts checked', () => {
  assertEquals([refFor(0), refFor(4)], ['r1', 'r5']);
  assertEquals(normaliseRef(' R12 '), 'r12');
  assertEquals(
    [checkedAmount(100), checkedAmount(0), checkedAmount(Number.POSITIVE_INFINITY)],
    [100, null, null],
  );
});
