// scripts/lib/meta-webhook.test.ts
// The smoke scripts' fake Meta deliveries must be read by the real webhook code exactly like
// Meta's own: same schema, same message, same signature format. FAKE numbers and secrets only.
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { remindButtonId } from '../../supabase/functions/_shared/cards/ids.ts';
import {
  extractMessages,
  WebhookPayloadSchema,
} from '../../supabase/functions/_shared/whatsapp/inbound.ts';
import {
  digits,
  metaPayload,
  postWebhook,
  senderHash,
  sign,
  tapMessage,
  textMessage,
} from './meta-webhook.ts';

const PHONE_ID = '100000000000001';
const FAKE_FROM = '910000000777';
const FAKE_SECRET = 'fake-app-secret';
const SHOPKEEPER = '00000000-0000-4000-8000-000000000001';

function read(body: string): ReturnType<typeof extractMessages> {
  return extractMessages(WebhookPayloadSchema.parse(JSON.parse(body)), PHONE_ID);
}

describe('meta webhook payloads', () => {
  it('a text message reads back as the same text', () => {
    const [message] = read(metaPayload(PHONE_ID, FAKE_FROM, textMessage('wamid.T1', 'due')));
    expect(message).toEqual({ id: 'wamid.T1', from: FAKE_FROM, kind: 'text', text: 'due' });
  });

  it('a tap reads back as the button id (a Remind tap here)', () => {
    const tap = tapMessage('wamid.T2', remindButtonId(SHOPKEEPER, 'en'));
    const [message] = read(metaPayload(PHONE_ID, FAKE_FROM, tap));
    expect(message).toMatchObject({ kind: 'tap', buttonId: `rm:${SHOPKEEPER}:en` });
  });

  it('a payload for another phone number id is ignored', () => {
    const body = metaPayload('100000000000002', FAKE_FROM, textMessage('wamid.T3', 'hi'));
    expect(read(body)).toEqual([]);
  });
});

describe('signature and sender hash', () => {
  it('signs the raw body as sha256=<hex HMAC>', () => {
    const expected = createHmac('sha256', FAKE_SECRET).update('{"a":1}').digest('hex');
    expect(sign(FAKE_SECRET, '{"a":1}')).toBe(`sha256=${expected}`);
  });

  it('hashes only the digits, so +91 spacing does not matter', () => {
    expect(digits('+91 00000 00777')).toBe(FAKE_FROM);
    expect(senderHash(FAKE_SECRET, '+91 00000 00777')).toBe(senderHash(FAKE_SECRET, FAKE_FROM));
    expect(senderHash(FAKE_SECRET, FAKE_FROM)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('postWebhook', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the signature header only when given, and returns the status', async () => {
    const seen: Array<Record<string, string>> = [];
    function fakeFetch(_url: string, init: RequestInit): Promise<Response> {
      seen.push({ ...(init.headers as Record<string, string>) });
      return Promise.resolve(new Response('ok', { status: 401 }));
    }
    vi.stubGlobal('fetch', fakeFetch);
    expect(await postWebhook('https://example.test/hook', '{}', 'sha256=abc')).toBe(401);
    expect(await postWebhook('https://example.test/hook', '{}', null)).toBe(401);
    expect(seen[0]?.['x-hub-signature-256']).toBe('sha256=abc');
    expect(seen[1]?.['x-hub-signature-256']).toBeUndefined();
  });
});
