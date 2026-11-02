// scripts/smoke-webhook.ts
// End-to-end check of the deployed functions against the real database, with fake Vapi tool
// calls: no voice, no Vapi credit. Uses seeded borrower Ravi Sharma (fake data).
// Prints pass/fail per check and timings; never prints keys or the webhook secret.
import { randomUUID } from 'node:crypto';
import { addDays, istDate } from '../supabase/functions/_shared/clock.ts';
import { REGION_HEADER } from '../supabase/functions/_shared/region.ts';
import { VAPI_SECRET_HEADER } from '../supabase/functions/_shared/vapi.ts';

const RAVI = { id: 'c0000000-0000-4000-8000-000000000001', dob: '1988-04-12', overdue: 4200 };
const REQUEST_TIMEOUT_MS = 15_000;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

const supabaseUrl = requireEnv('SUPABASE_URL');
const anonKey = requireEnv('SUPABASE_ANON_KEY');
const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
const secret = requireEnv('VAPI_WEBHOOK_SECRET');
const region = requireEnv('SUPABASE_REGION');
const webhookUrl = `${supabaseUrl}/functions/v1/vapi-webhook`;

let failures = 0;
const timings: number[] = [];
/** Regions the webhook actually ran in, from Supabase's x-sb-edge-region response header. */
const edgeRegions = new Set<string>();

function check(label: string, passed: boolean): void {
  if (!passed) failures += 1;
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'}  ${label}\n`);
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [REGION_HEADER]: region, ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/** A simulated Vapi call: its own id plus the call token the browser would pass. */
interface SimulatedCall {
  readonly vapiCallId: string;
  readonly token: string;
}

function toolCallsBody(call: SimulatedCall, name: string, args: unknown): unknown {
  return {
    message: {
      type: 'tool-calls',
      call: { id: call.vapiCallId, assistantOverrides: { metadata: { callToken: call.token } } },
      toolCallList: [{ id: randomUUID(), type: 'function', function: { name, arguments: args } }],
    },
  };
}

interface ToolReply {
  readonly ok: boolean;
  readonly code?: string;
  readonly data?: Record<string, unknown>;
}

async function callTool(call: SimulatedCall, name: string, args: unknown): Promise<ToolReply> {
  const started = performance.now();
  const response = await postJson(webhookUrl, toolCallsBody(call, name, args), {
    [VAPI_SECRET_HEADER]: secret,
  });
  timings.push(performance.now() - started);
  edgeRegions.add(response.headers.get('x-sb-edge-region') ?? 'unknown');
  const body = (await response.json()) as { results: { result: string }[] };
  return JSON.parse(body.results[0]?.result ?? '{}') as ToolReply;
}

async function authoriseRavi(): Promise<string> {
  const response = await postJson(
    `${supabaseUrl}/functions/v1/calls-api/v1/calls/authorize`,
    { customerId: RAVI.id },
    { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
  );
  const body = (await response.json()) as { callToken?: string; error?: { message: string } };
  check(`authorise Ravi → 201 (got ${response.status})`, response.status === 201);
  if (!body.callToken) throw new Error(`Authorise failed: ${body.error?.message ?? 'no token'}`);
  return body.callToken;
}

async function countRows(table: string, callId: string): Promise<number> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?call_id=eq.${callId}&select=id`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return ((await response.json()) as unknown[]).length;
}

const serviceHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

interface DemoSettingsRow {
  readonly demo_clock: string | null;
  readonly calling_hours_enabled: boolean;
}

async function readDemoSettings(): Promise<DemoSettingsRow> {
  const columns = 'demo_clock,calling_hours_enabled';
  const response = await fetch(`${supabaseUrl}/rest/v1/demo_settings?id=eq.1&select=${columns}`, {
    headers: serviceHeaders,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const rows = (await response.json()) as DemoSettingsRow[];
  return rows[0] ?? { demo_clock: null, calling_hours_enabled: false };
}

/** The smoke test changes the demo settings so it runs at any hour, and restores them after. */
async function setDemoSettings(settings: DemoSettingsRow): Promise<void> {
  const response = await fetch(`${supabaseUrl}/rest/v1/demo_settings?id=eq.1`, {
    method: 'PATCH',
    headers: serviceHeaders,
    body: JSON.stringify(settings),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Could not set demo settings (${response.status})`);
}

