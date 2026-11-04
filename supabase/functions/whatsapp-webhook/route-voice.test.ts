// supabase/functions/whatsapp-webhook/route-voice.test.ts
// The "Heard" line on a voice note's replies (M6), for every kind of first reply.
import { assertEquals } from '@std/assert';
import type { Reply } from '../_shared/whatsapp/replies.ts';
import { withHeard } from './route.ts';

const LINE = '🎤 Heard: “pending”';
const HEARD = { line: LINE, english: LINE };

Deno.test('route voice › the Heard line goes on top of the first reply, with a blank line', () => {
  const card: Reply = {
    kind: 'buttons',
    text: '*Add credit*',
    buttons: [{ id: 'a', title: 'Save' }],
  };
  assertEquals(withHeard([card, { kind: 'text', text: 'next' }], HEARD), [
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
  assertEquals(withHeard([], HEARD), [{ kind: 'text', text: LINE }]);
  assertEquals(withHeard([audio], HEARD), [{ kind: 'text', text: LINE }, audio]);
  assertEquals(withHeard([template], HEARD), [{ kind: 'text', text: LINE }, template]);
});

Deno.test("route voice › a Telugu reply's English rendering gets the English Heard line too", () => {
  const heard = { line: '🎤 విన్నది: “pending”', english: LINE };
  const card: Reply = { kind: 'text', text: 'తెలుగు', english: 'English' };
  assertEquals(withHeard([card], heard), [{
    kind: 'text',
    text: '🎤 విన్నది: “pending”\n\nతెలుగు',
    english: `${LINE}\n\nEnglish`,
  }]);
  assertEquals(withHeard([], heard), [{ kind: 'text', text: heard.line, english: LINE }]);
});
