// scripts/smoke-reminders.ts
// npm run smoke:reminders — the M5 reminder loop on the deployed functions and the real database
// (M5 plan, test list "Smoke script"). Signed Meta-shaped messages go to whatsapp-webhook as in
// smoke:whatsapp; followup-worker is called with WORKER_SECRET, as pg_cron does.
//   Always:           followup-worker refuses a missing or wrong secret (401) and accepts the right
//                     one (/sweep → 202: the same job pg_cron runs every minute).
//   --send-to-owner:  "due" → the due alert is built and answered; a [Remind] tap for one
//                     shopkeeper who owes money (not the demo's Ramesh, to keep his memory clean)
//                     → one LIVE call queued (Live remind, pre-M6: one-person Remind always rings
//                     the phone page) → declined through calls-api, as the phone page's Decline
//                     does (no voice minutes) → follow-up done, one run and one note. Then one
//                     simulated call (what "remind all" queues) is inserted for the same person and
//                     the worker woken, as the webhook does → it runs end to end (Asha on
//                     sarvam-105b vs the persona) → follow-up done, one run, one note, audited tool
//                     calls. Both summaries go to the owner's WhatsApp: check them by eye (nothing
//                     in the database records the send).
// ⚠️ With --send-to-owner the functions MESSAGE THE OWNER'S REAL WHATSAPP (the alert, "calling…"
// and two summaries; free inside the 24-hour window), and the simulated call costs about ₹1 of
// LLM. If /phone is open it rings briefly before the script declines the call.
// Every row the script creates is removed at the end, and a promise the call replaced is reopened
// (the shopkeeper's stored score is left; it is recalculated on the next call or check).
// Prints statuses and counts only, never keys, the owner's number or call text.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { remindButtonId } from '../supabase/functions/_shared/cards/ids.ts';
import { REGION_HEADER } from '../supabase/functions/_shared/region.ts';
import {
  digits,
  metaPayload,
  type MetaMessage,
  postWebhook,
  senderHash,
  sign,
  tapMessage,
  textMessage,
} from './lib/meta-webhook.ts';
import { createReporter, poll, requireEnv } from './lib/smoke.ts';

const SEND_TO_OWNER = process.argv.includes('--send-to-owner');
const RUN = `SMOKE-REMIND-${Date.now()}`;
const RECENT_CALL_MS = 60 * 60 * 1000;
/** Webhook replies land within seconds. */
const QUICK = { tries: 20, delayMs: 1000 } as const;
/** A simulated call is up to 10 turns of two LLMs, then the follow-up: allow 5 minutes. */
const SLOW = { tries: 60, delayMs: 5000 } as const;
const ENDED = ['completed', 'declined', 'missed'];
const FOLLOWED_UP = ['done', 'failed'];

interface Smoke {
  readonly functionsUrl: string;
  readonly anonKey: string;
  readonly region: string;
  readonly appSecret: string;
  readonly phoneNumberId: string;
  readonly workerSecret: string;
  readonly admin: SupabaseClient;
  readonly startedAt: string;
}

interface Target {
  readonly id: string;
  readonly language: string;
  /** Open promises before the run: a promise the call logs replaces them (reopened in cleanup). */
  readonly openPromises: readonly string[];
}

const { report, failures } = createReporter();
let messageCounter = 0;

function nextMessageId(): string {
  messageCounter += 1;
  return `wamid.${RUN}-${messageCounter}`;
}

const IdRows = z.array(z.object({ id: z.string() }));

function fail(table: string, code: string): never {
  throw new Error(`${table} read failed (${code})`);
}

async function postWorker(smoke: Smoke, path: string, secret: string | null): Promise<number> {
  const headers: Record<string, string> = {};
  if (secret !== null) headers['authorization'] = `Bearer ${secret}`;
  const response = await fetch(`${smoke.functionsUrl}/followup-worker${path}`, {
    method: 'POST',
    headers,
  });
  await response.text();
  return response.status;
}

