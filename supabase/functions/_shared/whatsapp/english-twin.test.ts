// supabase/functions/_shared/whatsapp/english-twin.test.ts
// "English under Telugu" (M6 Decision 5): which messages get it, the layout, the long-message
// split, and that Translate failing never blocks the Telugu message. Fakes only.
import { assertEquals } from '@std/assert';
import { entryCard } from '../cards/render.ts';
import type { TranslateRequest } from '../speech/translate.ts';
import { createFakeBookRepository, FAKE_OWNER, RAMESH } from '../db/fake-book-repository.ts';
import {
  ownerTwinSettings,
  SETTINGS_TTL_MS,
  type TwinSettings,
  withEnglishTwin,
} from './english-twin.ts';
import { hintReply, menuReply } from './menu.ts';
import type { Reply } from './replies.ts';
import { lookupActionsReply, shopkeeperReplies } from '../ledger/views.ts';
import { FAKE_TODAY, fakeBookEntries } from '../db/fake-book-repository.ts';

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
  // A block with no Telugu ("1. Ramesh · ₹8,500") is used as it is, without Translate.
  assertEquals(h.sent, [{
    kind: 'text',
    text: `${TELUGU}\n\nEN(*పెండింగ్:* 2 మంది బాకీ ₹10,500)\n\n1. Ramesh · ₹8,500`,
  }]);
  assertEquals(h.asked.map((r) => [r.from, r.to, r.keep]), [['te', 'en', ['Ramesh']]]);
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
  const text = `${TELUGU} · 12 రోజులు ఆలస్యం`;
  const h = harness({ translate: (r) => (r.text.startsWith('1.') ? null : 'ok') });
  await h.send({ kind: 'text', text });
  assertEquals(h.sent, [{ kind: 'text', text }]);
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

Deno.test('english twin › "🎤 Heard" line gets its fixed English, with no Translate call', async () => {
  const h = harness();
  const heard = '🎤 విన్నది: “Ramesh ki 5000 …”';
  await h.send({ kind: 'text', text: heard });
  assertEquals(h.sent, [{ kind: 'text', text: `${heard}\n\n🎤 Heard: “Ramesh ki 5000 …”` }]);
  assertEquals(h.asked.length, 0);
});

Deno.test('english twin › the real payment card: fixed English, name block kept, zero Translate calls', async () => {
  const h = harness();
  const card = entryCard({
    actionId: 'a0000000-0000-4000-8000-000000000001',
    shopkeeper: RAMESH,
    payload: {
      shopkeeperId: RAMESH.id,
      draft: { type: 'payment', amount: 5000, dueDate: null, note: null, dueDefaulted: false },
      language: 'te',
    },
    outstanding: 8500,
  });
  assertEquals(
    card.kind === 'buttons' ? card.text : '',
    [
      '💰 *చెల్లింపు అందింది*',
      'Ramesh (Ramesh Kirana)\n₹5,000',
      'తర్వాత బాకీ: ₹3,500',
    ].join('\n\n'),
  );
  await h.send(card);
  const english = [
    '💰 *Payment received*',
    'Ramesh (Ramesh Kirana)\n₹5,000',
    'Balance after: ₹3,500',
  ]
    .join('\n\n');
  assertEquals(h.sent.length, 1);
  assertEquals(
    h.sent[0]?.kind === 'buttons' ? h.sent[0].text : '',
    `${card.kind === 'buttons' ? card.text : ''}\n\n${english}`,
  );
  assertEquals(h.asked.length, 0);
});

Deno.test('english twin › a label line plus free Telugu still goes to Translate, label kept', async () => {
  const h = harness();
  await h.send({ kind: 'text', text: '🎤 విన్నది: “రమేష్ కి 5000”\nతర్వాత బాకీ: ₹3,500' });
  assertEquals(h.asked.length, 1);
  assertEquals(h.asked[0]?.text, '🎤 Heard: “రమేష్ కి 5000”\nBalance after: ₹3,500');
  assertEquals(h.asked[0]?.keep, ['Ramesh', '🎤 Heard', 'Balance after']);
});

