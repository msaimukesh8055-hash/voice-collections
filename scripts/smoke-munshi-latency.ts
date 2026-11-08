// scripts/smoke-munshi-latency.ts
// npm run smoke:munshi-latency — Munshi's latency run (M8 C2, Decision 4), against the deployed
// munshi-tools and the real database, with no voice and no LLM (₹0):
//   1. creates a test owner call for Srinivas (service key, Supabase REST): status accepted,
//      accepted_at now, so munshi-tools accepts its id as the owner_call_token
//   2. 20 rounds of: book_summary, lookup_shopkeeper, and six prepare_* each followed by
//      cancel_action, with SARVAM_OWNER_TOOL_SECRET as the bearer (as Sarvam sends it).
//      confirm_action is NEVER called, so the book does not change (cancelled voice actions and
//      audit rows stay, as on any call)
//   3. reads the server time of every call from owner_tool_events and prints p50 / p95 / max per
//      tool (plus the laptop round trip); exits 1 if any tool's server p95 is ≥ 500 ms
//   4. always marks the test owner call completed at the end
// While it runs (~1–2 minutes) the phone line counts as busy, and the call uses one of the 3
// "Call Munshi" links allowed per 10 minutes. Prints tool names, codes and timings only, never
// a key or the token.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  OWNER_CALL_TOKEN_VARIABLE,
  WARM_TOOLS_PATH,
} from '../supabase/functions/_shared/sarvam.ts';
import {
  formatLatencyTable,
  latencyProblems,
  RUNS_PER_TOOL,
  type Sample,
  statsByTool,
} from './lib/latency.ts';
import { requireEnv } from './lib/smoke.ts';
import { OWNER, RAMESH } from './seed/names.ts';

const LINK_TTL_MS = 15 * 60_000;
const MAX_EVENTS = 1_000;
/** Refusals that are real book answers (the tool still did its reads), not a broken run. */
const BOOK_ANSWERS: ReadonlySet<string> = new Set([
  'NO_OPEN_CLAIM',
  'NOTHING_OWED',
  'NOTHING_TO_DELETE',
]);

const ReplySchema = z.looseObject({ ok: z.boolean(), code: z.string().optional() });
const EventSchema = z.object({ tool: z.string(), duration_ms: z.number().nullable() });
const CallRowSchema = z.object({ id: z.uuid() });

interface Run {
  readonly toolsUrl: string;
  readonly secret: string;
  readonly admin: SupabaseClient;
}

type Args = Readonly<Record<string, string | number>>;

/** Each prepare and its arguments (Ramesh is in the seed); each is followed by cancel_action. */
const PREPARES: readonly (readonly [string, Args])[] = [
  ['prepare_credit', { name: RAMESH.name, amount: 500 }],
  ['prepare_payment', { name: RAMESH.name, amount: 500 }],
  ['prepare_delete', { name: RAMESH.name }],
  ['prepare_remind', { name: RAMESH.name }],
  ['prepare_claim', { name: RAMESH.name, decision: 'not_received' }],
  ['prepare_send', { what: 'pending' }],
];
const READS: readonly (readonly [string, Args])[] = [
  ['book_summary', { focus: 'overview' }],
  ['lookup_shopkeeper', { name: RAMESH.name }],
];
const TOOLS = [...READS.map(([name]) => name), ...PREPARES.map(([name]) => name), 'cancel_action'];

async function createTestCall(run: Run): Promise<string> {
  const now = Date.now();
  const { data, error } = await run.admin
    .from('owner_calls')
    .insert({
      owner_id: OWNER.id,
      status: 'accepted',
      expires_at: new Date(now + LINK_TTL_MS).toISOString(),
      accepted_at: new Date(now).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create the test owner call (${error.code})`);
  return CallRowSchema.parse(data).id;
}

async function callTool(
  run: Run,
  token: string,
  tool: readonly [string, Args],
): Promise<{ ms: number; code: string | null }> {
  const started = performance.now();
  const response = await fetch(`${run.toolsUrl}/${tool[0]}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${run.secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ [OWNER_CALL_TOKEN_VARIABLE]: token, ...tool[1] }),
  });
  const body = ReplySchema.safeParse(await response.json().catch(() => null));
  const ms = Math.round(performance.now() - started);
  if (!response.ok || !body.success) return { ms, code: `HTTP_${response.status}` };
  return { ms, code: body.data.ok ? null : (body.data.code ?? 'UNKNOWN') };
}