async function checkWorkerSecret(smoke: Smoke): Promise<void> {
  const missing = await postWorker(smoke, '/sweep', null);
  const wrong = await postWorker(smoke, '/sweep', 'not-the-worker-secret');
  const right = await postWorker(smoke, '/sweep', smoke.workerSecret);
  report(
    missing === 401 && wrong === 401 && right === 202,
    `worker: no secret / wrong secret / right secret → ${missing}, ${wrong}, ${right}`,
  );
}

async function ownerSend(smoke: Smoke, owner: string, message: MetaMessage): Promise<number> {
  const body = metaPayload(smoke.phoneNumberId, owner, message);
  return postWebhook(`${smoke.functionsUrl}/whatsapp-webhook`, body, sign(smoke.appSecret, body));
}

async function answeredAs(smoke: Smoke, messageId: string): Promise<string | null> {
  const { data, error } = await smoke.admin
    .from('wa_messages')
    .select('path,command')
    .eq('wa_message_id', messageId);
  if (error) fail('wa_messages', error.code);
  const Rows = z.array(z.object({ path: z.string().nullable(), command: z.string().nullable() }));
  const row = Rows.parse(data ?? [])[0];
  return row && row.path !== null ? (row.command ?? '-') : null;
}

async function checkOwnerMessage(
  smoke: Smoke,
  owner: string,
  step: { readonly message: MetaMessage; readonly expected: string; readonly label: string },
): Promise<void> {
  const status = await ownerSend(smoke, owner, step.message);
  const command = await poll(() => answeredAs(smoke, String(step.message['id'])), QUICK);
  report(
    status === 200 && command === step.expected,
    `owner ${step.label} → ${status}, answered as ${command ?? 'nothing'}`,
  );
}

async function liveShopkeeperId(smoke: Smoke): Promise<string | null> {
  const { data, error } = await smoke.admin.from('demo_settings').select('live_shopkeeper_id');
  if (error) fail('demo_settings', error.code);
  const Rows = z.array(z.object({ live_shopkeeper_id: z.string().nullable() }));
  return Rows.parse(data ?? [])[0]?.live_shopkeeper_id ?? null;
}

async function idsOf(
  smoke: Smoke,
  table: string,
  build: (query: ReturnType<SupabaseClient['from']>) => PromiseLike<{
    data: unknown;
    error: { code: string } | null;
  }>,
): Promise<Set<string>> {
  const { data, error } = await build(smoke.admin.from(table));
  if (error) fail(table, error.code);
  return new Set(IdRows.parse(data ?? []).map((row) => row.id));
}

/** Shopkeepers the smoke may call: not do-not-call, not called in the last hour, not paused by a
 * follow-up, and not the demo's live shopkeeper (Ramesh), whose memory the demo relies on. */
async function blockedIds(smoke: Smoke): Promise<Set<string>> {
  const since = new Date(Date.now() - RECENT_CALL_MS).toISOString();
  const [recent, paused, doNotCall, live] = await Promise.all([
    idsOf(smoke, 'calls', (q) => q.select('id:shopkeeper_id').gte('queued_at', since)),
    idsOf(smoke, 'followups', (q) =>
      q.select('id:shopkeeper_id').eq('kind', 'pause_reminders').eq('status', 'pending'),
    ),
    idsOf(smoke, 'shopkeepers', (q) => q.select('id').eq('do_not_call', true)),
    liveShopkeeperId(smoke),
  ]);
  return new Set([...recent, ...paused, ...doNotCall, ...(live ? [live] : [])]);
}

async function languageOf(smoke: Smoke, shopkeeperId: string): Promise<string> {
  const { data, error } = await smoke.admin
    .from('shopkeepers')
    .select('language')
    .eq('id', shopkeeperId);
  if (error) fail('shopkeepers', error.code);
  const Rows = z.array(z.object({ language: z.string() }));
  return Rows.parse(data ?? [])[0]?.language ?? 'en';
}

async function pickTarget(smoke: Smoke): Promise<Target | null> {
  const blocked = await blockedIds(smoke);
  const { data, error } = await smoke.admin
    .from('balances')
    .select('shopkeeper_id,outstanding')
    .gt('outstanding', 0)
    .order('outstanding', { ascending: false })
    .limit(50);
  if (error) fail('balances', error.code);
  const Rows = z.array(z.object({ shopkeeper_id: z.string() }));
  const id = Rows.parse(data ?? []).find((row) => !blocked.has(row.shopkeeper_id))?.shopkeeper_id;
  if (!id) return null;
  const [open, language] = await Promise.all([
    idsOf(smoke, 'promises', (q) => q.select('id').eq('shopkeeper_id', id).eq('status', 'open')),
    languageOf(smoke, id),
  ]);
  return { id, language, openPromises: [...open] };
}

