// scripts/smoke-whatsapp.ts
// npm run smoke:whatsapp — checks the deployed whatsapp-webhook against the real database by
// POSTing Meta-shaped payloads signed with META_APP_SECRET (Meta itself is not involved inbound).
//   Always:            verify check, bad/missing signature → 401, stranger → one reply a day.
//   --send-to-owner:   pending, lookup, "Ramesh 5000 due 15th" → Save → balance, duplicate id.
// ⚠️ With --send-to-owner the FUNCTION REPLIES OVER WHATSAPP TO THE OWNER'S REAL PHONE (about
// 6 messages, free inside the 24-hour window). Run it only when the owner expects them.
// The stranger step makes the function try to reply to a FAKE number (+91 00000 00777); Meta
// refuses it (not an allowed test recipient), which is fine. Every row the script creates is
// removed at the end. Prints statuses only, never keys or the owner's number. Payloads, signing
// and polling come from scripts/lib (shared with smoke:reminders).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { istDate } from '../supabase/functions/_shared/clock.ts';
import {
  digits,
  metaPayload,
  type MetaMessage,
  postWebhook,
  senderHash as keyedHash,
  sign as signWith,
  tapMessage as tapWithId,
  textMessage as textWithId,
} from './lib/meta-webhook.ts';
import { createReporter, poll as pollFor, requireEnv, sleep } from './lib/smoke.ts';
import { shopkeeperId } from './seed/generate-seed.ts';

const RAMESH_ID = shopkeeperId(0);
const FAKE_STRANGER = '910000000777';
const CREDIT_AMOUNT = 5000;
const POLL_TRIES = 15;
const POLL_DELAY_MS = 1000;
const SEND_TO_OWNER = process.argv.includes('--send-to-owner');
const RUN = `SMOKE-${Date.now()}`;

interface Smoke {
  readonly url: string;
  readonly appSecret: string;
  readonly verifyToken: string;
  readonly phoneNumberId: string;
  readonly admin: SupabaseClient;
  readonly startedAt: string;
}

const { report, failures } = createReporter();
let messageCounter = 0;

function senderHash(smoke: Smoke, number: string): string {
  return keyedHash(smoke.appSecret, number);
}

function sign(smoke: Smoke, body: string): string {
  return signWith(smoke.appSecret, body);
}

function nextMessageId(): string {
  messageCounter += 1;
  return `wamid.${RUN}-${messageCounter}`;
}

function payload(smoke: Smoke, from: string, message: MetaMessage): string {
  return metaPayload(smoke.phoneNumberId, from, message);
}

function textMessage(text: string, id = nextMessageId()): MetaMessage {
  return textWithId(id, text);
}

function tapMessage(buttonId: string, id = nextMessageId()): MetaMessage {
  return tapWithId(id, buttonId, 'Save');
}

function post(smoke: Smoke, body: string, signature: string | null): Promise<number> {
  return postWebhook(smoke.url, body, signature);
}

/** Background work finishes after the 200, so database checks wait for it. */
function poll<T>(read: () => Promise<T | null>): Promise<T | null> {
  return pollFor(read, { tries: POLL_TRIES, delayMs: POLL_DELAY_MS });
}

async function checkVerify(smoke: Smoke): Promise<void> {
  const base = `${smoke.url}?hub.mode=subscribe&hub.challenge=smoke123`;
  const right = await fetch(`${base}&hub.verify_token=${encodeURIComponent(smoke.verifyToken)}`);
  const text = await right.text();
  const wrong = await fetch(`${base}&hub.verify_token=wrong`);
  await wrong.text();
  report(
    right.status === 200 && text === 'smoke123' && wrong.status === 403,
    `verify: right token → ${right.status}, wrong token → ${wrong.status}`,
  );
}

async function checkSignature(smoke: Smoke): Promise<void> {
  const body = payload(smoke, FAKE_STRANGER, textMessage('hi'));
  const missing = await post(smoke, body, null);
  const wrong = await post(smoke, body, `sha256=${'0'.repeat(64)}`);
  const changed = await post(smoke, body.replace('hi', 'yo'), sign(smoke, body));
  report(
    missing === 401 && wrong === 401 && changed === 401,
    `signature: missing / wrong / body changed → ${missing}, ${wrong}, ${changed}`,
  );
}

async function strangerReplies(smoke: Smoke): Promise<number> {
  const { count, error } = await smoke.admin
    .from('wa_messages')
    .select('id', { count: 'exact', head: true })
    .eq('sender_hash', senderHash(smoke, FAKE_STRANGER))
    .eq('path', 'stranger')
    .eq('ist_day', istDate(new Date()));
  if (error) throw new Error(`wa_messages read failed (${error.code})`);
  return count ?? 0;
}

async function checkStranger(smoke: Smoke): Promise<void> {
  for (const text of ['pending', 'pending again']) {
    const body = payload(smoke, FAKE_STRANGER, textMessage(text));
    const status = await post(smoke, body, sign(smoke, body));
    report(status === 200, `stranger message → ${status}`);
  }
  const replies = await poll(async () =>
    (await strangerReplies(smoke)) > 0 ? strangerReplies(smoke) : null,
  );
  await sleep(2 * POLL_DELAY_MS);
  const settled = await strangerReplies(smoke);
  report(
    replies === 1 && settled === 1,
    `stranger: "not registered" rows today = ${settled} (expected 1)`,
  );
}

async function inboundRow(
  smoke: Smoke,
  id: string,
): Promise<{ path: string | null; command: string | null } | null> {
  const { data, error } = await smoke.admin
    .from('wa_messages')
    .select('path,command')
    .eq('wa_message_id', id);
  if (error) throw new Error(`wa_messages read failed (${error.code})`);
  const rows = z
    .array(z.object({ path: z.string().nullable(), command: z.string().nullable() }))
    .parse(data ?? []);
  const row = rows[0];
  return row && row.path !== null ? row : null;
}

