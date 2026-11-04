// supabase/functions/_shared/whatsapp/replies.test.ts
import { assertEquals } from '@std/assert';
import { blocks, type Reply, replyText, textIn, textReply, withEnglish } from './replies.ts';

Deno.test('replies › replyText joins texts, button titles and list rows', () => {
  const text = replyText([
    textReply('Hello'),
    { kind: 'buttons', text: 'Card', buttons: [{ id: 'a', title: 'Save' }] },
    {
      kind: 'list',
      text: 'Pick',
      buttonLabel: 'x',
      rows: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', description: 'shop' }],
    },
  ]);
  assertEquals(text, 'Hello\n---\nCard\nSave\n---\nPick\nA \nB shop');
});

Deno.test('replies › replyText shows a template by its text (M5)', () => {
  const text = replyText([
    { kind: 'template', name: 'daily_due_alert', languageCode: 'en', bodyParams: ['3'], text: 'T' },
  ]);
  assertEquals(text, 'T');
});

Deno.test('replies › blocks puts one blank line between blocks (M6 spacing)', () => {
  assertEquals(
    blocks('*Title*', ['row 1', 'row 2'], 'Footer'),
    '*Title*\n\nrow 1\nrow 2\n\nFooter',
  );
});

Deno.test('replies › blocks leaves out empty blocks, so never two blank lines in a row', () => {
  assertEquals(blocks('A', null, [], '', ['  '], 'B'), 'A\n\nB');
});

Deno.test('replies › replyText shows a voice reply as a marker and an image by its caption', () => {
  const text = replyText([
    { kind: 'audio', mediaId: 'a' },
    { kind: 'image', mediaId: 'i', text: 'Pie' },
  ]);
  assertEquals(text, '[voice note]\n---\nPie');
});

Deno.test('replies › withEnglish renders the same template in English for other languages', () => {
  const render = (language: string): Reply => textReply(`hello in ${language}`);
  assertEquals(withEnglish('te', render), {
    kind: 'text',
    text: 'hello in te',
    english: 'hello in en',
  });
  assertEquals(withEnglish('en', render), { kind: 'text', text: 'hello in en' });
  assertEquals(textIn('hi', (language) => `hi ${language}`), {
    kind: 'text',
    text: 'hi hi',
    english: 'hi en',
  });
  const audio: Reply = { kind: 'audio', mediaId: 'm' };
  assertEquals(withEnglish('te', () => audio), audio);
});
