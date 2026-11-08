// supabase/functions/_shared/owner-tools/confirm-race.test.ts
// Two confirms of the same change at the same moment, for every kind (M8 B1, money, 100%): only
// one wins the compare-and-set and writes; the other says ALREADY_DONE. Plus the tool schemas'
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
