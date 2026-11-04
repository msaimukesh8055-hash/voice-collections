// supabase/functions/whatsapp-webhook/route-insights.test.ts
// "insights" and "dashboard" through the router (M6): the chart is drawn and uploaded only when
// something falls due this month; the upload failing still gives the full text.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { BrainLlm } from '../_shared/brain/llm.ts';
import { botSetup, FAKE_DASHBOARD_LINK } from '../_shared/cards/__fixtures__/bot-context.ts';
import type { WebDeps } from '../_shared/cards/context.ts';
import { bookEntry, RAMESH } from '../_shared/db/fake-book-repository.ts';
import type { Hearing } from '../_shared/speech/hear.ts';
import type { InboundMessage } from '../_shared/whatsapp/inbound.ts';
import { replyText } from '../_shared/whatsapp/replies.ts';
import { routeMessage } from './route.ts';

const NOW = new Date('2026-11-02T12:00:00+05:30');
const NO_LLM: BrainLlm = () => Promise.resolve({ suggestion: null, path: 'failed' });
const NO_HEARING = (): Promise<Hearing> => Promise.resolve({ kind: 'failed' });

function text(body: string): InboundMessage {
  return { id: 'wamid.I', from: '910000000001', kind: 'text', text: body };
}

function uploads(result: string | null): WebDeps & { pngs: Uint8Array[] } {
  const pngs: Uint8Array[] = [];
  return {
    pngs,
    uploadImage: (png) => {
      pngs.push(png);
      return Promise.resolve(result);
    },
    dashboardLink: () => Promise.resolve(FAKE_DASHBOARD_LINK),
  };
}

Deno.test('route insights › "insights" sends the chart, then the figures and the link', async () => {
  const web = uploads('IMG9');
  const setup = botSetup({ web });
  const result = await routeMessage(text('insights'), setup.ctx, {
    llm: NO_LLM,
    demoNow: NOW,
    hear: NO_HEARING,
  });
  assertEquals(result.command, 'insights');
  assertEquals(result.replies.map((reply) => reply.kind), ['image', 'text']);
  assertEquals([...(web.pngs[0] ?? []).slice(1, 4)], [0x50, 0x4e, 0x47]); // "PNG"
  const body = replyText(result.replies);
  assertStringIncludes(body, 'Top 5 overdue');
  assertStringIncludes(body, `Full detail: ${FAKE_DASHBOARD_LINK}`);
});

Deno.test('route insights › upload failing → text only, slices in the text', async () => {
  const setup = botSetup({ web: uploads(null) });
  const result = await routeMessage(text('report'), setup.ctx, {
    llm: NO_LLM,
    demoNow: NOW,
    hear: NO_HEARING,
  });
  assertEquals(result.replies.map((reply) => reply.kind), ['text']);
  assertStringIncludes(replyText(result.replies), '🟦 Not yet due');
});

Deno.test('route insights › nothing due this month → no chart drawn or uploaded', async () => {
  const web = uploads('IMG');
  const entries = [
    bookEntry({ shopkeeperId: RAMESH.id, kind: 'credit', amount: 500, dueDate: '2026-12-20' }),
  ];
  const setup = botSetup({ web, state: { entries } });
  const result = await routeMessage(text('insights'), setup.ctx, {
    llm: NO_LLM,
    demoNow: NOW,
    hear: NO_HEARING,
  });
  assertEquals(web.pngs.length, 0);
  assert(replyText(result.replies).includes('No credit falls due this month yet.'));
});

Deno.test('route insights › "dashboard" sends the signed link', async () => {
  const setup = botSetup();
  const result = await routeMessage(text('dashboard'), setup.ctx, {
    llm: NO_LLM,
    demoNow: NOW,
    hear: NO_HEARING,
  });
  assertStringIncludes(replyText(result.replies), FAKE_DASHBOARD_LINK);
});
