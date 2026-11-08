// supabase/functions/whatsapp-webhook/owner-call.test.ts
// M8 A2 through the router: the Menu's "📞 Call Munshi" row creates one issued owner call (15
// minutes) and replies with its link; older unused links expire; 3 links per 10 minutes; no link
// after today's 6 Munshi sessions; "not set up" without a link secret. Fakes only.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { BrainLlm } from '../_shared/brain/llm.ts';
import { botSetup, FAKE_NOW, fakeMunshiLink } from '../_shared/cards/__fixtures__/bot-context.ts';
import { menuRowId } from '../_shared/cards/ids.ts';
import {
  MAX_MUNSHI_SESSIONS_PER_DAY,
  OWNER_CALL_LINK_TTL_MS,
} from '../_shared/calls/owner-call-limits.ts';
import { fakeOwnerCall } from '../_shared/db/fake-owner-call-repository.ts';
import type { Hearing } from '../_shared/speech/hear.ts';
import { SUPPORTED_LANGUAGES } from '../_shared/schemas/shopkeeper.ts';
import type { InboundMessage } from '../_shared/whatsapp/inbound.ts';
import { replyText } from '../_shared/whatsapp/replies.ts';
import { ownerCallPhrasesFor } from './owner-call.ts';
import { type Outcome, routeMessage } from './route.ts';

const NO_HEARING = (): Promise<Hearing> => Promise.resolve({ kind: 'failed' });
const NO_LLM: BrainLlm = () => Promise.resolve({ suggestion: null, path: 'failed' });
/** WhatsApp's limit for a text message body. */
const MAX_TEXT = 4096;

function tapMunshi(language: 'en' | 'hi' | 'te' = 'en'): InboundMessage {
  const buttonId = menuRowId('munshi', language);
  return { id: `wamid.${buttonId}`, from: '910000000001', kind: 'tap', buttonId };
}

function minutesAgo(minutes: number): string {
  return new Date(FAKE_NOW.getTime() - minutes * 60_000).toISOString();
}

function route(
  setup: ReturnType<typeof botSetup>,
  language?: 'en' | 'hi' | 'te',
): Promise<Outcome> {
  return routeMessage(tapMunshi(language), setup.ctx, {
    llm: NO_LLM,
    demoNow: FAKE_NOW,
    hear: NO_HEARING,
  });
}

Deno.test('call munshi › the row creates one issued owner call for 15 minutes and sends its link', async () => {
  const setup = botSetup();
  const outcome = await route(setup);
  assertEquals(outcome.command, 'menu_munshi');
  const [call] = setup.ownerCalls.ownerCalls;
  assertEquals(setup.ownerCalls.ownerCalls.length, 1);
  assertEquals(call?.status, 'issued');
  assertEquals(call?.ownerId, setup.ctx.owner.id);
  assertEquals(Date.parse(call?.expiresAt ?? ''), FAKE_NOW.getTime() + OWNER_CALL_LINK_TTL_MS);
  assertEquals(
    replyText(outcome.replies),
    '📞 *Munshi is ready*\n' +
      `Open this in Chrome and tap Start call: ${fakeMunshiLink(call?.id ?? '')}\n` +
      'The link works once, for 15 minutes.',
  );
});

Deno.test('call munshi › a new tap expires the older unused link', async () => {
  const older = fakeOwnerCall({
    id: crypto.randomUUID(),
    status: 'issued',
    issuedAt: minutesAgo(20),
  });
  const used = fakeOwnerCall({
    id: crypto.randomUUID(),
    status: 'completed',
    issuedAt: minutesAgo(30),
  });
  const setup = botSetup({ ownerCalls: { ownerCalls: [older, used] } });
  await route(setup);
  const statuses = setup.ownerCalls.ownerCalls.map((row) => row.status);
  assertEquals(statuses, ['expired', 'completed', 'issued']);
});

Deno.test('call munshi › a 4th link inside 10 minutes → "try again in a few minutes", no row', async () => {
  const recent = [1, 4, 9].map((minutes) =>
    fakeOwnerCall({ id: crypto.randomUUID(), status: 'expired', issuedAt: minutesAgo(minutes) })
  );
  const setup = botSetup({ ownerCalls: { ownerCalls: recent } });
  const outcome = await route(setup);
  assertEquals(replyText(outcome.replies), ownerCallPhrasesFor('en').tooMany);
  assertEquals(setup.ownerCalls.ownerCalls.length, 3);
  const older = [1, 4, 11].map((minutes) =>
    fakeOwnerCall({ id: crypto.randomUUID(), status: 'expired', issuedAt: minutesAgo(minutes) })
  );
  const allowed = botSetup({ ownerCalls: { ownerCalls: older } });
  await route(allowed);
  assertEquals(allowed.ownerCalls.ownerCalls.length, 4);
});

Deno.test("call munshi › after today's 6 Munshi sessions → the daily line, no row", async () => {
  const sessions = Array.from({ length: MAX_MUNSHI_SESSIONS_PER_DAY }, (_, index) =>
    fakeOwnerCall({
      id: crypto.randomUUID(),
      status: 'completed',
      issuedAt: minutesAgo(60 + index),
      urlIssuedAt: minutesAgo(59 + index),
    }));
  const setup = botSetup({ ownerCalls: { ownerCalls: sessions } });
  const outcome = await route(setup, 'hi');
  assertEquals(replyText(outcome.replies), ownerCallPhrasesFor('hi').dailyLimit);
  assertEquals(setup.ownerCalls.ownerCalls.length, MAX_MUNSHI_SESSIONS_PER_DAY);
  const yesterday = sessions.map((row) => ({ ...row, urlIssuedAt: minutesAgo(24 * 60) }));
  const nextDay = botSetup({ ownerCalls: { ownerCalls: yesterday } });
  await route(nextDay);
  assertEquals(nextDay.ownerCalls.ownerCalls.length, MAX_MUNSHI_SESSIONS_PER_DAY + 1);
});

Deno.test('call munshi › without a link secret or web address → "not set up", nothing stored', async () => {
  const setup = botSetup({ munshiLink: null });
  const outcome = await route(setup, 'te');
  assertEquals(replyText(outcome.replies), ownerCallPhrasesFor('te').notSetUp);
  assertEquals(setup.ownerCalls.ownerCalls.length, 0);
});

Deno.test('call munshi › Hindi and Telugu links carry the English twin; every message fits', async () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const outcome = await route(botSetup(), language);
    const [reply] = outcome.replies;
    assert(reply?.kind === 'text');
    assert(reply.text.length <= MAX_TEXT);
    assertStringIncludes(reply.text, 'https://dashboard.example/munshi#t=');
    if (language !== 'en') assertStringIncludes(reply.english ?? '', '*Munshi is ready*');
    for (const line of Object.values(ownerCallPhrasesFor(language))) {
      const text = typeof line === 'string' ? line : line('LINK');
      assert(text.length <= MAX_TEXT && text.startsWith('📞'), `${language} ${text}`);
    }
  }
});

Deno.test('call munshi › the link is logged by owner call id only', async () => {
  const setup = botSetup();
  await route(setup);
  const issued = setup.logs.find((entry) => entry.event === 'owner_call_issued');
  assertEquals(Object.keys(issued?.fields ?? {}), ['ownerCallId']);
});
