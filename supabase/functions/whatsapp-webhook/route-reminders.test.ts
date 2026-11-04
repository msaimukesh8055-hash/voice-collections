// supabase/functions/whatsapp-webhook/route-reminders.test.ts
// The owner's reminder flow through the router (M5 test list): "who is due?" → alert with Remind
// actions and nobody called; Remind → one live call for anyone (Live remind, pre-M6), a second
// waits its turn; Remind all due → count + skips → Yes queues everyone simulated, once (a second
// tap later, or two taps at once) → No queues nothing; score explain. Fakes only.
import type { Hearing } from '../_shared/speech/hear.ts';
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { type BotSetup, botSetup } from '../_shared/cards/__fixtures__/bot-context.ts';
import { parseTap, remindAllButtonId, remindButtonId } from '../_shared/cards/ids.ts';
import { LATHA, PRAVEEN_1, RAMESH } from '../_shared/db/fake-book-repository.ts';
import { reminderSetup } from '../_shared/reminders/__fixtures__/reminder-deps.ts';
import type { InboundMessage } from '../_shared/whatsapp/inbound.ts';
import { type Reply, replyText } from '../_shared/whatsapp/replies.ts';
import { routeMessage, runCommand } from './route.ts';
import type { BrainLlm } from '../_shared/brain/llm.ts';

const NOW = new Date('2026-11-02T12:00:00+05:30');
const NO_LLM: BrainLlm = () => Promise.resolve({ suggestion: null, path: 'failed' });
const NO_HEARING = (): Promise<Hearing> => Promise.resolve({ kind: 'failed' });

function text(body: string): InboundMessage {
  return { id: `wamid.${body}`, from: '910000000001', kind: 'text', text: body };
}

function tap(buttonId: string): InboundMessage {
  return { id: `wamid.${buttonId}`, from: '910000000001', kind: 'tap', buttonId };
}

async function send(setup: BotSetup, message: InboundMessage): Promise<readonly Reply[]> {
  return (await routeMessage(message, setup.ctx, { llm: NO_LLM, demoNow: NOW, hear: NO_HEARING }))
    .replies;
}

function buttonIds(replies: readonly Reply[]): string[] {
  return replies.flatMap((reply) => reply.kind === 'buttons' ? reply.buttons.map((b) => b.id) : []);
}

Deno.test('reminders › "who is due?" lists people with Remind buttons and calls nobody', async () => {
  const setup = botSetup();
  const replies = await send(setup, text('who is due?'));
  const all = replyText(replies);
  assertStringIncludes(all, 'Overdue* (2)');
  assertStringIncludes(all, 'Ramesh (Ramesh Kirana) · ₹5,000 · 12 days overdue');
  assertEquals(buttonIds(replies), [
    remindButtonId(RAMESH.id, 'en'),
    remindButtonId(LATHA.id, 'en'),
    remindAllButtonId('en'),
  ]);
  assertEquals([setup.reminder.store.state.calls.length, setup.reminder.repo.state.calls.length], [
    0,
    0,
  ]);
});

Deno.test('reminders › the alert runs the promise check first (an open promise breaks)', async () => {
  const reminder = reminderSetup({
    now: NOW,
    store: {
      promises: [{
        id: '90000000-0000-4000-8000-0000000000f1',
        shopkeeperId: LATHA.id,
        amount: 1000,
        promiseDate: '2026-10-30',
        status: 'open',
        createdAt: '2026-10-28T05:00:00Z',
      }],
    },
  });
  const changed: string[] = [];
  const setup = botSetup({ reminder });
  const ctx = {
    ...setup.ctx,
    reminder: {
      ...reminder.deps,
      repo: {
        ...reminder.deps.repo,
        setPromiseStatus: (id: string, status: 'kept' | 'broken') => {
          changed.push(`${id}:${status}`);
          return Promise.resolve(true);
        },
      },
    },
  };
  const result = await routeMessage(text('due'), ctx, {
    llm: NO_LLM,
    demoNow: NOW,
    hear: NO_HEARING,
  });
  assertStringIncludes(replyText(result.replies), 'Promises missed* (1)');
  assertEquals(changed, ['90000000-0000-4000-8000-0000000000f1:broken']);
});

Deno.test('reminders › Remind on the demo live shopkeeper rings the phone page', async () => {
  const setup = botSetup();
  const replies = await send(setup, tap(remindButtonId(RAMESH.id, 'en')));
  assertStringIncludes(replyText(replies), 'Calling Ramesh now. It rings on the phone page');
  assertEquals(setup.reminder.repo.state.calls.map((c) => c.mode), ['live']);
  assertEquals(setup.reminder.started, []);
});

