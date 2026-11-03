// supabase/functions/_shared/reminders/jobs.test.ts
// The worker's daily jobs (M5 test list): due alert inside the 24-hour window → full alert with
// buttons; outside → the template only; once per demo day; nobody due → nothing sent. Daily
// promise check → broken written, score saved. Fakes only; nothing reaches Meta.
import { assert, assertEquals } from '@std/assert';
import { createFakeBookRepository } from '../db/fake-book-repository.ts';
import { createFakeFollowupRepository } from '../db/fake-followup-repository.ts';
import type { AlertPromise } from '../ledger/due-alert.ts';
import type { Reply } from '../whatsapp/replies.ts';
import { identifySender } from '../whatsapp/sender.ts';
import { reminderSetup } from './__fixtures__/reminder-deps.ts';
import {
  type DailyAlertDeps,
  FREE_WINDOW_MS,
  isInsideWindow,
  sendDailyAlert,
} from './daily-alert.ts';
import { runPromiseCheck } from './promise-check-job.ts';

const NOW = new Date('2026-11-02T03:30:00.000Z'); // 09:00 IST
const OWNER = { ownerNumber: '910000000001', hashKey: 'k' };
const LATHA_ID = '5e000000-0000-4000-8000-000000000002';

function alertSetup(lastInboundAt: string | null = null): {
  deps: DailyAlertDeps;
  sent: Reply[];
  book: ReturnType<typeof createFakeBookRepository>;
} {
  const reminder = reminderSetup({ now: NOW, store: { lastInboundAt } });
  const book = createFakeBookRepository();
  const sent: Reply[] = [];
  const deps: DailyAlertDeps = {
    book: book.book,
    store: reminder.deps.store,
    repo: reminder.deps.repo,
    whatsapp: {
      send: (_to, reply) => {
        sent.push(reply);
        return Promise.resolve('wamid.A');
      },
    },
    owner: OWNER,
    clock: () => NOW,
    log: () => {},
  };
  return { deps, sent, book };
}

Deno.test('daily alert › outside the 24-hour window only the template is sent', async () => {
  const s = alertSetup();
  assertEquals(await sendDailyAlert(s.deps), 'sent_template');
  assertEquals(s.sent.map((r) => r.kind), ['template']);
  const template = s.sent[0];
  assert(template?.kind === 'template');
  assertEquals(template.bodyParams, ['2']);
  assertEquals(s.book.state.outbound.length, 1);
});

Deno.test('daily alert › inside the window the full alert with buttons goes out, once a day', async () => {
  const s = alertSetup(new Date(NOW.getTime() - 60_000).toISOString());
  assertEquals(await sendDailyAlert(s.deps), 'sent_full');
  assertEquals(s.sent.map((r) => r.kind), ['text', 'buttons', 'buttons']);
  assertEquals(await sendDailyAlert(s.deps), 'already_sent');
  assertEquals(s.sent.length, 3);
});

Deno.test('daily alert › nobody due or no owner sends nothing', async () => {
  const s = alertSetup();
  s.book.state.entries = [];
  assertEquals(await sendDailyAlert(s.deps), 'nobody_due');
  s.book.state.owner = null;
  assertEquals(await sendDailyAlert(s.deps), 'no_owner');
  assertEquals(s.sent, []);
});

Deno.test('daily alert › the window edge', () => {
  assertEquals(isInsideWindow(null, NOW), false);
  assertEquals(
    isInsideWindow(new Date(NOW.getTime() - FREE_WINDOW_MS + 1).toISOString(), NOW),
    true,
  );
  assertEquals(isInsideWindow(new Date(NOW.getTime() - FREE_WINDOW_MS).toISOString(), NOW), false);
});

Deno.test("daily alert › the window is read for the owner's hashed number", async () => {
  const s = alertSetup();
  const seen: string[] = [];
  const store = {
    ...s.deps.store,
    lastInboundAt: (hash: string) => {
      seen.push(hash);
      return Promise.resolve(null);
    },
  };
  await sendDailyAlert({ ...s.deps, store });
  assertEquals(seen, [(await identifySender(OWNER.ownerNumber, OWNER)).senderHash]);
});

Deno.test('promise check job › an open promise past its date breaks and the score is saved', async () => {
  const open: AlertPromise = {
    id: '90000000-0000-4000-8000-0000000000f1',
    shopkeeperId: LATHA_ID,
    amount: 1000,
    promiseDate: '2026-10-30',
    status: 'open',
    createdAt: '2026-10-28T05:00:00Z',
  };
  const reminder = reminderSetup({ now: NOW, store: { promises: [open] } });
  const followups = createFakeFollowupRepository();
  const written: string[] = [];
  const repo = {
    ...reminder.deps.repo,
    setPromiseStatus: (id: string, status: 'kept' | 'broken') => {
      written.push(`${id}:${status}`);
      return Promise.resolve(true);
    },
  };
  const deps = {
    book: createFakeBookRepository().book,
    store: reminder.deps.store,
    repo,
    followups: followups.followups,
    clock: () => NOW,
    log: () => {},
  };
  assertEquals(await runPromiseCheck(deps), 1);
  assertEquals(written, [`${open.id}:broken`]);
  assertEquals(followups.state.scores.map((s) => s.shopkeeperId), [LATHA_ID]);
  assertEquals(
    await runPromiseCheck({
      ...deps,
      book: { ...deps.book, getOwner: () => Promise.resolve(null) },
    }),
    0,
  );
});
