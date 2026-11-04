// supabase/functions/whatsapp-webhook/route-voice.test.ts
// The "Heard" line on a voice note's replies (M6), for every kind of first reply.
import { assertEquals } from '@std/assert';
import type { Reply } from '../_shared/whatsapp/replies.ts';
import { withHeard } from './route.ts';

const LINE = '🎤 Heard: “pending”';

Deno.test('route voice › the Heard line goes on top of the first reply, with a blank line', () => {
  const card: Reply = {
    kind: 'buttons',
    text: '*Add credit*',
    buttons: [{ id: 'a', title: 'Save' }],
  };
  assertEquals(withHeard([card, { kind: 'text', text: 'next' }], LINE), [
    { ...card, text: `${LINE}\n\n*Add credit*` },
    { kind: 'text', text: 'next' },
  ]);
});

Deno.test('route voice › no reply, or a first reply without a body → its own message', () => {
  const audio: Reply = { kind: 'audio', mediaId: 'm' };
  const template: Reply = {
    kind: 'template',
    name: 't',
    languageCode: 'en',
    bodyParams: [],
    text: 'x',
  };
  assertEquals(withHeard([], LINE), [{ kind: 'text', text: LINE }]);
  assertEquals(withHeard([audio], LINE), [{ kind: 'text', text: LINE }, audio]);
  assertEquals(withHeard([template], LINE), [{ kind: 'text', text: LINE }, template]);
});