Deno.test('reminders › Remind on anyone else is live too (typed or tapped), never simulated', async () => {
  const setup = botSetup();
  const replies = await send(setup, text('remind Latha'));
  assertStringIncludes(replyText(replies), 'Calling Latha now');
  assertStringIncludes(replyText(replies), 'answer as Latha');
  assertEquals(setup.reminder.repo.state.calls.map((c) => [c.shopkeeperId, c.mode]), [
    [LATHA.id, 'live'],
  ]);
  assertEquals(setup.reminder.started, []);
  const again = await send(setup, tap(remindButtonId(LATHA.id, 'en')));
  assertStringIncludes(replyText(again), 'Latha is already being called');
  assertEquals(setup.reminder.repo.state.calls.length, 1);
});

Deno.test('reminders › Remind with no live shopkeeper set still rings live', async () => {
  const settings = {
    demoClock: null,
    callingHoursEnabled: false,
    callLimitsEnabled: false,
    liveShopkeeperId: null,
  };
  const setup = botSetup({ reminder: reminderSetup({ now: NOW, repo: { settings } }) });
  await send(setup, tap(remindButtonId(LATHA.id, 'en')));
  assertEquals(setup.reminder.repo.state.calls.map((c) => c.mode), ['live']);
});

Deno.test('reminders › a second one-person Remind is queued live behind the first', async () => {
  const setup = botSetup();
  await send(setup, tap(remindButtonId(RAMESH.id, 'en')));
  const second = await send(setup, tap(remindButtonId(LATHA.id, 'en')));
  assertStringIncludes(replyText(second), 'after any call already on it');
  assertEquals(setup.reminder.repo.state.calls.map((c) => [c.shopkeeperId, c.mode, c.status]), [
    [RAMESH.id, 'live', 'queued'],
    [LATHA.id, 'live', 'queued'],
  ]);
});

Deno.test('reminders › a blocked Remind says why and calls nobody', async () => {
  const reminder = reminderSetup({ now: NOW });
  reminder.repo.state.shopkeepers = reminder.repo.state.shopkeepers.map((s) =>
    s.id === LATHA.id ? { ...s, doNotCall: true } : s
  );
  const setup = botSetup({ reminder });
  const replies = await send(setup, tap(remindButtonId(LATHA.id, 'en')));
  assertStringIncludes(replyText(replies), 'Latha asked not to be called');
  assertEquals(reminder.repo.state.calls.length, 0);
});

Deno.test('reminders › a Remind tap for an unknown shopkeeper does nothing', async () => {
  const setup = botSetup();
  const replies = await send(
    setup,
    tap(remindButtonId('5e000000-0000-4000-8000-0000000000ff', 'en')),
  );
  assertStringIncludes(replyText(replies), 'expired');
});

Deno.test('reminders › "remind Praveen" with two Praveens asks which shop', async () => {
  const setup = botSetup();
  const replies = await send(setup, text('remind Praveen'));
  assertStringIncludes(replyText(replies), 'Which Praveen?');
  assertStringIncludes(replyText(replies), PRAVEEN_1.shopName);
  assertEquals(setup.reminder.repo.state.calls.length, 0);
});

Deno.test('reminders › Remind all due → count with skips → Yes queues once', async () => {
  const reminder = reminderSetup({
    now: NOW,
    store: { recentCalls: [{ shopkeeperId: LATHA.id, queuedAt: '2026-11-02T06:00:00.000Z' }] },
  });
  const setup = botSetup({ reminder });
  const offer = await send(setup, tap(remindAllButtonId('en')));
  assertStringIncludes(replyText(offer), 'Call 1 person?');
  assertStringIncludes(replyText(offer), '1 called in the last hour, skipped');
  assertEquals(reminder.store.state.calls.length, 0);
  const [yes] = buttonIds(offer);
  const started = await send(setup, tap(yes ?? ''));
  assertStringIncludes(replyText(started), 'Calling 1 person with simulated calls');
  assertEquals(reminder.store.state.calls.map((c) => [c.shopkeeperId, c.mode]), [[
    RAMESH.id,
    'simulated',
  ]]);
  assertEquals(reminder.repo.state.calls.length, 0);
  const twice = await send(setup, tap(yes ?? ''));
  assertStringIncludes(replyText(twice), 'Already done');
  assertEquals(reminder.store.state.calls.length, 1);
});

Deno.test('reminders › two quick taps on Yes at once: one wins, the other says "Already done"', async () => {
  const setup = botSetup();
  const offer = await send(setup, text('remind all'));
  const [yes] = buttonIds(offer);
  // Both taps read the card while it is still open; only one compare-and-set can close it.
  const [first, second] = await Promise.all([
    send(setup, tap(yes ?? '')),
    send(setup, tap(yes ?? '')),
  ]);
  const texts = [replyText(first ?? []), replyText(second ?? [])];
  assertEquals(texts.filter((reply) => reply === 'Already done.').length, 1, texts.join(' | '));
  assertEquals(setup.reminder.store.state.calls.length, 2);
  assertEquals(setup.reminder.started, [2]);
  assertEquals(setup.state.actions.map((action) => action.status), ['done']);
});

