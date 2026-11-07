// supabase/functions/_shared/whatsapp/spoken.test.ts
// The spoken version of a reply for the Bulbul voice note (M6 Decision 3).
import { assertEquals } from '@std/assert';
import { MAX_SPOKEN_CHARS, sourceText, spokenSource, spokenText } from './spoken.ts';
import type { Reply } from './replies.ts';

Deno.test('spoken › a card: no "Heard" line, no formatting, rupees read out', () => {
  const card: Reply = {
    kind: 'buttons',
    text: '🎤 Heard: “Ramesh 5000 due 15th”\n\n*Add credit*\n\nRamesh (Ramesh Kirana)\n' +
      '₹5,000 · due Sun 15 Nov\n\nBalance after: ₹13,500',
    buttons: [{ id: 'a', title: 'Save' }],
  };
  assertEquals(
    spokenText([card], 'en'),
    'Add credit. Ramesh (Ramesh Kirana). 5,000 rupees, due Sun 15 Nov. Balance after: 13,500 rupees.',
  );
});

Deno.test('spoken › a list keeps its title and the first 3 rows', () => {
  const pending: Reply = {
    kind: 'text',
    text: '*Pending:* 5 people owe you ₹20,000\n\n' +
      '1. Ramesh · ₹8,500 · 12 days overdue · Risky 42\n2. Latha · ₹5,000\n3. Imran · ₹3,000\n' +
      '4. Suresh · ₹2,000\n5. Praveen · ₹1,500',
  };
  assertEquals(
    spokenText([pending], 'en'),
    'Pending: 5 people owe you 20,000 rupees. 1. Ramesh, 8,500 rupees, 12 days overdue, Risky 42. ' +
      '2. Latha, 5,000 rupees. 3. Imran, 3,000 rupees.',
  );
});

Deno.test('spoken › rupees in Telugu and Hindi; Telugu "Heard" line dropped', () => {
  const te: Reply = { kind: 'text', text: '🎤 విన్నది: “x”\n\nబాకీ: ₹8,500' };
  assertEquals(spokenText([te], 'te'), 'బాకీ: 8,500 రూపాయలు.');
  assertEquals(spokenText([{ kind: 'text', text: 'बाकी ₹500।' }], 'hi'), 'बाकी 500 रुपये।');
});

Deno.test('spoken › bullets and emoji go; the first text reply is the one spoken', () => {
  const replies: Reply[] = [
    { kind: 'audio', mediaId: 'm' },
    { kind: 'text', text: '📞 *Asha called Ramesh*\n• Promise: ₹2,000' },
    { kind: 'text', text: 'second' },
  ];
  assertEquals(spokenText(replies, 'en'), 'Asha called Ramesh. Promise: 2,000 rupees.');
});

Deno.test('spoken › nothing to speak → empty; very long → cut', () => {
  const template: Reply = {
    kind: 'template',
    name: 't',
    languageCode: 'en',
    bodyParams: [],
    text: 'x',
  };
  assertEquals(spokenText([template], 'en'), '');
  assertEquals(spokenText([], 'en'), '');
  const long = spokenText([{ kind: 'text', text: 'word '.repeat(300) }], 'en');
  assertEquals(long.length, MAX_SPOKEN_CHARS);
  assertEquals(long.endsWith('…'), true);
});

Deno.test('spoken › reply links are never read aloud (View in books, Answer here)', () => {
  const saved: Reply = {
    kind: 'text',
    text:
      'Saved. Ramesh now owes ₹13,500.\n\n📒 View in books: https://x.example/shopkeepers?id=1#t=T',
  };
  assertEquals(spokenText([saved], 'en'), 'Saved. Ramesh now owes 13,500 rupees.');
  const calling: Reply = {
    kind: 'text',
    text: '📞 ఇప్పుడు Rameshకి కాల్ చేస్తున్నాం.\n\n📞 ఇక్కడ ఎత్తండి: https://x.example/phone',
  };
  assertEquals(spokenText([calling], 'te'), 'ఇప్పుడు Rameshకి కాల్ చేస్తున్నాం.');
});

Deno.test('spoken source › every bodied reply, no Heard block, no link lines', () => {
  const replies: Reply[] = [
    {
      kind: 'text',
      text: '🎤 Heard: “Ramesh”\n\n👤 *Ramesh* · Ramesh Kirana\nBalance: ₹8,500\n\n' +
        '📒 View in books: https://x.example/s#t=T',
    },
    { kind: 'audio', mediaId: 'm' },
    { kind: 'template', name: 't', languageCode: 'en', bodyParams: [], text: 'template words' },
    {
      kind: 'buttons',
      text: 'What next for Ramesh?',
      buttons: [{ id: 'a', title: '📞 Remind' }, { id: 'b', title: '✅ Paid in full' }],
    },
  ];
  assertEquals(spokenSource(replies, 'en'), {
    reply: '👤 *Ramesh* · Ramesh Kirana\nBalance: ₹8,500\n\nWhat next for Ramesh?',
    buttons: ['Remind', 'Paid in full'],
  });
});

Deno.test('spoken source › a list gives its rows as lines and its button label', () => {
  const list: Reply = {
    kind: 'list',
    text: 'Tap a name to open their account.',
    buttonLabel: 'Open…',
    rows: [{ id: 'a', title: 'Ramesh', description: '₹8,500 · 12 days overdue' }, {
      id: 'b',
      title: 'Latha',
    }],
  };
  const source = spokenSource([list], 'en');
  assertEquals(
    source.reply,
    'Tap a name to open their account.\nRamesh · ₹8,500 · 12 days overdue\nLatha',
  );
  assertEquals(source.buttons, ['Open…']);
  assertEquals(sourceText(source), `${source.reply}\nOpen…`);
});

Deno.test('spoken source › nothing bodied → empty; a Heard-only reply gives no part', () => {
  assertEquals(spokenSource([{ kind: 'audio', mediaId: 'm' }], 'en'), { reply: '', buttons: [] });
  const heardOnly: Reply = { kind: 'text', text: '🎤 Heard: “x”' };
  assertEquals(spokenSource([heardOnly, { kind: 'text', text: 'ok' }], 'en').reply, 'ok');
  const emojiOnly: Reply = { kind: 'buttons', text: 'x', buttons: [{ id: 'a', title: '📋' }] };
  assertEquals(spokenSource([emojiOnly], 'en').buttons, []);
});
