// supabase/functions/_shared/reminders/owner-send.test.ts
// The worker's /owner-send job (M8 B5): only a saved voice_send of the owner is sent, exactly
// once, to the owner's number only, and the replies are exactly what typing the command on
// WhatsApp gives (runCommand on the same fake book). FAKE DATA ONLY.
import { assert, assertEquals } from '@std/assert';
import { type BotSetup, botSetup, FAKE_WEB } from '../cards/__fixtures__/bot-context.ts';
import type { Command } from '../brain/commands.ts';
import { FAKE_OWNER, RAMESH } from '../db/fake-book-repository.ts';
import { FAKE_NOW } from '../db/fake-repository.ts';
import { createFakeVoiceActionRepository } from '../db/fake-voice-action-repository.ts';
import type { VoiceAction } from '../db/voice-action-repository.ts';
import { FAKE_OWNER_CALL_ID } from '../db/fake-owner-call-repository.ts';
import type { SendWhat } from '../owner-tools/schemas.ts';
import type { WhatsAppClient } from '../whatsapp/client.ts';
import type { Reply } from '../whatsapp/replies.ts';
import { runCommand } from '../../whatsapp-webhook/run-command.ts';
import { type OwnerSendDeps, sendOwnerRequest } from './owner-send.ts';

const OWNER_NUMBER = '+91 00000 00000';

function sendAction(what: SendWhat, overrides: Partial<VoiceAction> = {}): VoiceAction {
  const statement = what === 'statement';
  return {
    id: crypto.randomUUID(),
    ownerId: FAKE_OWNER.id,
    ownerCallId: FAKE_OWNER_CALL_ID,
    kind: 'voice_send',
    ref: 'r1',
    data: {
      what,
      shopkeeperId: statement ? RAMESH.id : null,
      name: statement ? 'Ramesh' : null,
    },
    status: 'saved',
    createdAt: FAKE_NOW.toISOString(),
    expiresAt: FAKE_NOW.toISOString(),
    ...overrides,
  };
}

interface Job {
  readonly deps: OwnerSendDeps;
  readonly sent: Array<{ to: string; reply: Reply }>;
  readonly setup: BotSetup;
  readonly action: VoiceAction;
  readonly statusOf: () => string | undefined;
}

function job(action: VoiceAction): Job {
  const setup = botSetup({ language: FAKE_OWNER.language });
  const fake = createFakeVoiceActionRepository([action]);
  const sent: Array<{ to: string; reply: Reply }> = [];
  const whatsapp: WhatsAppClient = {
    send: (to, reply) => {
      sent.push({ to, reply });
      return Promise.resolve(`wamid.${sent.length}`);
    },
  };
  const { reminder } = setup.ctx;
  const deps: OwnerSendDeps = {
    actions: fake.actions,
    book: setup.ctx.book,
    store: reminder.store,
    repo: reminder.repo,
    listCallStatuses: reminder.listCallStatuses,
    whatsapp,
    owner: { ownerNumber: OWNER_NUMBER, hashKey: 'fake-app-secret' },
    dashboardLink: FAKE_WEB.dashboardLink,
    shopkeeperLink: FAKE_WEB.shopkeeperLink,
    clock: () => FAKE_NOW,
    log: () => {},
  };
  const statusOf = (): string | undefined => fake.state.actions[0]?.status;
  return { deps, sent, setup, action, statusOf };
}

/** The same command typed on WhatsApp, on a fresh copy of the same fake book. */
function typed(command: Command): Promise<readonly Reply[]> {
  return runCommand(command, botSetup({ language: FAKE_OWNER.language }).ctx);
}

const SAME_AS_TYPING: ReadonlyArray<readonly [SendWhat, Command]> = [
  ['pending', { kind: 'pending' }],
  ['due', { kind: 'due_alert' }],
  ['statement', { kind: 'lookup', name: 'Ramesh' }],
];

for (const [what, command] of SAME_AS_TYPING) {
  Deno.test(`owner-send › ${what}: exactly the replies typing it on WhatsApp gives`, async () => {
    const run = job(sendAction(what));

    const outcome = await sendOwnerRequest(run.action.id, run.deps);

    assertEquals(outcome, 'sent');
    assertEquals(run.sent.map((each) => each.reply), [...(await typed(command))]);
    assert(run.sent.every((each) => each.to === OWNER_NUMBER), 'owner only');
    assertEquals(run.setup.state.outbound.length, run.sent.length);
  });
}

Deno.test('owner-send › insights: one message, the chart figures written in the text', async () => {
  const run = job(sendAction('insights'));

  await sendOwnerRequest(run.action.id, run.deps);

  const typedReplies = await typed({ kind: 'insights' });
  const [sent] = run.sent;
  const typedText = typedReplies.find((reply) => reply.kind !== 'image');
  assertEquals(run.sent.length, 1);
  assert(sent && sent.reply.kind === 'buttons' && typedText?.kind === 'buttons');
  assertEquals(sent.reply.buttons, typedText.buttons);
  assert(sent.reply.text.includes('₹3,500'), 'no chart, so the slices are text');
});

Deno.test('owner-send › once only: a second run sends nothing', async () => {
  const run = job(sendAction('pending'));

  await sendOwnerRequest(run.action.id, run.deps);
  const count = run.sent.length;
  const again = await sendOwnerRequest(run.action.id, run.deps);

  assertEquals([again, run.sent.length, run.statusOf()], ['already_sent', count, 'done']);
});

Deno.test('owner-send › an unsaved (open or cancelled) action sends nothing', async () => {
  for (const status of ['open', 'cancelled'] as const) {
    const run = job(sendAction('pending', { status }));
    assertEquals(await sendOwnerRequest(run.action.id, run.deps), 'already_sent');
    assertEquals(run.sent, []);
  }
});

Deno.test('owner-send › not a voice_send, unknown id or another owner → nothing sent', async () => {
  const notSend = job(sendAction('pending', { kind: 'voice_credit' }));
  const badData = job(sendAction('pending', { data: { what: 'everything' } }));
  const otherOwner = job(sendAction('pending', { ownerId: crypto.randomUUID() }));
  const unknown = job(sendAction('pending'));

  assertEquals(await sendOwnerRequest(notSend.action.id, notSend.deps), 'not_a_send');
  assertEquals(await sendOwnerRequest(badData.action.id, badData.deps), 'not_a_send');
  assertEquals(await sendOwnerRequest(otherOwner.action.id, otherOwner.deps), 'not_owner');
  assertEquals(await sendOwnerRequest(crypto.randomUUID(), unknown.deps), 'not_found');
  assertEquals(
    [...notSend.sent, ...badData.sent, ...otherOwner.sent, ...unknown.sent],
    [],
  );
  assertEquals(otherOwner.statusOf(), 'saved');
});

Deno.test('owner-send › a statement for a shopkeeper no longer in the book sends nothing', async () => {
  const run = job(sendAction('statement', {
    data: { what: 'statement', shopkeeperId: crypto.randomUUID(), name: 'Gone' },
  }));

  assertEquals(await sendOwnerRequest(run.action.id, run.deps), 'no_shopkeeper');
  assertEquals(run.sent, []);
});

Deno.test('owner-send › pending with nobody owing: one message, no list', async () => {
  const run = job(sendAction('pending'));
  run.setup.state.entries = [];

  const outcome = await sendOwnerRequest(run.action.id, run.deps);

  assertEquals([outcome, run.sent.length], ['sent', 1]);
});
