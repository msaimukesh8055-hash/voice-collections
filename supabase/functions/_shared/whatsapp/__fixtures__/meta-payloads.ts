// supabase/functions/_shared/whatsapp/__fixtures__/meta-payloads.ts
// Fake Meta webhook bodies for tests (FAKE numbers in the never-real +91 00000 range).

export const PHONE_NUMBER_ID = '100000000000001';
export const FAKE_OWNER_NUMBER = '910000099999';
export const FAKE_STRANGER_NUMBER = '910000011111';

export interface PayloadOptions {
  readonly id?: string;
  readonly from?: string;
  readonly text?: string;
  readonly buttonId?: string;
  readonly listRowId?: string;
  readonly type?: string;
  /** A voice note's media id (M6): Meta's shape for a recorded voice note. */
  readonly audioId?: string;
}

function messageOf(options: PayloadOptions): Record<string, unknown> {
  const base = {
    from: options.from ?? FAKE_OWNER_NUMBER,
    id: options.id ?? 'wamid.TEST1',
    timestamp: '1793638361',
  };
  if (options.buttonId !== undefined) {
    const interactive = {
      type: 'button_reply',
      button_reply: { id: options.buttonId, title: 'x' },
    };
    return { ...base, type: 'interactive', interactive };
  }
  if (options.listRowId !== undefined) {
    const interactive = { type: 'list_reply', list_reply: { id: options.listRowId, title: 'x' } };
    return { ...base, type: 'interactive', interactive };
  }
  if (options.audioId !== undefined) {
    const audio = {
      mime_type: 'audio/ogg; codecs=opus',
      sha256: 'x',
      id: options.audioId,
      voice: true,
    };
    return { ...base, type: 'audio', audio };
  }
  if (options.type !== undefined) return { ...base, type: options.type };
  return { ...base, type: 'text', text: { body: options.text ?? 'hi' } };
}

/** One message, shaped like Meta's "messages" webhook. */
export function metaPayload(options: PayloadOptions = {}): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550000000', phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ wa_id: options.from ?? FAKE_OWNER_NUMBER, profile: { name: 'Test' } }],
          messages: [messageOf(options)],
        },
      }],
    }],
  };
}
