// supabase/functions/whatsapp-webhook/handler.test.ts
import { assertEquals } from '@std/assert';
import type { LogFields, Logger } from '../_shared/log.ts';
import { metaPayload } from '../_shared/whatsapp/__fixtures__/meta-payloads.ts';
import type { WebhookPayload } from '../_shared/whatsapp/inbound.ts';
import { signBody } from '../_shared/whatsapp/signature.ts';
import { handleWebhook, type WebhookDeps } from './handler.ts';

const URL_BASE = 'https://ref.supabase.co/functions/v1/whatsapp-webhook';
const SECRET = 'app-secret';
const VERIFY = 'verify-token-for-tests';

function setup(process: (payload: WebhookPayload) => Promise<void> = () => Promise.resolve()): {
  deps: WebhookDeps;
  processed: WebhookPayload[];
  deferred: Promise<void>[];
  logs: Array<{ event: string; fields: LogFields }>;
} {
  const processed: WebhookPayload[] = [];
  const deferred: Promise<void>[] = [];
  const logs: Array<{ event: string; fields: LogFields }> = [];
  const log: Logger = (_level, event, fields = {}) => logs.push({ event, fields });
  const deps: WebhookDeps = {
    verifyToken: VERIFY,
    appSecret: SECRET,
    defer: (task) => deferred.push(task),
    process: (payload) => {
      processed.push(payload);
      return process(payload);
    },
    log,
  };
  return { deps, processed, deferred, logs };
}

function post(body: string, signature: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['x-hub-signature-256'] = signature;
  return new Request(URL_BASE, { method: 'POST', headers, body });
}

async function signed(body: string): Promise<Request> {
  return post(body, await signBody(new TextEncoder().encode(body), SECRET));
}

Deno.test('webhook › verify: right token returns the challenge', async () => {
  const { deps } = setup();
  const url = `${URL_BASE}?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`;
  const response = await handleWebhook(new Request(url), deps);
  assertEquals([response.status, await response.text()], [200, '12345']);
});

Deno.test('webhook › verify: wrong token or mode → 403', async () => {
  const { deps } = setup();
  for (
    const query of [
      `hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`,
      `hub.mode=x&hub.verify_token=${VERIFY}&hub.challenge=1`,
      '',
    ]
  ) {
    const response = await handleWebhook(new Request(`${URL_BASE}?${query}`), deps);
    assertEquals(response.status, 403, query);
  }
});

Deno.test('webhook › a valid signature → 200 at once, work handed to the background', async () => {
  const { deps, processed, deferred } = setup();
  const response = await handleWebhook(
    await signed(JSON.stringify(metaPayload({ text: 'pending' }))),
    deps,
  );
  assertEquals([response.status, await response.text()], [200, 'EVENT_RECEIVED']);
  assertEquals([processed.length, deferred.length], [1, 1]);
});

Deno.test('webhook › 200 does not wait for slow background work', async () => {
  let finish: () => void = () => {};
  const slow = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const { deps, deferred } = setup(() => slow);
  const response = await handleWebhook(await signed(JSON.stringify(metaPayload())), deps);
  assertEquals(response.status, 200);
  finish();
  await Promise.all(deferred);
});

Deno.test('webhook › missing, wrong, or changed-after-signing signature → 401, nothing processed', async () => {
  const { deps, processed } = setup();
  const body = JSON.stringify(metaPayload({ text: 'pending' }));
  const goodSignature = await signBody(new TextEncoder().encode(body), SECRET);
  const changed = body.replace('pending', 'closed');
  const requests = [
    await post(body, null),
    await post(body, await signBody(new TextEncoder().encode(body), 'other-secret')),
    await post(changed, goodSignature),
  ];
  for (const request of requests) assertEquals((await handleWebhook(request, deps)).status, 401);
  assertEquals(processed.length, 0);
});

Deno.test('webhook › signed but not a Meta payload → 400', async () => {
  const { deps, processed } = setup();
  assertEquals((await handleWebhook(await signed('not json'), deps)).status, 400);
  assertEquals((await handleWebhook(await signed('{"object":"x"}'), deps)).status, 400);
  assertEquals(processed.length, 0);
});

Deno.test('webhook › a background failure is logged, never thrown', async () => {
  const { deps, deferred, logs } = setup(() => Promise.reject(new Error('boom')));
  await handleWebhook(await signed(JSON.stringify(metaPayload())), deps);
  await Promise.all(deferred);
  assertEquals(logs.at(-1)?.event, 'whatsapp_background_failed');
});

Deno.test('webhook › other methods → 405', async () => {
  const { deps } = setup();
  assertEquals((await handleWebhook(new Request(URL_BASE, { method: 'PUT' }), deps)).status, 405);
});

Deno.test('webhook › verify: a missing token → 403', async () => {
  const { deps } = setup();
  const response = await handleWebhook(
    new Request(`${URL_BASE}?hub.mode=subscribe&hub.challenge=1`),
    deps,
  );
  assertEquals(response.status, 403);
});

Deno.test('webhook › a non-Error background failure is logged too', async () => {
  const { deps, deferred, logs } = setup(() => Promise.reject('boom'));
  await handleWebhook(await signed(JSON.stringify(metaPayload())), deps);
  await Promise.all(deferred);
  assertEquals(logs.at(-1)?.fields['error'], 'unknown');
});
