// supabase/functions/_shared/whatsapp/replies.test.ts
import { assertEquals } from '@std/assert';
import { replyText, textReply } from './replies.ts';

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