interface CallRow {
  readonly id: string;
  readonly mode: string;
  readonly status: string;
  readonly followup_status: string | null;
}

async function newestCall(smoke: Smoke, target: Target): Promise<CallRow | null> {
  const { data, error } = await smoke.admin
    .from('calls')
    .select('id,mode,status,followup_status')
    .eq('shopkeeper_id', target.id)
    .gte('queued_at', smoke.startedAt)
    .order('queued_at', { ascending: false })
    .limit(1);
  if (error) fail('calls', error.code);
  const Rows = z.array(
    z.object({
      id: z.string(),
      mode: z.string(),
      status: z.string(),
      followup_status: z.string().nullable(),
    }),
  );
  return Rows.parse(data ?? [])[0] ?? null;
}

function isFollowedUp(call: CallRow): boolean {
  return ENDED.includes(call.status) && FOLLOWED_UP.includes(call.followup_status ?? '');
}

async function countForCall(smoke: Smoke, table: string, callId: string): Promise<number> {
  const { count, error } = await smoke.admin
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('call_id', callId);
  if (error) fail(table, error.code);
  return count ?? 0;
}

async function followedUp(smoke: Smoke, target: Target, label: string): Promise<CallRow | null> {
  const call = await poll(async () => {
    const latest = await newestCall(smoke, target);
    return latest && isFollowedUp(latest) ? latest : null;
  }, SLOW);
  report(
    call !== null && call.followup_status === 'done',
    `${label} ended → ${call?.status ?? 'not ended'}, follow-up ${call?.followup_status ?? '-'}`,
  );
  if (!call) return null;
  const [runs, notes] = await Promise.all([
    countForCall(smoke, 'followup_runs', call.id),
    countForCall(smoke, 'shopkeeper_notes', call.id),
  ]);
  report(
    runs === 1 && notes === 1,
    `${label}: follow-up run rows ${runs}, notes ${notes} (expected 1 and 1)`,
  );
  return call;
}

/** What the phone page's Decline button sends (anon key, region pinned). */
async function declineAsPhonePage(smoke: Smoke, callId: string): Promise<number> {
  const response = await fetch(`${smoke.functionsUrl}/calls-api/v1/calls/${callId}/decline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${smoke.anonKey}`,
      apikey: smoke.anonKey,
      'content-type': 'application/json',
      [REGION_HEADER]: smoke.region,
    },
    body: '{}',
  });
  await response.text();
  return response.status;
}

async function checkLiveRemind(smoke: Smoke, owner: string, target: Target): Promise<void> {
  const tap = tapMessage(nextMessageId(), remindButtonId(target.id, 'en'), 'Remind');
  await checkOwnerMessage(smoke, owner, { message: tap, expected: 'remind', label: 'Remind tap' });
  const queued = await poll(() => newestCall(smoke, target), QUICK);
  report(
    queued?.mode === 'live',
    `Remind → call queued: ${queued ? `${queued.mode}, ${queued.status}` : 'none (pre-call check?)'}`,
  );
  if (!queued) return;
  const declined = await declineAsPhonePage(smoke, queued.id);
  report(declined === 200, `phone page Decline → ${declined}`);
  await followedUp(smoke, target, 'live call');
  process.stdout.write('     check WhatsApp: a "didn\'t answer" summary with [Try again]\n');
}

/** "Remind all" queues simulated calls and wakes the worker; the smoke does the same for one. */
async function checkSimulatedCall(smoke: Smoke, target: Target): Promise<void> {
  const row = { shopkeeper_id: target.id, language: target.language, mode: 'simulated' };
  const { error } = await smoke.admin.from('calls').insert(row);
  if (error) throw new Error(`calls insert failed (${error.code})`);
  const woken = await postWorker(smoke, '/simulations/next', smoke.workerSecret);
  report(woken === 202, `simulated call queued, worker woken → ${woken}`);
  const call = await followedUp(smoke, target, 'simulated call');
  if (!call) return;
  const audits = await countForCall(smoke, 'tool_events', call.id);
  report(audits >= 1, `tool calls audited: ${audits} (same guards as a live call)`);
  process.stdout.write('     check WhatsApp: a summary labelled "Simulated call" should arrive\n');
}

