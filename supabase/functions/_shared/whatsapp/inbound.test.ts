// supabase/functions/_shared/whatsapp/inbound.test.ts
import { assertEquals } from '@std/assert';
import { extractMessages, MAX_TEXT_LENGTH, WebhookPayloadSchema } from './inbound.ts';
import { metaPayload, PHONE_NUMBER_ID } from './__fixtures__/meta-payloads.ts';

function parse(raw: unknown): ReturnType<typeof extractMessages> {
  return extractMessages(WebhookPayloadSchema.parse(raw), PHONE_NUMBER_ID);
}

Deno.test('inbound › a text message gives its id, sender and trimmed text', () => {
  const [message] = parse(metaPayload({ text: '  pending ' }));
  assertEquals(message, { id: 'wamid.TEST1', from: '910000099999', kind: 'text', text: 'pending' });
});

Deno.test('inbound › a button tap and a list pick give the tapped id', () => {
  const [button] = parse(metaPayload({ buttonId: 'c:abc:save' }));
  const [row] = parse(metaPayload({ listRowId: 'c:abc:p1' }));
  assertEquals([button?.kind, row?.kind], ['tap', 'tap']);
  assertEquals(button?.kind === 'tap' ? button.buttonId : '', 'c:abc:save');
  assertEquals(row?.kind === 'tap' ? row.buttonId : '', 'c:abc:p1');
});

Deno.test('inbound › a voice note gives its media id (M6)', () => {
  const [voice] = parse(metaPayload({ audioId: 'MEDIA1' }));
  assertEquals(voice, {
    id: 'wamid.TEST1',
    from: '910000099999',
    kind: 'voice',
    mediaId: 'MEDIA1',
  });
});

Deno.test('inbound › images, audio without a media id and empty texts are "other"', () => {
  const [image] = parse(metaPayload({ type: 'image' }));
  const [audio] = parse(metaPayload({ type: 'audio' }));
  const [blank] = parse(metaPayload({ text: '   ' }));
  assertEquals([image?.kind, audio?.kind, blank?.kind], ['other', 'other', 'other']);
});

Deno.test('inbound › very long texts are cut', () => {
  const [message] = parse(metaPayload({ text: 'a'.repeat(5000) }));
  assertEquals(message?.kind === 'text' ? message.text.length : 0, MAX_TEXT_LENGTH);
});

Deno.test('inbound › delivery receipts carry no messages', () => {
  const receipt = {
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'x' }] } }] }],
  };
  assertEquals(parse(receipt), []);
});

Deno.test('inbound › messages to another phone number id are dropped', () => {
  const raw = metaPayload({ text: 'pending' });
  assertEquals(extractMessages(WebhookPayloadSchema.parse(raw), '999'), []);
});

Deno.test('inbound › a payload without entries fails the schema', () => {
  assertEquals(WebhookPayloadSchema.safeParse({ object: 'x' }).success, false);
});
