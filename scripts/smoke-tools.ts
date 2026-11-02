// scripts/smoke-tools.ts
// npm run smoke:tools — end-to-end check of the deployed functions against the real database,
// with no voice and no Sarvam minutes: ring → incoming → accept → (proxy) → Asha's 5 tools →
// ended. Plays Sarvam's side by POSTing tool requests with the bearer secret. Removes every row
// it created at the end. Prints statuses and fake demo figures only, never keys.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { addDays, istDate } from '../supabase/functions/_shared/clock.ts';
import { RAMESH_STORY } from './seed/ramesh.ts';
import { shopkeeperId } from './seed/generate-seed.ts';

const RAMESH_ID = shopkeeperId(0);
const DIGITS = /\d/;
const JsonObject = z.record(z.string(), z.unknown());
const IncomingSchema = z.object({
  call: z.object({ callToken: z.string(), callerName: z.string() }).nullable(),
});

interface ApiRequest {
  readonly method?: string;
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

interface Smoke {
  readonly functionsUrl: string;
  readonly anonKey: string;
  readonly toolSecret: string;
  readonly appId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly admin: SupabaseClient;
}

interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly region: string | null;
}

let failures = 0;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

function report(passed: boolean, line: string): void {
  if (!passed) failures += 1;
  process.stdout.write(`${passed ? 'ok  ' : 'FAIL'} ${line}\n`);
}

function warn(line: string): void {
  process.stdout.write(`warn ${line}\n`);
}

async function send(url: string, init: RequestInit): Promise<Reply> {
  const response = await fetch(url, init);
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null; // Not JSON: the checks below report it as a failure.
  }
  const body = JsonObject.safeParse(parsed).data ?? { raw: text.slice(0, 80) };
  return { status: response.status, body, region: response.headers.get('x-sb-edge-region') };
}

function appApi(smoke: Smoke, path: string, request: ApiRequest = {}): Promise<Reply> {
  const headers = {
    Authorization: `Bearer ${smoke.anonKey}`,
    apikey: smoke.anonKey,
    'content-type': 'application/json',
    ...request.headers,
  };
  const init: RequestInit = { method: request.method ?? 'GET', headers };
  if (request.body !== undefined) init.body = request.body;
  return send(`${smoke.functionsUrl}/calls-api${path}`, init);
}

