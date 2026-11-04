// supabase/functions/_shared/whatsapp/english-twin.test.ts
// "English under Telugu" (M6 Decision 5): which messages get it, the layout, the long-message
// split, and that Translate failing never blocks the Telugu message. Fakes only.
import { assertEquals } from '@std/assert';
import type { TranslateRequest } from '../speech/translate.ts';
import { createFakeBookRepository, FAKE_OWNER } from '../db/fake-book-repository.ts';
import {
  ownerTwinSettings,
  SETTINGS_TTL_MS,
  type TwinSettings,
  withEnglishTwin,
} from './english-twin.ts';
import type { Reply } from './replies.ts';

const TELUGU = '*పెండింగ్:* 2 మంది బాకీ ₹10,500\n\n1. Ramesh · ₹8,500';

interface Harness {
  send: (reply: Reply) => Promise<string | null>;
  sent: Reply[];
  asked: TranslateRequest[];
  loads: number[];
  tick: (ms: number) => void;
}

function harness(
  options: {
    on?: boolean;
    translate?: (request: TranslateRequest) => string | null;
    loadFails?: boolean;
  } = {},
): Harness {
  const sent: Reply[] = [];
  const asked: TranslateRequest[] = [];
  const loads: number[] = [];
  let now = 0;
  const client = withEnglishTwin(
    {
      send: (_to, reply) => {
        sent.push(reply);
        return Promise.resolve(`wamid.${sent.length}`);
      },
    },
    {
      translate: (request) => {
        asked.push(request);
        const answer = options.translate ?? ((r: TranslateRequest) => `EN(${r.text})`);
        return Promise.resolve(answer(request));
      },
      loadSettings: (): Promise<TwinSettings> => {
        loads.push(now);
        if (options.loadFails) return Promise.reject(new Error('db down'));
        return Promise.resolve({ on: options.on ?? true, names: ['Ramesh'] });
      },
      clock: () => new Date(now),
    },
  );
  return {
    send: (reply) => client.send('910000099999', reply),
    sent,
    asked,
    loads,
    tick: (ms) => {
      now += ms;
    },
  };
}

Deno.test('english twin › a Telugu message gets a blank line and its English, block by block', async () => {
  const h = harness();
  const id = await h.send({ kind: 'text', text: TELUGU });
  assertEquals(id, 'wamid.1');
  assertEquals(h.sent, [{
    kind: 'text',
    text: `${TELUGU}\n\nEN(*పెండింగ్:* 2 మంది బాకీ ₹10,500)\n\nEN(1. Ramesh · ₹8,500)`,
  }]);
  assertEquals(h.asked.map((r) => [r.from, r.to, r.keep]), [
    ['te', 'en', ['Ramesh']],
    ['te', 'en', ['Ramesh']],
  ]);
});

Deno.test('english twin › buttons stay Telugu; only the body gets the English', async () => {
  const h = harness();
  const card: Reply = { kind: 'buttons', text: 'జోడించాలా?', buttons: [{ id: 'a', title: 'అవును' }] };
  await h.send(card);
  assertEquals(h.sent, [{ ...card, text: 'జోడించాలా?\n\nEN(జోడించాలా?)' }]);
});

Deno.test('english twin › English, Hindi and template messages are sent untouched', async () => {
  const h = harness();
  const replies: Reply[] = [
    { kind: 'text', text: 'Pending: 2 people' },
    { kind: 'text', text: 'बाकी: 2 लोग' },
    { kind: 'template', name: 't', languageCode: 'en', bodyParams: [], text: 'తెలుగు' },
  ];
  for (const reply of replies) await h.send(reply);
  assertEquals(h.sent, replies);
  assertEquals(h.asked.length, 0);
  assertEquals(h.loads.length, 0);
});

Deno.test('english twin › setting off → Telugu only, no Translate call', async () => {
  const h = harness({ on: false });
  await h.send({ kind: 'text', text: TELUGU });
  assertEquals(h.sent, [{ kind: 'text', text: TELUGU }]);
  assertEquals(h.asked.length, 0);
});

Deno.test('english twin › any block failing to translate → Telugu alone (no half English)', async () => {
  const h = harness({ translate: (r) => (r.text.startsWith('1.') ? null : 'ok') });
  await h.send({ kind: 'text', text: TELUGU });
  assertEquals(h.sent, [{ kind: 'text', text: TELUGU }]);
});

Deno.test('english twin › settings failing to load → Telugu alone', async () => {
  const h = harness({ loadFails: true });
  await h.send({ kind: 'text', text: TELUGU });
  assertEquals(h.sent, [{ kind: 'text', text: TELUGU }]);
});

Deno.test('english twin › too long for one message with buttons → English as a second message', async () => {
  const h = harness({ translate: () => 'E'.repeat(900) });
  const card: Reply = {
    kind: 'buttons',
    text: 'తెలుగు'.repeat(30),
    buttons: [{ id: 'a', title: 'x' }],
  };
  const id = await h.send(card);
  assertEquals(id, 'wamid.1');
  assertEquals(h.sent, [card, { kind: 'text', text: 'E'.repeat(900) }]);
});

Deno.test('english twin › settings are read once per 5 minutes, then again', async () => {
  const h = harness();
  await h.send({ kind: 'text', text: 'తెలుగు' });
  h.tick(SETTINGS_TTL_MS - 1);
  await h.send({ kind: 'text', text: 'తెలుగు' });
  h.tick(1);
  await h.send({ kind: 'text', text: 'తెలుగు' });
  assertEquals(h.loads, [0, SETTINGS_TTL_MS]);
});

Deno.test('english twin › the setting comes from the owner; names include shops and the owner', async () => {
  const on = createFakeBookRepository({ owner: { ...FAKE_OWNER, englishUnderTelugu: true } });
  const settings = await ownerTwinSettings(on.book)();
  assertEquals(settings.on, true);
  assertEquals(settings.names.slice(0, 4), [
    'Srinivas Reddy',
    'Sri Lakshmi Traders',
    'Ramesh',
    'Ramesh Kirana',
  ]);
  const off = createFakeBookRepository();
  assertEquals(await ownerTwinSettings(off.book)(), { on: false, names: [] });
  const none = createFakeBookRepository({ owner: null });
  assertEquals(await ownerTwinSettings(none.book)(), { on: false, names: [] });
});