async function oneRound(
  run: Run,
  token: string,
  record: (tool: string, reply: { ms: number; code: string | null }) => void,
): Promise<void> {
  for (const read of READS) record(read[0], await callTool(run, token, read));
  for (const prepare of PREPARES) {
    record(prepare[0], await callTool(run, token, prepare));
    record('cancel_action', await callTool(run, token, ['cancel_action', {}]));
  }
}

async function serverSamples(run: Run, token: string): Promise<readonly Sample[]> {
  const { data, error } = await run.admin
    .from('owner_tool_events')
    .select('tool, duration_ms')
    .eq('owner_call_id', token)
    .limit(MAX_EVENTS);
  if (error) throw new Error(`could not read owner_tool_events (${error.code})`);
  return z
    .array(EventSchema)
    .parse(data)
    .flatMap((row) => (row.duration_ms === null ? [] : [{ tool: row.tool, ms: row.duration_ms }]));
}

async function endTestCall(run: Run, token: string, startedAt: number): Promise<void> {
  const { error } = await run.admin
    .from('owner_calls')
    .update({
      status: 'completed',
      ended_at: new Date().toISOString(),
      duration_seconds: Math.round((Date.now() - startedAt) / 1000),
    })
    .eq('id', token)
    .in('status', ['accepted', 'in_progress']);
  process.stdout.write(
    error
      ? `FAIL could not mark the test owner call completed (${error.code})\n`
      : 'ok   test owner call marked completed\n',
  );
}

async function measure(run: Run, token: string): Promise<readonly string[]> {
  const roundTrips: Sample[] = [];
  const refusals = new Set<string>();
  function record(tool: string, reply: { ms: number; code: string | null }): void {
    roundTrips.push({ tool, ms: reply.ms });
    if (reply.code !== null && !BOOK_ANSWERS.has(reply.code)) refusals.add(`${tool} ${reply.code}`);
  }
  await fetch(`${run.toolsUrl}/${WARM_TOOLS_PATH}`);
  for (let round = 1; round <= RUNS_PER_TOOL; round += 1) {
    await oneRound(run, token, record);
    process.stdout.write(`     round ${round}/${RUNS_PER_TOOL}\n`);
  }
  const server = statsByTool(await serverSamples(run, token), TOOLS);
  process.stdout.write(`\n${formatLatencyTable(server, statsByTool(roundTrips, TOOLS))}\n\n`);
  return latencyProblems(server, [...refusals]);
}

async function main(): Promise<void> {
  const url = requireEnv('SUPABASE_URL').replace(/\/$/, '');
  const run: Run = {
    toolsUrl: `${url}/functions/v1/munshi-tools`,
    secret: requireEnv('SARVAM_OWNER_TOOL_SECRET'),
    admin: createClient(url, requireEnv('SUPABASE_SERVICE_ROLE_KEY')),
  };
  const startedAt = Date.now();
  const token = await createTestCall(run);
  process.stdout.write('ok   test owner call created\n');
  let problems: readonly string[] = ['the run did not finish'];
  try {
    problems = await measure(run, token);
  } finally {
    await endTestCall(run, token, startedAt);
  }
  problems.forEach((problem) => process.stdout.write(`FAIL ${problem}\n`));
  process.stdout.write(
    problems.length === 0
      ? 'Munshi latency run passed (every tool p95 < 500 ms)\n'
      : 'Munshi latency run FAILED\n',
  );
  process.exitCode = problems.length === 0 ? 0 : 1;
}

await main();