function tool(smoke: Smoke, name: string, body: Record<string, unknown>): Promise<Reply> {
  return send(`${smoke.functionsUrl}/sarvam-tools/${name}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${smoke.toolSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function countRows(smoke: Smoke, table: string, callId: string): Promise<number> {
  const { count, error } = await smoke.admin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('call_id', callId);
  if (error) throw new Error(`Count failed for ${table} (${error.code})`);
  return count ?? 0;
}

/** The first request after idle can get a 503 while the function boots (seen in the spike). */
async function warmUp(smoke: Smoke): Promise<void> {
  const url = `${smoke.functionsUrl}/sarvam-tools/get_dues`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const reply = await send(url, { method: 'POST', body: '{}' });
    if (reply.status !== 503) return;
    warn(`sarvam-tools cold start: 503 on attempt ${attempt}, retrying`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function checkSecret(smoke: Smoke): Promise<void> {
  await warmUp(smoke);
  const url = `${smoke.functionsUrl}/sarvam-tools/get_dues`;
  const wrong = await send(url, {
    method: 'POST',
    headers: { authorization: 'Bearer wrong-secret-wrong-secret-wrong-secret' },
    body: '{}',
  });
  const missing = await send(url, { method: 'POST', body: '{}' });
  report(
    wrong.status === 401 && missing.status === 401,
    `tools: wrong or missing secret → 401 (got ${wrong.status}, ${missing.status})`,
  );
}

async function ringAndAnswer(smoke: Smoke): Promise<string | null> {
  const ring = await appApi(smoke, '/v1/demo/ring', { method: 'POST', body: '{}' });
  report(ring.status === 201, `ring → ${ring.status} ${JSON.stringify(ring.body)}`);
  const incoming = await appApi(smoke, '/v1/phone/incoming');
  const call = IncomingSchema.safeParse(incoming.body).data?.call ?? null;
  report(Boolean(call?.callToken), `incoming → rings from "${call?.callerName ?? 'nobody'}"`);
  process.stdout.write(`     calls-api ran in region: ${incoming.region ?? 'unknown'}\n`);
  return call?.callToken ?? null;
}

async function acceptCall(smoke: Smoke, token: string): Promise<void> {
  const accept = await appApi(smoke, `/v1/calls/${token}/accept`, { method: 'POST', body: '{}' });
  if (accept.status === 200) {
    report(
      accept.body['today'] !== undefined,
      `accept → 200, today "${String(accept.body['today'])}"`,
    );
    return;
  }
  const notConfigured = accept.status === 503 && !smoke.appId;
  report(notConfigured, `accept → ${accept.status} (expected 503 while SARVAM_APP_ID is empty)`);
  // Stand in for Accept so the tool checks can still run before Asha exists in Sarvam.
  const { error } = await smoke.admin
    .from('calls')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', token);
  if (error) throw new Error(`Could not mark the call accepted (${error.code})`);
  warn('SARVAM_APP_ID empty: call marked accepted directly; proxy check skipped');
}

async function checkProxy(smoke: Smoke, token: string): Promise<void> {
  if (!smoke.appId) return;
  const path = `/v1/sarvam/orgs/${smoke.orgId}/workspaces/${smoke.workspaceId}/apps/${smoke.appId}/url?interaction_type=call`;
  const headers = { 'x-call-token': token, 'x-api-key': '' };
  const first = await appApi(smoke, path, { headers });
  report(
    first.status === 200 && typeof first.body['url'] === 'string',
    `proxy → ${first.status}, signed URL ${typeof first.body['url'] === 'string' ? 'returned (not opened)' : 'missing'}`,
  );
  const second = await appApi(smoke, path, { headers });
  report(
    second.status === 403,
    `proxy second URL for the same token → ${second.status} (expected 403)`,
  );
}

async function checkIdentityAndDues(smoke: Smoke, token: string): Promise<void> {
  const early = await tool(smoke, 'get_dues', { call_token: token });
  const earlySay = String(early.body['say'] ?? '');
  report(
    early.body['ok'] === false && !DIGITS.test(earlySay),
    `get_dues before identity → refused, no figures ("${earlySay}")`,
  );
  const confirm = await tool(smoke, 'confirm_identity', { call_token: token, answer: 'confirmed' });
  report(confirm.body['ok'] === true, `confirm_identity → ${String(confirm.body['say'])}`);
  const dues = await tool(smoke, 'get_dues', { call_token: token });
  const figures = `outstanding ${String(dues.body['outstanding'])}, overdue ${String(dues.body['overdue_amount'])} for ${String(dues.body['days_overdue'])} days, next ${String(dues.body['next_due_amount'])} on ${String(dues.body['next_due_date'])}`;
  report(
    dues.body['outstanding'] === RAMESH_STORY.outstanding &&
      dues.body['overdue_amount'] === RAMESH_STORY.overdueAmount,
    `get_dues → ${figures}`,
  );
  process.stdout.write(`     Asha would say: "${String(dues.body['say'])}"\n`);
}

/** New terms in the same call update the one promise row (latest wins). */
async function checkPromiseUpdate(smoke: Smoke, token: string, newDate: string): Promise<void> {
  const changed = await tool(smoke, 'log_promise', {
    call_token: token,
    amount: 3000,
    promise_date: newDate,
  });
  const { data, error } = await smoke.admin
    .from('promises')
    .select('promise_date')
    .eq('call_id', token);
  if (error) throw new Error(`Promise read failed (${error.code})`);
  const rows = z.array(z.object({ promise_date: z.string() })).parse(data ?? []);
  const saved = rows[0]?.promise_date ?? 'none';
  report(
    changed.body['updated'] === true && rows.length === 1 && saved === newDate,
    `log_promise new date → ${rows.length} row, now ${saved} ("${String(changed.body['say'])}")`,
  );
}

async function checkPromiseAndClaim(smoke: Smoke, token: string): Promise<void> {
  const today = istDate(new Date());
  const promise = { call_token: token, amount: 3000, promise_date: addDays(today, 3) };
  const [first, second] = [
    await tool(smoke, 'log_promise', promise),
    await tool(smoke, 'log_promise', promise),
  ];
  const promises = await countRows(smoke, 'promises', token);
  report(
    first.body['ok'] === true && promises === 1,
    `log_promise twice → ${promises} row ("${String(second.body['say'])}")`,
  );
  await checkPromiseUpdate(smoke, token, addDays(today, 4));
  const claim = { call_token: token, amount: 500, paid_date: today, mode: 'upi' };
  const claimed = await tool(smoke, 'record_payment_claim', claim);
  const after = await tool(smoke, 'get_dues', { call_token: token });
  report(
    claimed.body['ok'] === true && after.body['outstanding'] === RAMESH_STORY.outstanding,
    `record_payment_claim → claimed; balance unchanged at ${String(after.body['outstanding'])}`,
  );
  const callback = {
    call_token: token,
    reason: 'dispute',
    summary: 'Smoke test: disputes one bill.',
  };
  const asked = await tool(smoke, 'request_owner_callback', callback);
  const followups = await countRows(smoke, 'followups', token);
  report(
    asked.body['ok'] === true && followups === 1,
    `request_owner_callback → ${followups} follow-up row`,
  );
}

async function checkEndedAndAudit(smoke: Smoke, token: string): Promise<void> {
  const ended = await appApi(smoke, `/v1/calls/${token}/ended`, {
    method: 'POST',
    body: JSON.stringify({ seconds: 5 }),
  });
  report(ended.status === 200, `ended → ${ended.status} ${JSON.stringify(ended.body)}`);
  const late = await tool(smoke, 'get_dues', { call_token: token });
  report(
    late.status === 200 && late.body['ok'] === false,
    `tool after the call ended → refused ("${String(late.body['say'])}")`,
  );
  const audits = await countRows(smoke, 'tool_events', token);
  report(audits >= 9, `audit rows written: ${audits}`);
}

async function openPromiseIds(smoke: Smoke): Promise<string[]> {
  const { data, error } = await smoke.admin
    .from('promises')
    .select('id')
    .eq('shopkeeper_id', RAMESH_ID)
    .eq('status', 'open');
  if (error) throw new Error(`Promise read failed (${error.code})`);
  return z
    .array(z.object({ id: z.string() }))
    .parse(data ?? [])
    .map((row) => row.id);
}

async function cleanUp(smoke: Smoke, token: string, reopen: readonly string[]): Promise<void> {
  for (const table of ['tool_events', 'promises', 'ledger_entries', 'followups']) {
    const { error } = await smoke.admin.from(table).delete().eq('call_id', token);
    if (error) throw new Error(`Cleanup failed for ${table} (${error.code})`);
  }
  const { error } = await smoke.admin.from('calls').delete().eq('id', token);
  if (error) throw new Error(`Cleanup failed for calls (${error.code})`);
  if (reopen.length > 0) {
    await smoke.admin
      .from('promises')
      .update({ status: 'open' })
      .in('id', [...reopen]);
  }
  process.stdout.write('     test rows removed\n');
}

const smoke: Smoke = {
  functionsUrl: `${requireEnv('SUPABASE_URL').replace(/\/$/, '')}/functions/v1`,
  anonKey: requireEnv('SUPABASE_ANON_KEY'),
  toolSecret: requireEnv('SARVAM_TOOL_SECRET'),
  appId: process.env['SARVAM_APP_ID']?.trim() ?? '',
  orgId: requireEnv('SARVAM_ORG_ID'),
  workspaceId: requireEnv('SARVAM_WORKSPACE_ID'),
  admin: createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY')),
};

await checkSecret(smoke);
const reopen = await openPromiseIds(smoke);
const token = await ringAndAnswer(smoke);
if (token) {
  try {
    await acceptCall(smoke, token);
    await checkProxy(smoke, token);
    await checkIdentityAndDues(smoke, token);
    await checkPromiseAndClaim(smoke, token);
    await checkEndedAndAudit(smoke, token);
  } finally {
    await cleanUp(smoke, token, reopen);
  }
}

process.stdout.write(
  failures === 0 ? '\nTools smoke passed\n' : `\nTools smoke FAILED (${failures})\n`,
);
process.exit(failures === 0 ? 0 : 1);
