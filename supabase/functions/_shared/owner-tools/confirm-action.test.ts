// supabase/functions/_shared/owner-tools/confirm-action.test.ts
// The confirm gate (M8 B1, Decision 5; money + LLM-output validation, 100%): every refusal, the
// 2-second rule, the 3-minute expiry, one write per action even with two confirms at once, and
// what happens to the action when the write fails or the executor refuses. Fake clock and fake
// book; FAKE DATA ONLY.
import { assert, assertEquals, assertRejects } from '@std/assert';
import { FAKE_OWNER, RAMESH } from '../db/fake-book-repository.ts';
import { FAKE_NOW } from '../db/fake-repository.ts';
import type { VoiceAction } from '../db/voice-action-repository.ts';
import { type CountedContext, later, ownerContext } from './__fixtures__/context.ts';
import { MIN_CONFIRM_DELAY_MS, VOICE_ACTION_TTL_MS } from './actions.ts';
import { cancelAction } from './cancel-action.ts';
import { confirmAction } from './confirm-action.ts';
import { prepareCredit } from './prepare-credit.ts';
import { prepareRemind } from './prepare-remind.ts';
import { runOwnerTool } from './registry.ts';
import type { OwnerToolContext } from './types.ts';

const OTHER_CALL_ID = 'ca000000-0000-4000-8000-0000000000b2';
const AFTER_REPLY_MS = 5_000;

function credit(context: CountedContext, amount = 5000): ReturnType<typeof prepareCredit> {
  return prepareCredit(context.ctx, { name: 'Ramesh', amount, due_date: undefined });
}

function confirm(context: CountedContext, ref = 'r1'): ReturnType<typeof confirmAction> {
  return confirmAction(context.ctx, { action_ref: ref });
}

function entriesOf(context: CountedContext): number {
  return context.book.entries.length;
}

function statusOf(context: CountedContext, ref: string): string | undefined {
  return context.actions.actions.find((action) => action.ref === ref)?.status;
}

function codeOf(outcome: Awaited<ReturnType<typeof confirmAction>>): string {
  return outcome.result.ok ? 'ok' : outcome.result.code;
}

async function preparedCredit(): Promise<CountedContext> {
  const context = ownerContext();
  await credit(context);
  return context;
}

function withWrites(
  context: CountedContext,
  writes: Partial<OwnerToolContext['writes']>,
): CountedContext {
  return { ...context, ctx: { ...context.ctx, writes: { ...context.ctx.writes, ...writes } } };
}

