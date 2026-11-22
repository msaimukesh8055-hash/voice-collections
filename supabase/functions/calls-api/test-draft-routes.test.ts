// supabase/functions/calls-api/test-draft-routes.test.ts
// "Add as a test case" through the real router: behind the dashboard link; a call's draft gets
// the caller's lines and the scorecard's problems from the server; a WhatsApp draft needs the
// owner's own words; the same call twice stays one draft; bad bodies are 400.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { DASHBOARD_TOKEN_HEADER, signDashboardToken } from '../_shared/auth/dashboard-link.ts';
import { fakeOwnerCallDetail } from '../_shared/db/fake-owner-call-reads.ts';
import { FAKE_OWNER_CALL_ID } from '../_shared/db/fake-owner-call-repository.ts';
import { createFakeRepository, FAKE_NOW } from '../_shared/db/fake-repository.ts';
import { dashboardSetup, LINK_SECRET } from './__fixtures__/dashboard.ts';
import { munshiSetup } from './__fixtures__/munshi.ts';
import { handleCallsApi } from './handler.ts';
import type { CallsApiDeps } from './types.ts';

const ORIGIN = 'http://localhost:5173';
const URL = 'https://ref.supabase.co/functions/v1/calls-api/v1/dashboard/test-drafts';

function deps(): { all: CallsApiDeps; setup: ReturnType<typeof dashboardSetup> } {
  const setup = dashboardSetup({
    ownerCalls: [
      fakeOwnerCallDetail({
        transcript: [
          { role: 'user', content: 'Who has paid me this month?' },
          { role: 'assistant', content: "The book doesn't give that list." },
        ],
        toolEvents: [],
      }),
    ],
  });
  const all: CallsApiDeps = {
    repo: createFakeRepository().repo,
    clock: () => FAKE_NOW,
    log: () => {},
    allowedOrigins: [ORIGIN],
    sarvam: { apiKey: 'k', orgId: 'o', workspaceId: 'w', appId: 'a', munshiAppId: null },
    fetchImpl: () => Promise.reject(new Error('no network in tests')),
    kickFollowup: () => 0,
    dashboard: setup.dashboard,
    munshi: munshiSetup().munshi,
  };
  return { all, setup };
}

async function send(
  all: CallsApiDeps,
  options: { body?: unknown; signed?: boolean } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { origin: ORIGIN, 'content-type': 'application/json' };
  if (options.signed !== false) {
    headers[DASHBOARD_TOKEN_HEADER] = await signDashboardToken(LINK_SECRET, FAKE_NOW);
  }
  const init: RequestInit = options.body === undefined
    ? { headers }
    : { method: 'POST', headers, body: JSON.stringify(options.body) };
  const response = await handleCallsApi(new Request(URL, init), all);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

Deno.test('test drafts api › no valid dashboard link → 401, nothing saved', async () => {
  const { all, setup } = deps();
  const { status } = await send(all, {
    signed: false,
    body: { source: 'whatsapp', refId: 't1', said: 'hi' },
  });
  assertEquals(status, 401);
  assertEquals(setup.drafts.length, 0);
});

Deno.test("test drafts api › a Munshi call's draft: his lines and the scorecard's problems", async () => {
  const { all, setup } = deps();
  const body = { source: 'munshi_call', refId: FAKE_OWNER_CALL_ID, expected: 'Say who paid' };
  assertEquals((await send(all, { body })).status, 200);
  const draft = setup.drafts[0];
  assertEquals(draft?.said, 'Who has paid me this month?');
  assertStringIncludes(draft?.problem ?? '', 'book_summary needed but never ran');
  assertStringIncludes(draft?.problem ?? '', 'Asks Munshi could answer');
  assertEquals(draft?.expected, 'Say who paid');
  await send(all, { body });
  assertEquals(setup.drafts.length, 1);
  const listed = await send(all);
  assertEquals((listed.body['drafts'] as unknown[]).length, 1);
});

Deno.test('test drafts api › WhatsApp needs his words; unknown calls and bad bodies are refused', async () => {
  const { all, setup } = deps();
  assertEquals((await send(all, { body: { source: 'whatsapp', refId: 't1' } })).status, 400);
  assertEquals((await send(all, { body: { source: 'other', refId: 't1' } })).status, 400);
  const unknown = { source: 'asha_call', refId: 'c0000000-0000-4000-8000-0000000000ff' };
  assertEquals((await send(all, { body: unknown })).status, 404);
  const ok = { source: 'whatsapp', refId: 't1', said: 'ramesh 2000 jama' };
  assertEquals((await send(all, { body: ok })).status, 200);
  assertEquals(setup.drafts[0]?.said, 'ramesh 2000 jama');
  assert(setup.drafts[0]?.problem.includes('WhatsApp'));
});

Deno.test('test drafts api › a draft from the WhatsApp chats page keeps its own source', async () => {
  const { all, setup } = deps();
  const chat = { source: 'whatsapp_chat', refId: 'e1' };
  assertEquals((await send(all, { body: chat })).status, 400);
  assertEquals((await send(all, { body: { ...chat, said: 'suresh 500' } })).status, 200);
  assertEquals(setup.drafts[0]?.source, 'whatsapp_chat');
});
