// supabase/functions/_shared/whatsapp/exchange.test.ts
// The WhatsApp exchange row's pure parts (ADR-0022). FAKE DATA ONLY.
import { assertEquals } from '@std/assert';
import { cardButtonId, pickRowId } from '../cards/ids.ts';
import {
  cardShown,
  isTestMessage,
  keptText,
  MAX_EXCHANGE_TEXT,
  replyWords,
  tapAnswers,
} from './exchange.ts';

const ACTION = 'a0000000-0000-4000-8000-000000000001';

Deno.test('exchange › reply words keep every reply, buttons and rows in order', () => {
  const words = replyWords([
    { kind: 'text', text: 'Hello' },
    { kind: 'buttons', text: 'Save?', buttons: [{ id: 'b', title: 'Save' }] },
    { kind: 'list', text: 'Pick', buttonLabel: 'Open', rows: [{ id: 'r', title: 'Ramesh' }] },
    { kind: 'audio', mediaId: 'M' },
  ]);
  assertEquals(words, 'Hello\n\nSave?\n[Save]\n\nPick\n• Ramesh\n\n🔊 (voice reply)');
  assertEquals(replyWords([]), null);
});

Deno.test('exchange › the card shown and the card a tap answers', () => {
  const card = {
    kind: 'buttons' as const,
    text: 'Add credit',
    buttons: [{ id: cardButtonId(ACTION, 'save'), title: 'Save' }],
  };
  assertEquals(cardShown([{ kind: 'text', text: 'hi' }, card]), ACTION);
  assertEquals(cardShown([{ kind: 'text', text: 'hi' }]), null);
  assertEquals(tapAnswers(cardButtonId(ACTION, 'cancel')), ACTION);
  assertEquals(tapAnswers(pickRowId(ACTION, 1)), ACTION);
  assertEquals(tapAnswers('m:pending'), null);
});

Deno.test('exchange › long text is cut; smoke messages are tests', () => {
  assertEquals(keptText('x'.repeat(MAX_EXCHANGE_TEXT + 5))?.length, MAX_EXCHANGE_TEXT);
  assertEquals(keptText(''), null);
  assertEquals([isTestMessage('wamid.SMOKE-1-2'), isTestMessage('wamid.HBgM')], [true, false]);
});