function otherCallAction(overrides: Partial<VoiceAction> = {}): VoiceAction {
  return {
    id: crypto.randomUUID(),
    ownerId: FAKE_OWNER.id,
    ownerCallId: OTHER_CALL_ID,
    kind: 'voice_remind',
    ref: 'r1',
    data: { shopkeeperId: RAMESH.id, name: 'Ramesh' },
    status: 'open',
    createdAt: new Date(FAKE_NOW.getTime() - 10_000).toISOString(),
    expiresAt: new Date(FAKE_NOW.getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

Deno.test('confirm › with nothing prepared → NO_OPEN_ACTION and nothing written', async () => {
  const context = ownerContext();
  const before = entriesOf(context);

  const outcome = await confirm(later(context, AFTER_REPLY_MS));

  assertEquals(codeOf(outcome), 'NO_OPEN_ACTION');
  assertEquals(entriesOf(context), before);
  assert(!/\d/.test(outcome.result.say), 'a refusal carries no figures');
});

Deno.test('confirm › a wrong ref → WRONG_REF, and the change still waits', async () => {
  const context = await preparedCredit();

  const outcome = await confirm(later(context, AFTER_REPLY_MS), 'r7');

  assertEquals(codeOf(outcome), 'WRONG_REF');
  assertEquals(statusOf(context, 'r1'), 'open');
});

Deno.test('confirm › the old ref after a new prepare → WRONG_REF; the new ref works', async () => {
  const context = await preparedCredit();
  await credit(later(context, 1_000), 3000);
  const before = entriesOf(context);

  const old = await confirm(later(context, AFTER_REPLY_MS), 'r1');
  const latest = await confirm(later(context, AFTER_REPLY_MS), 'r2');

  assertEquals([codeOf(old), codeOf(latest)], ['WRONG_REF', 'ok']);
  assertEquals(entriesOf(context), before + 1);
  assertEquals(context.book.entries.at(-1)?.amount, 3000);
});

Deno.test('confirm › a new prepare cancels the open one (one open action per call)', async () => {
  const context = await preparedCredit();

  await credit(later(context, 1_000), 3000);

  assertEquals([statusOf(context, 'r1'), statusOf(context, 'r2')], ['cancelled', 'open']);
});

Deno.test('confirm › the ref is copied loosely: " R1 " still counts', async () => {
  const context = await preparedCredit();

  const outcome = await confirm(later(context, AFTER_REPLY_MS), ' R1 ');

  assertEquals(codeOf(outcome), 'ok');
});

Deno.test('confirm › under 2 seconds → TOO_SOON and the change is dropped; a retry is refused', async () => {
  const context = await preparedCredit();
  const before = entriesOf(context);

  const soon = await confirm(later(context, MIN_CONFIRM_DELAY_MS - 1));
  const retry = await confirm(later(context, MIN_CONFIRM_DELAY_MS));

  assertEquals([codeOf(soon), codeOf(retry)], ['TOO_SOON', 'NO_OPEN_ACTION']);
  assertEquals(statusOf(context, 'r1'), 'cancelled');
  assertEquals(entriesOf(context), before);
});

Deno.test('confirm › at 2 seconds or more after the prepare → done', async () => {
  const context = await preparedCredit();
  const before = entriesOf(context);

  const enough = await confirm(later(context, MIN_CONFIRM_DELAY_MS));

  assertEquals(codeOf(enough), 'ok');
  assertEquals(entriesOf(context), before + 1);
});

Deno.test('confirm › at 3 minutes → ACTION_EXPIRED, marked expired, and stays refused', async () => {
  const context = await preparedCredit();
  const before = entriesOf(context);

  const first = await confirm(later(context, VOICE_ACTION_TTL_MS));
  const again = await confirm(later(context, VOICE_ACTION_TTL_MS + 1_000));

  assertEquals([codeOf(first), codeOf(again)], ['ACTION_EXPIRED', 'ACTION_EXPIRED']);
  assertEquals(statusOf(context, 'r1'), 'expired');
  assertEquals(entriesOf(context), before);
});

Deno.test('confirm › just before 3 minutes still works', async () => {
  const context = await preparedCredit();

  const outcome = await confirm(later(context, VOICE_ACTION_TTL_MS - 1));

  assertEquals(codeOf(outcome), 'ok');
});

Deno.test('confirm › a second confirm → ALREADY_DONE with exactly one write', async () => {
  const context = await preparedCredit();
  const before = entriesOf(context);

  const first = await confirm(later(context, AFTER_REPLY_MS));
  const second = await confirm(later(context, AFTER_REPLY_MS + 1_000));

  assertEquals([codeOf(first), codeOf(second)], ['ok', 'ALREADY_DONE']);
  assertEquals(entriesOf(context), before + 1);
  assertEquals(statusOf(context, 'r1'), 'saved');
});

Deno.test('confirm › two confirms at the same moment → one write, the other ALREADY_DONE', async () => {
  const context = await preparedCredit();
  const before = entriesOf(context);
  const now = later(context, AFTER_REPLY_MS);

  const outcomes = await Promise.all([confirm(now), confirm(now)]);

  assertEquals(outcomes.map(codeOf).sort(), ['ALREADY_DONE', 'ok']);
  assertEquals(entriesOf(context), before + 1);
});

Deno.test("confirm › another owner call's action is never run from this call", async () => {
  const other = otherCallAction();
  const context = ownerContext({ actions: [other] });

  const none = await confirm(later(context, AFTER_REPLY_MS), 'r1');
  await prepareRemind(context.ctx, { name: 'Ramesh' });
  const wrong = await confirm(later(context, AFTER_REPLY_MS), 'r9');

  assertEquals([codeOf(none), codeOf(wrong)], ['NO_OPEN_ACTION', 'WRONG_REF']);
  assertEquals(context.actions.actions.find((action) => action.id === other.id)?.status, 'open');
  assertEquals(context.queued, []);
});

Deno.test('confirm › cancel, then confirm → NO_OPEN_ACTION and nothing written', async () => {
  const context = await preparedCredit();
  const before = entriesOf(context);

  await cancelAction(later(context, 3_000).ctx, { action_ref: 'r1' });
  const outcome = await confirm(later(context, AFTER_REPLY_MS));

  assertEquals(codeOf(outcome), 'NO_OPEN_ACTION');
  assertEquals(entriesOf(context), before);
});

Deno.test('confirm › a failed write puts the action back to open, with the safe line', async () => {
  const prepared = await preparedCredit();
  const failing = withWrites(later(prepared, AFTER_REPLY_MS), {
    book: {
      ...prepared.ctx.writes.book,
      insertEntry: () => Promise.reject(new Error('timeout')),
    },
  });

  const run = await runOwnerTool('confirm_action', { action_ref: 'r1' }, failing.ctx);

  assertEquals(run.result.ok ? 'ok' : run.result.code, 'TEMPORARY_ERROR');
  assertEquals(statusOf(prepared, 'r1'), 'open');
  const retry = await confirm(later(prepared, AFTER_REPLY_MS + 1_000));
  assertEquals(codeOf(retry), 'ok');
});

Deno.test('confirm › a failure in the run that lost the race never reopens the winner', async () => {
  const context = await preparedCredit();
  const now = later(context, AFTER_REPLY_MS);
  let reads = 0;
  const secondReadFails = {
    ...now.ctx.reads,
    book: {
      ...now.ctx.reads.book,
      listShopkeeperEntries: (id: string) => {
        reads += 1;
        return reads === 1
          ? now.ctx.reads.book.listShopkeeperEntries(id)
          : Promise.reject(new Error('timeout'));
      },
    },
  };
  const ctx = { ...now.ctx, reads: secondReadFails };

  const [first, second] = await Promise.allSettled([
    confirmAction(ctx, { action_ref: 'r1' }),
    confirmAction(ctx, { action_ref: 'r1' }),
  ]);

  assertEquals([first.status, second.status], ['fulfilled', 'rejected']);
  assertEquals(statusOf(context, 'r1'), 'saved');
});

Deno.test('confirm › a refused change (blocked call) is closed and cannot be confirmed again', async () => {
  const context = ownerContext({
    queueCall: () => Promise.resolve({ ok: false, code: 'DO_NOT_CALL' }),
  });
  await prepareRemind(context.ctx, { name: 'Ramesh' });

  const blocked = await confirm(later(context, AFTER_REPLY_MS));
  const again = await confirm(later(context, AFTER_REPLY_MS + 1_000));

  assertEquals([codeOf(blocked), codeOf(again)], ['CALL_BLOCKED', 'NO_OPEN_ACTION']);
  assertEquals(statusOf(context, 'r1'), 'cancelled');
});

Deno.test('confirm › a stored payload that fails its schema is closed, never run', async () => {
  const broken = otherCallAction({
    ownerCallId: ownerContext().ctx.ownerCall.id,
    kind: 'voice_credit',
    data: { shopkeeperId: RAMESH.id, name: 'Ramesh', amount: -5, dueDate: 'soon' },
  });
  const context = ownerContext({ actions: [broken] });
  const before = entriesOf(context);

  const outcome = await confirm(context);

  assertEquals(codeOf(outcome), 'TEMPORARY_ERROR');
  assertEquals(statusOf(context, 'r1'), 'cancelled');
  assertEquals(entriesOf(context), before);
});

Deno.test('confirm › database errors before the claim are thrown, nothing changes', async () => {
  const context = await preparedCredit();
  const failing = withWrites(context, {
    actions: {
      ...context.ctx.writes.actions,
      latestVoiceActions: () => Promise.reject(new Error('timeout')),
    },
  });

  await assertRejects(() => confirm(later(failing, AFTER_REPLY_MS)));
  assertEquals(statusOf(context, 'r1'), 'open');
});
