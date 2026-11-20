// supabase/functions/calls-api/owner-call-routes.test.ts
// The Munshi call report's API (live evals, 2026-11-20) through the real router: behind the
// dashboard link; the list; one call with its transcript fetched from Sarvam once and kept, its
// cost, trace and Munshi's own scorecard; Sarvam failing still shows the rest.
import { assert, assertEquals } from '@std/assert';
import { DASHBOARD_TOKEN_HEADER, signDashboardToken } from '../_shared/auth/dashboard-link.ts';
import { fakeOwnerCallDetail } from '../_shared/db/fake-owner-call-reads.ts';
import { FAKE_OWNER_CALL_ID } from '../_shared/db/fake-owner-call-repository.ts';
import { createFakeRepository, FAKE_NOW } from '../_shared/db/fake-repository.ts';
import type { ToneJudge } from '../_shared/calls/tone-judge.ts';
import type { OwnerCallDetail } from '../_shared/db/owner-call-reads.ts';
import type { TranscriptClient, TranscriptResult } from '../_shared/sarvam-analytics.ts';
import { dashboardSetup, LINK_SECRET } from './__fixtures__/dashboard.ts';
import { munshiSetup } from './__fixtures__/munshi.ts';
import { handleCallsApi } from './handler.ts';
import type { CallsApiDeps } from './types.ts';

const BASE = 'https://ref.supabase.co/functions/v1/calls-api';
const ORIGIN = 'http://localhost:5173';
const DETAIL = `/v1/dashboard/owner-calls/${FAKE_OWNER_CALL_ID}`;

const TURNS = [
  { role: 'assistant', content: 'Namaste Srinivas garu, Munshi here.' },
  { role: 'user', content: 'How much does Ramesh owe?' },
  { role: 'assistant', content: 'Ramesh owes 8,000 rupees.' },
] as const;

function transcripts(result: TranscriptResult): TranscriptClient & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    fetchTranscript(interactionId): Promise<TranscriptResult> {
      asked.push(interactionId);
      return Promise.resolve(result);
    },
    findInteractionId: () => Promise.resolve(null),
  };
}

function deps(
  options: {
    calls?: readonly OwnerCallDetail[];
    client?: TranscriptClient | null;
    judgeTone?: ToneJudge | null;
  } = {},
): { all: CallsApiDeps; setup: ReturnType<typeof dashboardSetup> } {
  const setup = dashboardSetup({
    ...(options.calls ? { ownerCalls: options.calls } : {}),
    munshiTranscripts: options.client ?? null,
    judgeTone: options.judgeTone ?? null,
  });
  const all: CallsApiDeps = {
    repo: createFakeRepository().repo,
    clock: () => FAKE_NOW,
    log: () => {},
    allowedOrigins: [ORIGIN],
    sarvam: { apiKey: 'k', orgId: 'o', workspaceId: 'w', appId: 'a', munshiAppId: 'm' },
    fetchImpl: () => Promise.reject(new Error('no network in tests')),
    kickFollowup: () => 0,
    dashboard: setup.dashboard,
    munshi: munshiSetup().munshi,
  };
  return { all, setup };
}

async function get(
  path: string,
  all: CallsApiDeps,
  token?: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const value = token === undefined ? await signDashboardToken(LINK_SECRET, FAKE_NOW) : token;
  const headers: Record<string, string> = { origin: ORIGIN };
  if (value !== null) headers[DASHBOARD_TOKEN_HEADER] = value;
  const response = await handleCallsApi(new Request(`${BASE}${path}`, { headers }), all);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

Deno.test('owner calls api › no valid dashboard link → 401 and no data', async () => {
  const { all } = deps();
  for (const path of ['/v1/dashboard/owner-calls', DETAIL]) {
    const { status, body } = await get(path, all, null);
    assertEquals(status, 401);
    assertEquals(body['calls'] ?? body['call'], undefined);
  }
});

Deno.test("owner calls api › the list is the owner's Munshi calls with their cost", async () => {
  const { all } = deps();
  const { status, body } = await get('/v1/dashboard/owner-calls', all);
  assertEquals(status, 200);
  const calls = body['calls'] as Array<{ id: string; cost: { inr: number } }>;
  assertEquals(calls.map((one) => one.id), [FAKE_OWNER_CALL_ID]);
  assert((calls[0]?.cost.inr ?? 0) > 0);
});

Deno.test('owner calls api › one call: transcript fetched once and kept, scorecard, no interaction id', async () => {
  const client = transcripts({ kind: 'ready', turns: TURNS });
  const { all, setup } = deps({ client });
  const { status, body } = await get(DETAIL, all);
  assertEquals(status, 200);
  const call = body['call'] as Record<string, unknown> & {
    transcript: unknown[];
    scorecard: { groups: Array<{ name: string }>; toolUse: Array<{ tool: string }> };
    trace: unknown[];
  };
  assertEquals(client.asked, ['20261120/munshi-1']);
  assertEquals(call.transcript.length, 3);
  assertEquals(setup.ownerCalls.transcript?.length, 3);
  assertEquals(call.scorecard.groups[0]?.name, 'Guardrails');
  assert(call.scorecard.toolUse.some((row) => row.tool === 'lookup_shopkeeper'));
  assertEquals(call['interactionId'], undefined);
  assertEquals(call.trace, []);
});

Deno.test('owner calls api › a kept transcript is not fetched again; Sarvam not ready still shows the call', async () => {
  const kept = transcripts({ kind: 'ready', turns: TURNS });
  await get(
    DETAIL,
    deps({ client: kept, calls: [fakeOwnerCallDetail({ transcript: [...TURNS] })] }).all,
  );
  assertEquals(kept.asked, []);
  const late = transcripts({ kind: 'not_ready' });
  const { status, body } = await get(DETAIL, deps({ client: late }).all);
  assertEquals(status, 200);
  assertEquals((body['call'] as { transcript: unknown }).transcript, null);
});

Deno.test('owner calls api › an unknown call is 404', async () => {
  const { all } = deps();
  const { status } = await get(
    '/v1/dashboard/owner-calls/ca000000-0000-4000-8000-0000000000ff',
    all,
  );
  assertEquals(status, 404);
});

Deno.test('owner calls api › tone is judged once, saved, and shown as its own group', async () => {
  const asked: string[] = [];
  const judgeTone: ToneJudge = (agent) => {
    asked.push(agent);
    return Promise.resolve({
      version: 'v1',
      model: 'gemini-2.5-flash',
      points: [{ id: 'clear', score: 3, reason: 'Long list in one turn.' }],
    });
  };
  const fresh = deps({ judgeTone, calls: [fakeOwnerCallDetail({ transcript: [...TURNS] })] });
  const { body } = await get(DETAIL, fresh.all);
  const groups = (body['call'] as { scorecard: { groups: Array<{ name: string }> } }).scorecard
    .groups;
  assertEquals(groups.at(-1)?.name, 'Tone');
  assertEquals(asked, ['munshi']);
  assertEquals(fresh.setup.ownerCalls.tone?.points[0]?.score, 3);
  assertEquals((body['call'] as Record<string, unknown>)['toneJudgement'], undefined);
  const kept = fakeOwnerCallDetail({
    transcript: [...TURNS],
    toneJudgement: { version: 'v1', model: 'gemini-2.5-flash', points: [] },
  });
  await get(DETAIL, deps({ judgeTone, calls: [kept] }).all);
  assertEquals(asked, ['munshi']);
});
