// supabase/functions/_shared/whatsapp/inbound.ts
// Meta's webhook payload, checked with Zod (after the signature check). Only what the bot uses is
// kept: message id, sender, and the text, the id of the tapped button / list row, or the media
// id of a voice note (M6: Meta sends voice notes as type "audio", OGG/Opus).
// Delivery receipts ("statuses") and other fields are ignored. Messages addressed to another
// phone number id are dropped, in case the app is ever linked to a second number.
import { z } from 'zod';

/** Longer texts are cut before they reach the parser or the LLM (cost and prompt safety). */
export const MAX_TEXT_LENGTH = 1000;

const ReplyRef = z.looseObject({ id: z.string().min(1).max(256) });

const MessageSchema = z.looseObject({
  from: z.string().min(1).max(32),
  id: z.string().min(1).max(256),
  type: z.string(),
  text: z.looseObject({ body: z.string() }).optional(),
  audio: z.looseObject({ id: z.string().min(1).max(256) }).optional(),
  interactive: z
    .looseObject({ button_reply: ReplyRef.optional(), list_reply: ReplyRef.optional() })
    .optional(),
});

const ValueSchema = z.looseObject({
  metadata: z.looseObject({ phone_number_id: z.string() }).optional(),
  messages: z.array(MessageSchema).optional(),
});

export const WebhookPayloadSchema = z.looseObject({
  object: z.string(),
  entry: z.array(
    z.looseObject({
      changes: z.array(z.looseObject({ field: z.string().optional(), value: ValueSchema })),
    }),
  ),
});

export type WebhookPayload = z.infer<typeof WebhookPayloadSchema>;
type MetaMessage = z.infer<typeof MessageSchema>;

interface Base {
  readonly id: string;
  /** Sender's number as Meta sends it. Used to reply and to check the owner; never logged. */
  readonly from: string;
}

export type InboundMessage =
  | (Base & { readonly kind: 'text'; readonly text: string })
  | (Base & { readonly kind: 'tap'; readonly buttonId: string })
  /** A voice note or audio file: only Meta's media id; the sound is fetched when handled. */
  | (Base & { readonly kind: 'voice'; readonly mediaId: string })
  | (Base & { readonly kind: 'other'; readonly type: string });

function toInbound(message: MetaMessage): InboundMessage {
  const base = { id: message.id, from: message.from };
  const text = message.text?.body.trim();
  if (message.type === 'text' && text) {
    return { ...base, kind: 'text', text: text.slice(0, MAX_TEXT_LENGTH) };
  }
  const tapped = message.interactive?.button_reply ?? message.interactive?.list_reply;
  if (message.type === 'interactive' && tapped) {
    return { ...base, kind: 'tap', buttonId: tapped.id };
  }
  if (message.type === 'audio' && message.audio) {
    return { ...base, kind: 'voice', mediaId: message.audio.id };
  }
  return { ...base, kind: 'other', type: message.type };
}

/** Every message in the payload sent to our number, in order. */
export function extractMessages(
  payload: WebhookPayload,
  phoneNumberId: string,
): readonly InboundMessage[] {
  return payload.entry
    .flatMap((entry) => entry.changes)
    .filter((change) => (change.value.metadata?.phone_number_id ?? phoneNumberId) === phoneNumberId)
    .flatMap((change) => change.value.messages ?? [])
    .map(toInbound);
}
