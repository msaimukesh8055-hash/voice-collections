// supabase/functions/whatsapp-webhook/route-score.test.ts
// The reliability score in "pending" and a shopkeeper lookup (SPEC §6.1, M5 acceptance), through
// the router: the same number and band as "Ramesh score", worked out on the demo-clock date, and
// only for the rows shown. Fakes only.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { botSetup } from '../_shared/cards/__fixtures__/bot-context.ts';
import { lookupRowId } from '../_shared/cards/ids.ts';
import { RAMESH } from '../_shared/db/fake-book-repository.ts';
import { reminderSetup } from '../_shared/reminders/__fixtures__/reminder-deps.ts';
import type { BrainLlm } from '../_shared/brain/llm.ts';
import type { InboundMessage } from '../_shared/whatsapp/inbound.ts';
import { replyText } from '../_shared/whatsapp/replies.ts';
import { routeMessage } from './route.ts';

const NOW = new Date('2026-11-02T12:00:00+05:30');
const NO_LLM: BrainLlm = () => Promise.resolve({ suggestion: null, path: 'failed' });

function text(body: string): InboundMessage {
  return { id: `wamid.${body}`, from: '910000000001', kind: 'text', text: body };
}

function scoredSetup(): ReturnType<typeof botSetup> {
  return botSetup({
    reminder: reminderSetup({ now: NOW, callStatuses: { [RAMESH.id]: ['completed', 'missed'] } }),
  });
}

async function say(body: string, setup = scoredSetup()): Promise<string> {
  const result = await routeMessage(text(body), setup.ctx, { llm: NO_LLM, demoNow: NOW });
  return replyText(result.replies);
}

/** "📊 *Ramesh: 86/100* (Reliable)" → ["86", "Reliable"] */
async function explained(name: string): Promise<readonly [string, string]> {
  const title = (await say(`${name} score`)).split('\n')[0] ?? '';
  const found = /: (\d+)\/100\* \((.+)\)$/.exec(title);
  assert(found, title);
  return [found[1] ?? '', found[2] ?? ''];
}

Deno.test('score views › "pending" shows each row\'s band, the same as "X score"', async () => {
  const [score, band] = await explained('Ramesh');
  const lines = (await say('pending')).split('\n');
  assertEquals(lines[1], `1. Ramesh (Ramesh Kirana) · ₹8,500 · 12 days overdue · ${band} ${score}`);
  assertEquals(lines[2], '2. Latha (Latha General Stores) · ₹2,000 · 8 days overdue · New');
});

Deno.test('score views › a lookup by name or by list row shows "Score: N (band)"', async () => {
  const [score, band] = await explained('Ramesh');
  assertStringIncludes(await say('Ramesh'), `Score: ${score} (${band})`);
  const setup = scoredSetup();
  const tap: InboundMessage = {
    id: 'wamid.row',
    from: '910000000001',
    kind: 'tap',
    buttonId: lookupRowId(RAMESH.id, 'hi'),
  };
  const result = await routeMessage(tap, setup.ctx, { llm: NO_LLM, demoNow: NOW });
  assertStringIncludes(replyText(result.replies), `स्कोर: ${score}`);
});

Deno.test('score views › only the rows shown are scored (no extra database reads)', async () => {
  const setup = scoredSetup();
  const asked: string[] = [];
  const repo = {
    ...setup.ctx.reminder.repo,
    listPromises: (id: string) => {
      asked.push(id);
      return setup.ctx.reminder.repo.listPromises(id);
    },
  };
  const ctx = { ...setup.ctx, reminder: { ...setup.ctx.reminder, repo } };
  await routeMessage(text('pending'), ctx, { llm: NO_LLM, demoNow: NOW });
  assertEquals(asked.length, 2);
});