interface OwnerStep {
  readonly owner: string;
  readonly text: string;
  /** The command the webhook should log for this message. */
  readonly expected: string;
}

async function ownerText(smoke: Smoke, { owner, text, expected }: OwnerStep): Promise<void> {
  const message = textMessage(text);
  const body = payload(smoke, owner, message);
  const status = await post(smoke, body, sign(smoke, body));
  const row = await poll(() => inboundRow(smoke, String(message['id'])));
  report(
    status === 200 && row?.command === expected,
    `owner "${text}" → ${status}, answered by ${row?.path ?? 'nothing'} as ${row?.command ?? '-'}`,
  );
}

async function rameshBalance(smoke: Smoke): Promise<number> {
  const { data, error } = await smoke.admin
    .from('balances')
    .select('outstanding')
    .eq('shopkeeper_id', RAMESH_ID);
  if (error) throw new Error(`balances read failed (${error.code})`);
  return Number(
    z.array(z.object({ outstanding: z.coerce.number() })).parse(data ?? [])[0]?.outstanding ?? 0,
  );
}

async function newCardId(smoke: Smoke): Promise<string | null> {
  const { data, error } = await smoke.admin
    .from('pending_actions')
    .select('id')
    .eq('kind', 'entry')
    .eq('status', 'open')
    .gte('created_at', smoke.startedAt)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`pending_actions read failed (${error.code})`);
  return z.array(z.object({ id: z.string() })).parse(data ?? [])[0]?.id ?? null;
}

async function smokeCredits(smoke: Smoke): Promise<number> {
  const { count, error } = await smoke.admin
    .from('ledger_entries')
    .select('id', { count: 'exact', head: true })
    .eq('shopkeeper_id', RAMESH_ID)
    .eq('source', 'text')
    .eq('amount', CREDIT_AMOUNT)
    .gte('created_at', smoke.startedAt);
  if (error) throw new Error(`ledger read failed (${error.code})`);
  return count ?? 0;
}

async function checkSaveFlow(smoke: Smoke, owner: string): Promise<void> {
  const before = await rameshBalance(smoke);
  await ownerText(smoke, {
    owner,
    text: `Ramesh ${CREDIT_AMOUNT} due 15th`,
    expected: 'add_credit',
  });
  const cardId = await poll(() => newCardId(smoke));
  report(
    cardId !== null && (await smokeCredits(smoke)) === 0,
    'card created, nothing saved before Save',
  );
  if (!cardId) return;
  const tap = tapMessage(`c:${cardId}:save`);
  const body = payload(smoke, owner, tap);
  await post(smoke, body, sign(smoke, body));
  const saved = await poll(async () =>
    (await smokeCredits(smoke)) > 0 ? smokeCredits(smoke) : null,
  );
  const after = await rameshBalance(smoke);
  report(
    saved === 1 && after === before + CREDIT_AMOUNT,
    `Save → ${saved ?? 0} entry; balance ${before} → ${after}`,
  );
  const duplicate = await post(smoke, body, sign(smoke, body));
  await sleep(3 * POLL_DELAY_MS);
  report(
    duplicate === 200 && (await smokeCredits(smoke)) === 1,
    'same message id again → handled once',
  );
}

async function cleanUp(smoke: Smoke, owner: string | null): Promise<void> {
  const hashes = [senderHash(smoke, FAKE_STRANGER), ...(owner ? [senderHash(smoke, owner)] : [])];
  const steps = [
    smoke.admin
      .from('ledger_entries')
      .delete()
      .eq('shopkeeper_id', RAMESH_ID)
      .eq('source', 'text')
      .eq('amount', CREDIT_AMOUNT)
      .gte('created_at', smoke.startedAt),
    smoke.admin.from('pending_actions').delete().gte('created_at', smoke.startedAt),
    smoke.admin
      .from('wa_messages')
      .delete()
      .in('sender_hash', hashes)
      .gte('created_at', smoke.startedAt),
  ];
  for (const step of steps) {
    const { error } = await step;
    if (error) throw new Error(`Cleanup failed (${error.code})`);
  }
  process.stdout.write('     test rows removed\n');
}

const smoke: Smoke = {
  url: `${requireEnv('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/whatsapp-webhook`,
  appSecret: requireEnv('META_APP_SECRET'),
  verifyToken: requireEnv('WHATSAPP_VERIFY_TOKEN'),
  phoneNumberId: requireEnv('META_PHONE_NUMBER_ID'),
  admin: createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY')),
  startedAt: new Date().toISOString(),
};
const owner = SEND_TO_OWNER ? digits(requireEnv('OWNER_WHATSAPP_NUMBER')) : null;

try {
  await checkVerify(smoke);
  await checkSignature(smoke);
  await checkStranger(smoke);
  if (owner) {
    process.stdout.write("     owner steps: replies go to the owner's real WhatsApp\n");
    await ownerText(smoke, { owner, text: 'pending', expected: 'pending' });
    await ownerText(smoke, { owner, text: 'Ramesh', expected: 'lookup' });
    await checkSaveFlow(smoke, owner);
  } else {
    process.stdout.write(
      '     owner steps skipped (add -- --send-to-owner; sends real WhatsApp replies)\n',
    );
  }
} finally {
  await cleanUp(smoke, owner);
}

process.stdout.write(
  failures() === 0 ? '\nWhatsApp smoke passed\n' : `\nWhatsApp smoke FAILED (${failures()})\n`,
);
process.exit(failures() === 0 ? 0 : 1);