async function checkRemindLoop(smoke: Smoke, owner: string, target: Target): Promise<void> {
  await checkLiveRemind(smoke, owner, target);
  await checkSimulatedCall(smoke, target);
}

async function deleteWhere(smoke: Smoke, table: string, filter: [string, string]): Promise<void> {
  const { error } = await smoke.admin.from(table).delete().eq(filter[0], filter[1]);
  if (error) throw new Error(`Cleanup failed for ${table} (${error.code})`);
}

async function cleanUpCalls(smoke: Smoke, target: Target): Promise<void> {
  const callIds = await idsOf(smoke, 'calls', (q) =>
    q.select('id').eq('shopkeeper_id', target.id).gte('queued_at', smoke.startedAt),
  );
  const tables = ['tool_events', 'promises', 'ledger_entries', 'followups', 'followup_runs'];
  for (const callId of callIds) {
    for (const table of [...tables, 'shopkeeper_notes']) {
      await deleteWhere(smoke, table, ['call_id', callId]);
    }
    await deleteWhere(smoke, 'calls', ['id', callId]);
  }
  if (target.openPromises.length > 0) {
    const { error } = await smoke.admin
      .from('promises')
      .update({ status: 'open' })
      .in('id', [...target.openPromises]);
    if (error) throw new Error(`Cleanup failed for promises (${error.code})`);
  }
}

async function cleanUp(smoke: Smoke, owner: string, target: Target | null): Promise<void> {
  if (target) await cleanUpCalls(smoke, target);
  const steps = [
    smoke.admin.from('pending_actions').delete().gte('created_at', smoke.startedAt),
    smoke.admin
      .from('wa_messages')
      .delete()
      .eq('sender_hash', senderHash(smoke.appSecret, owner))
      .gte('created_at', smoke.startedAt),
  ];
  for (const step of steps) {
    const { error } = await step;
    if (error) throw new Error(`Cleanup failed (${error.code})`);
  }
  process.stdout.write('     test rows removed\n');
}

async function runOwnerSteps(smoke: Smoke, owner: string): Promise<void> {
  process.stdout.write("     owner steps: messages go to the owner's real WhatsApp\n");
  const target = await pickTarget(smoke);
  try {
    const due = textMessage(nextMessageId(), 'due');
    await checkOwnerMessage(smoke, owner, { message: due, expected: 'due_alert', label: '"due"' });
    report(target !== null, 'found a shopkeeper who owes money and may be called (not Ramesh)');
    if (target) await checkRemindLoop(smoke, owner, target);
  } finally {
    await cleanUp(smoke, owner, target);
  }
}

const smoke: Smoke = {
  functionsUrl: `${requireEnv('SUPABASE_URL').replace(/\/$/, '')}/functions/v1`,
  anonKey: requireEnv('SUPABASE_ANON_KEY'),
  region: requireEnv('SUPABASE_REGION'),
  appSecret: requireEnv('META_APP_SECRET'),
  phoneNumberId: requireEnv('META_PHONE_NUMBER_ID'),
  workerSecret: requireEnv('WORKER_SECRET'),
  admin: createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY')),
  startedAt: new Date().toISOString(),
};

await checkWorkerSecret(smoke);
if (SEND_TO_OWNER) {
  await runOwnerSteps(smoke, digits(requireEnv('OWNER_WHATSAPP_NUMBER')));
} else {
  process.stdout.write(
    '     owner steps skipped (add -- --send-to-owner; sends real WhatsApp messages, ~₹1 LLM)\n',
  );
}

process.stdout.write(
  failures() === 0 ? '\nReminder smoke passed\n' : `\nReminder smoke FAILED (${failures()})\n`,
);
process.exit(failures() === 0 ? 0 : 1);
