// scripts/lib/meta-webhook.ts
// Meta-shaped webhook deliveries for the deployed smoke scripts (smoke:whatsapp, smoke:reminders):
// the JSON Meta would POST, its x-hub-signature-256 (HMAC-SHA256 of the raw body with the App
// Secret), and the keyed sender hash the webhook stores (same as _shared/whatsapp/sender.ts).
// Nothing here reads .env; only postWebhook touches the network.
import { createHmac } from 'node:crypto';

export type MetaMessage = Readonly<Record<string, unknown>>;

export function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/** HMAC-SHA256 of the number's digits with the App Secret, hex (the wa_messages sender_hash). */
export function senderHash(appSecret: string, number: string): string {
  return createHmac('sha256', appSecret).update(digits(number)).digest('hex');
}

export function sign(appSecret: string, body: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
}

/** One delivery holding one message, addressed to our phone number id. */
export function metaPayload(phoneNumberId: string, from: string, message: MetaMessage): string {
  const value = {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '15550000000', phone_number_id: phoneNumberId },
    messages: [{ from, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
  };
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'smoke', changes: [{ field: 'messages', value }] }],
  });
}

export function textMessage(id: string, text: string): MetaMessage {
  return { id, type: 'text', text: { body: text } };
}

/** A reply-button tap; the webhook acts on the id only, the title is for show. */
export function tapMessage(id: string, buttonId: string, title = 'Tap'): MetaMessage {
  return {
    id,
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: buttonId, title } },
  };
}

/** POSTs a delivery (signature null = header left out) and returns the status code. */
export async function postWebhook(
  url: string,
  body: string,
  signature: string | null,
): Promise<number> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['x-hub-signature-256'] = signature;
  const response = await fetch(url, { method: 'POST', headers, body });
  await response.text();
  return response.status;
}