function istTimeToday(time: string): string {
  return `${istDate(new Date())}T${time}:00+05:30`;
}

async function checkBlockedAtNight(): Promise<void> {
  await setDemoSettings({ demo_clock: istTimeToday('21:00'), calling_hours_enabled: true });
  const response = await postJson(
    `${supabaseUrl}/functions/v1/calls-api/v1/calls/authorize`,
    { customerId: RAVI.id },
    { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
  );
  const body = (await response.json()) as { error?: { code: string } };
  check(
    'calling hours on + demo clock 21:00 IST → call blocked',
    body.error?.code === 'OUTSIDE_CALLING_HOURS',
  );
}

async function checkWrongSecret(): Promise<void> {
  const body = toolCallsBody({ vapiCallId: 'smoke', token: randomUUID() }, 'lookup_loan', {});
  const response = await postJson(webhookUrl, body, { [VAPI_SECRET_HEADER]: 'wrong-secret' });
  check(`wrong secret → 401 (got ${response.status})`, response.status === 401);
}

async function checkToolFlow(call: SimulatedCall): Promise<void> {
  const early = await callTool(call, 'lookup_loan', {});
  check('lookup before verification → NOT_VERIFIED', early.code === 'NOT_VERIFIED');
  const wrong = await callTool(call, 'verify_customer', { dob: '1990-01-01' });
  check('wrong DOB → not verified, 1 attempt left', wrong.data?.['attemptsLeft'] === 1);
  const right = await callTool(call, 'verify_customer', { dob: RAVI.dob });
  check('right DOB → verified', right.data?.['verified'] === true);
  const loan = await callTool(call, 'lookup_loan', {});
  check(`lookup → overdue ₹${RAVI.overdue}`, loan.data?.['overdueAmount'] === RAVI.overdue);
  const promiseDate = addDays(istDate(new Date()), 3);
  const promise = { amount: RAVI.overdue, promiseDate, paymentMode: 'upi' };
  const logged = await callTool(call, 'log_promise_to_pay', promise);
  check('promise logged', logged.data?.['logged'] === true);
}

async function checkCallFlow(): Promise<void> {
  await setDemoSettings({ demo_clock: istTimeToday('12:00'), calling_hours_enabled: true });
  const token = await authoriseRavi();
  await checkToolFlow({ vapiCallId: `smoke-${randomUUID()}`, token });
  const replay = await callTool({ vapiCallId: `smoke-${randomUUID()}`, token }, 'lookup_loan', {});
  check(
    'same token from another Vapi call → CALL_NOT_AUTHORISED',
    replay.code === 'CALL_NOT_AUTHORISED',
  );
  check('promise row in database', (await countRows('promises', token)) === 1);
  check('5 audit rows in tool_events', (await countRows('tool_events', token)) === 5);
}

await checkWrongSecret();
const originalSettings = await readDemoSettings();
try {
  await checkBlockedAtNight();
  await checkCallFlow();
} finally {
  await setDemoSettings(originalSettings);
}

check(
  `webhook ran in ${region} only (saw: ${[...edgeRegions].join(', ')})`,
  edgeRegions.size === 1 && edgeRegions.has(region),
);

const sorted = [...timings].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
process.stdout.write(
  `\nWebhook round trip from here: median ${median.toFixed(0)} ms, ` +
    `min ${(sorted[0] ?? 0).toFixed(0)} ms, max ${(sorted.at(-1) ?? 0).toFixed(0)} ms ` +
    `(${timings.length} calls; includes India → Oregon network; cold start if idle)\n`,
);
process.stdout.write(failures === 0 ? 'All checks passed\n' : `${failures} check(s) failed\n`);
process.exitCode = failures === 0 ? 0 : 1;
