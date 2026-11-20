// supabase/functions/_shared/owner-tools/confirm-race.test.ts
// Two confirms of the same change at the same moment, for every kind (M8 B1, money, 100%): only
// one wins the compare-and-set and writes; the other says ALREADY_DONE. A confirm that a prepare
// replaces at the same moment says REPLACED_NOT_SAVED (gate case 12, 2026-11-20), and a prepare
// waits before replacing a change that could be confirmed, so a confirm sent with it wins. Plus the tool schemas'
// "left out" rule for optional fields. FAKE DATA ONLY.
import { assertEquals } from '@std/assert';
import { type CountedContext, later, ownerContext } from './__fixtures__/context.ts';
import { confirmAction } from './confirm-action.ts';
import { prepareClaim } from './prepare-claim.ts';
import { prepareDelete } from './prepare-delete.ts';
import { preparePayment } from './prepare-payment.ts';
import { prepareRemind } from './prepare-remind.ts';
import { prepareSend } from './prepare-send.ts';
import { OWNER_TOOL_SPECS } from './schemas.ts';

type Prepare = (context: CountedContext) => Promise<unknown>;

const KINDS: ReadonlyArray<readonly [string, Prepare]> = [
  ['payment', (c) => preparePayment(c.ctx, { name: 'Ramesh', amount: 100, full: undefined })],
  ['delete', (c) => prepareDelete(c.ctx, { name: 'Ramesh' })],
  ['remind', (c) => prepareRemind(c.ctx, { name: 'Ramesh' })],
  ['claim', (c) => prepareClaim(c.ctx, { name: 'Ramesh', decision: 'received' })],
  ['send', (c) => prepareSend(c.ctx, { what: 'pending', name: undefined })],
];

for (const [kind, prepare] of KINDS) {
  Deno.test(`confirm race › ${kind}: two confirms at once → one done, one ALREADY_DONE`, async () => {
    const context = ownerContext();
    await prepare(context);
    const now = later(context, 5_000);

    const outcomes = await Promise.all([
      confirmAction(now.ctx, { action_ref: 'r1' }),
      confirmAction(now.ctx, { action_ref: 'r1' }),
    ]);

    const codes = outcomes.map((outcome) => outcome.result.ok ? 'ok' : outcome.result.code);
    assertEquals(codes.sort(), ['ALREADY_DONE', 'ok']);
    assertEquals(context.queued.length + context.kicked.length <= 1, true);
  });
}

Deno.test('confirm race › a prepare that replaces the change mid-confirm → REPLACED_NOT_SAVED', async () => {
  // Gate case 12 (2026-11-20): Munshi sent confirm r1 and the next prepare together; the prepare
  // cancelled r1 just before the confirm could save it. Nothing was saved, so never "already done".
  const context = ownerContext();
  await preparePayment(context.ctx, { name: 'Ramesh', amount: 100, full: undefined });
  const entriesBefore = context.book.entries.length;
  const now = later(context, 5_000);
  const actions = now.ctx.writes.actions;
  async function replacedFirst(
    ...args: Parameters<typeof actions.transitionVoiceAction>
  ): Promise<boolean> {
    await actions.cancelOpenVoiceActions(now.ctx.ownerCall.id, now.ctx.realNow.toISOString());
    return actions.transitionVoiceAction(...args);
  }
  const racing = {
    ...now,
    ctx: {
      ...now.ctx,
      writes: { ...now.ctx.writes, actions: { ...actions, transitionVoiceAction: replacedFirst } },
    },
  };

  const outcome = await confirmAction(racing.ctx, { action_ref: 'r1' });

  assertEquals(outcome.result.ok ? 'ok' : outcome.result.code, 'REPLACED_NOT_SAVED');
  assertEquals(context.book.entries.length, entriesBefore);
});

Deno.test('prepare grace › "yes, and also…": a confirm sent with the next prepare still saves', async () => {
  // Gate cases 12 and 13 (2026-11-20, run 4): the prepare used to cancel r1 first.
  const context = ownerContext();
  await preparePayment(context.ctx, { name: 'Ramesh', amount: 100, full: undefined });
  const now = later(context, 5_000);
  const confirmed: { ok: boolean | null } = { ok: null };
  async function confirmDuringWait(): Promise<void> {
    confirmed.ok = (await confirmAction(now.ctx, { action_ref: 'r1' })).result.ok;
  }
  const racing = { ...now.ctx, pause: confirmDuringWait };

  const next = await prepareRemind(racing, { name: 'Ramesh' });

  assertEquals(confirmed.ok, true);
  assertEquals(next.result.ok, true);
  assertEquals(context.actions.actions.map((action) => [action.ref, action.status]), [
    ['r1', 'saved'],
    ['r2', 'open'],
  ]);
});

Deno.test('prepare grace › a correction with no confirm still replaces the change, after the wait', async () => {
  const context = ownerContext();
  await preparePayment(context.ctx, { name: 'Ramesh', amount: 100, full: undefined });
  const now = later(context, 5_000);

  await preparePayment(now.ctx, { name: 'Ramesh', amount: 300, full: undefined });

  assertEquals(context.calls.includes('pause 1500'), true);
  assertEquals(context.actions.actions.map((action) => [action.ref, action.status]), [
    ['r1', 'cancelled'],
    ['r2', 'open'],
  ]);
});

Deno.test('prepare grace › no wait when nothing could be confirmed yet', async () => {
  const context = ownerContext();
  await preparePayment(context.ctx, { name: 'Ramesh', amount: 100, full: undefined });

  await preparePayment(later(context, 1_000).ctx, { name: 'Ramesh', amount: 300, full: undefined });

  assertEquals(context.calls.some((call) => call.startsWith('pause')), false);
});

Deno.test('schemas › an optional field sent as "" or null counts as left out', () => {
  const args = OWNER_TOOL_SPECS.prepare_delete.args;

  const blank = args.parse({ name: 'Ramesh', kind: '', amount: null, entry_date: '' });

  assertEquals([blank.name, blank.kind, blank.amount, blank.entry_date], [
    'Ramesh',
    undefined,
    undefined,
    undefined,
  ]);
});

Deno.test('schemas › given optional values pass through (digits as text become numbers)', () => {
  const args = OWNER_TOOL_SPECS.prepare_delete.args;

  const given = args.parse({
    name: 'Ramesh',
    kind: 'credit',
    amount: '5000',
    entry_date: '2026-10-06',
  });

  assertEquals([given.kind, given.amount, given.entry_date], ['credit', 5000, '2026-10-06']);
});