Deno.test('english twin › a template rendering is used as it is: no Translate, layout kept', async () => {
  const h = harness();
  const english = '*Pending:* 2 people owe you ₹10,500\n\n1. Ramesh · ₹8,500\n2. Latha · ₹2,000';
  await h.send({ kind: 'text', text: TELUGU, english });
  assertEquals(h.sent, [{ kind: 'text', text: `${TELUGU}\n\n${english}`, english }]);
  assertEquals(h.asked.length, 0);
});

Deno.test('english twin › in a rendering, only a line still in Telugu (a note) is translated', async () => {
  const h = harness();
  const english = '*Add credit*\nRamesh\nNote: బియ్యం బస్తాలు\nBalance after: ₹5,000';
  const card: Reply = {
    kind: 'buttons',
    text: 'అప్పు',
    english,
    buttons: [{ id: 'a', title: 'Save' }],
  };
  await h.send(card);
  assertEquals(h.asked.map((r) => r.text), ['Note: బియ్యం బస్తాలు']);
  const sent = h.sent[0];
  assertEquals(
    sent?.kind === 'buttons' ? sent.text : '',
    'అప్పు\n\n*Add credit*\nRamesh\nEN(Note: బియ్యం బస్తాలు)\nBalance after: ₹5,000',
  );
});

Deno.test('english twin › a free-text line Translate fails on stays as written', async () => {
  const h = harness({ translate: () => null });
  await h.send({ kind: 'text', text: 'తెలుగు', english: 'Heard: “తెలుగు”\n\nPending' });
  assertEquals(h.sent, [{
    kind: 'text',
    text: 'తెలుగు\n\nHeard: “తెలుగు”\n\nPending',
    english: 'Heard: “తెలుగు”\n\nPending',
  }]);
});

Deno.test('english twin › M7: Telugu Menu, lookup, next step and hint get their English, no Translate', async () => {
  const h = harness();
  const menu = menuReply('te', 'Srinivas Reddy');
  const lookup = shopkeeperReplies({
    lastNote: null,
    shopkeeper: RAMESH,
    entries: fakeBookEntries().filter((entry) => entry.shopkeeperId === RAMESH.id),
    lastPromise: null,
    score: null,
    today: FAKE_TODAY,
    language: 'te',
  })[0];
  const next = lookupActionsReply({ shopkeeper: RAMESH, outstanding: 100, language: 'te' });
  for (const reply of [menu, lookup!, next, hintReply('add', 'te')]) await h.send(reply);
  assertEquals(h.asked.length, 0);
  const [menuSent, lookupSent, nextSent, hintSent] = h.sent;
  assertEquals(menuSent?.kind === 'list' ? menuSent.rows[0]?.title : '', '📒 బాకీ');
  assertEquals(
    menuSent?.kind === 'list' ? menuSent.text.split('\n\n')[3] : '',
    '👋 *Namaste Srinivas!* I keep your credit book.',
  );
  const lookupLines = lookupSent?.kind === 'text' ? lookupSent.text.split('\n') : [];
  assertEquals(lookupLines.includes('Overdue: ₹5,000 · 12 days'), true);
  assertEquals(lookupLines.includes('Next due: ₹3,500 · Thu 5 Nov'), true);
  assertEquals(
    nextSent?.kind === 'buttons' ? nextSent.text : '',
    'Ramesh కి తర్వాత ఏం చేయాలి?\n\nWhat next for Ramesh?',
  );
  assertEquals(nextSent?.kind === 'buttons' ? nextSent.buttons[0]?.title : '', '📞 గుర్తుచేయి');
  assertEquals(
    (hintSent?.kind === 'text' ? hintSent.text : '').endsWith(
      'Nothing is saved until you tap Save.',
    ),
    true,
  );
});
