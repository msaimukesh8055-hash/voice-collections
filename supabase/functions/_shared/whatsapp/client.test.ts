// supabase/functions/_shared/whatsapp/client.test.ts
// Fake fetch only: no request ever reaches graph.facebook.com.
import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { LogFields, Logger } from '../log.ts';
import { createWhatsAppClient, GRAPH_API_BASE, toMetaMessage } from './client.ts';
import type { Reply } from './replies.ts';

const TO = '910000099999';
const TOKEN = 'meta-token-secret';

interface Sent {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

function setup(response: () => Response): {
  client: ReturnType<typeof createWhatsAppClient>;
  sent: Sent[];
  logs: LogFields[];
} {
  const sent: Sent[] = [];
  const logs: LogFields[] = [];
  function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    sent.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return Promise.resolve(response());
  }
  const log: Logger = (_level, _event, fields = {}) => logs.push(fields);
  const client = createWhatsAppClient({
    accessToken: TOKEN,
    phoneNumberId: '100000000000001',
    fetchImpl: fakeFetch,
    log,
  });
  return { client, sent, logs };
}

function ok(): Response {
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.OUT1' }] }), { status: 200 });
}

Deno.test('client › sends a text to the messages endpoint with the bearer token', async () => {
  const { client, sent } = setup(ok);
  const id = await client.send(TO, { kind: 'text', text: 'Hello' });
  assertEquals(id, 'wamid.OUT1');
  assertEquals(sent[0]?.url, `${GRAPH_API_BASE}/100000000000001/messages`);
  assertEquals(sent[0]?.headers['authorization'], `Bearer ${TOKEN}`);
  assertEquals(sent[0]?.body['text'], { body: 'Hello' });
});

Deno.test('client › buttons keep at most 3, with titles cut to 20 characters', () => {
  const reply: Reply = {
    kind: 'buttons',
    text: 'Card',
    buttons: ['a', 'b', 'c', 'd'].map((id) => ({ id, title: 'A very long button title' })),
  };
  const message = toMetaMessage(TO, reply) as {
    interactive: { action: { buttons: Array<{ reply: { title: string } }> } };
  };
  assertEquals(message.interactive.action.buttons.length, 3);
  assertEquals(message.interactive.action.buttons[0]?.reply.title.length, 20);
});

Deno.test('client › a list keeps at most 10 rows with cut titles and descriptions', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `r${index}`,
    title: 'Shopkeeper with a long name',
    description: 'x'.repeat(100),
  }));
  const reply: Reply = { kind: 'list', text: 'Pick', buttonLabel: 'Choose', rows };
  const message = toMetaMessage(TO, reply) as {
    interactive: {
      type: string;
      action: { sections: Array<{ rows: Array<Record<string, string>> }> };
    };
  };
  const sentRows = message.interactive.action.sections[0]?.rows ?? [];
  assertEquals([message.interactive.type, sentRows.length], ['list', 10]);
  assertEquals([sentRows[0]?.['title']?.length, sentRows[0]?.['description']?.length], [24, 72]);
});

Deno.test('client › a Meta error is logged with codes only, never the token or number', async () => {
  const error = { error: { message: `Recipient ${TO} not allowed`, code: 131030 } };
  const { client, logs } = setup(() => new Response(JSON.stringify(error), { status: 400 }));
  assertEquals(await client.send(TO, { kind: 'text', text: 'x' }), null);
  const logged = JSON.stringify(logs);
  assertStringIncludes(logged, '131030');
  assert(!logged.includes(TO) && !logged.includes(TOKEN));
});

Deno.test('client › a non-JSON error or a network failure returns null', async () => {
  const html = setup(() => new Response('<html>', { status: 502 }));
  assertEquals(await html.client.send(TO, { kind: 'text', text: 'x' }), null);
  assertStringIncludes(JSON.stringify(html.logs), 'HTTP 502');
  const down = setup(() => {
    throw new TypeError('network down');
  });
  assertEquals(await down.client.send(TO, { kind: 'text', text: 'x' }), null);
  assertStringIncludes(JSON.stringify(down.logs), 'TypeError');
});

Deno.test('client › list rows without a description, errors without codes, thrown strings', async () => {
  const reply: Reply = {
    kind: 'list',
    text: 'Pick',
    buttonLabel: 'Choose',
    rows: [{ id: 'r', title: 'Ramesh' }],
  };
  const message = toMetaMessage(TO, reply) as {
    interactive: { action: { sections: Array<{ rows: Array<Record<string, string>> }> } };
  };
  assertEquals(message.interactive.action.sections[0]?.rows[0], { id: 'r', title: 'Ramesh' });
  const noCode = setup(() => new Response(JSON.stringify({ error: {} }), { status: 401 }));
  await noCode.client.send(TO, reply);
  assertStringIncludes(JSON.stringify(noCode.logs), 'code - subcode -');
  const thrown = setup(() => {
    throw 'offline';
  });
  assertEquals(await thrown.client.send(TO, reply), null);
  assertStringIncludes(JSON.stringify(thrown.logs), 'unknown');
});