Deno.test('reminders › Remind all with simulated people starts at most 4', async () => {
  const setup = botSetup();
  const offer = await send(setup, text('remind all'));
  assertStringIncludes(replyText(offer), 'Call 2 people?');
  const [yes] = buttonIds(offer);
  const started = await send(setup, tap(yes ?? ''));
  assertStringIncludes(replyText(started), 'Calling 2 people with simulated calls, at most 4');
  assertEquals(setup.reminder.store.state.calls.map((c) => c.mode), ['simulated', 'simulated']);
  assertEquals(setup.reminder.started, [2]);
});

Deno.test('reminders › No on the card queues nothing', async () => {
  const setup = botSetup();
  const offer = await send(setup, text('remind all'));
  const no = buttonIds(offer)[1] ?? '';
  assertEquals(parseTap(no)?.kind, 'card');
  assertStringIncludes(replyText(await send(setup, tap(no))), 'Cancelled');
  assertEquals(setup.reminder.store.state.calls.length, 0);
});

Deno.test('reminders › Yes after a do-not-call change: blocked person counted, not called', async () => {
  const setup = botSetup();
  const offer = await send(setup, text('remind all'));
  setup.reminder.store.state.doNotCall = [LATHA.id, RAMESH.id];
  const started = await send(setup, tap(buttonIds(offer)[0] ?? ''));
  assertStringIncludes(replyText(started), 'Nobody to call');
  assertStringIncludes(replyText(started), '2 could not be called now');
});

Deno.test('reminders › nobody to call when everyone due is skipped', async () => {
  const setup = botSetup();
  setup.reminder.store.state.paused = [RAMESH.id];
  setup.reminder.store.state.doNotCall = [LATHA.id];
  const replies = await send(setup, text('remind everyone'));
  assert(replies[0]?.kind === 'text');
  assertStringIncludes(replyText(replies), '1 paused after a call, skipped');
  assertEquals(setup.state.actions.length, 0);
});

Deno.test('reminders › a remind-all card whose people vanished starts nothing', async () => {
  const setup = botSetup();
  const offer = await send(setup, text('remind all'));
  const ctx = { ...setup.ctx, shopkeepers: [] };
  const id = buttonIds(offer)[0] ?? '';
  const result = await routeMessage(tap(id), ctx, { llm: NO_LLM, demoNow: NOW, hear: NO_HEARING });
  assertStringIncludes(replyText(result.replies), 'Nobody to call');
  assertEquals(setup.reminder.store.state.calls.length, 0);
});

Deno.test('reminders › "why is Ramesh 42?" explains the four parts', async () => {
  const setup = botSetup({
    reminder: reminderSetup({ now: NOW, callStatuses: { [RAMESH.id]: ['completed', 'missed'] } }),
  });
  const replies = await send(setup, text('why is Ramesh 42?'));
  const all = replyText(replies);
  assertStringIncludes(all, '*Ramesh: ');
  assertStringIncludes(all, 'Paid on time: ');
  assertStringIncludes(all, 'Promises kept: 30/30 (nothing to judge yet, full marks)');
  assertStringIncludes(all, 'Current overdue: 16/20 (12 days overdue now)');
  assertStringIncludes(all, 'Answers calls: 5/10 (1 of 2 calls answered)');
});

Deno.test('reminders › score for a shopkeeper with little history says "New"', async () => {
  const setup = botSetup();
  const replies = await send(setup, text('Latha score'));
  assertStringIncludes(replyText(replies), '"New"');
});

Deno.test('reminders › score for an unknown name says not found', async () => {
  const setup = botSetup();
  const result = await routeMessage(
    { id: 'w', from: '1', kind: 'text', text: 'score of Zzz' },
    { ...setup.ctx, shopkeepers: setup.ctx.shopkeepers },
    { llm: NO_LLM, demoNow: NOW, hear: NO_HEARING },
  );
  assertEquals(result.command, 'unknown');
});

Deno.test('reminders › a remind command for a name that matches nobody calls nobody', async () => {
  // Text never gets here (an unknown name goes to the LLM, which cannot ask for a reminder), but
  // runCommand is the one door, so it must still refuse safely.
  const setup = botSetup();
  const replies = await runCommand({ kind: 'remind', name: 'Zzz' }, setup.ctx);
  assertStringIncludes(replyText(replies), 'No shopkeeper called Zzz');
  assertEquals(setup.reminder.store.state.calls.length, 0);
});
