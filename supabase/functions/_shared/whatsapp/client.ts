// supabase/functions/_shared/whatsapp/client.ts
// Sends replies through the WhatsApp Cloud API (POST /{phone-number-id}/messages). Requests are
// typed, texts are cut to Meta's limits, and every call has a timeout. Failures are logged with
// Meta's error code only: Meta's messages can quote the recipient, and the token must never leak.
import { z } from 'zod';
import type { Logger } from '../log.ts';
import { type Button, type ListRow, MAX_BUTTONS, MAX_LIST_ROWS, type Reply } from './replies.ts';

export const GRAPH_API_BASE = 'https://graph.facebook.com/v25.0';
const SEND_TIMEOUT_MS = 10_000;
const LIMITS = {
  text: 4096,
  interactiveBody: 1024,
  caption: 1024,
  buttonTitle: 20,
  rowTitle: 24,
  rowDescription: 72,
  listButton: 20,
} as const;

export interface WhatsAppClientConfig {
  readonly accessToken: string;
  readonly phoneNumberId: string;
  readonly fetchImpl: typeof fetch;
  readonly log: Logger;
}

export interface WhatsAppClient {
  /** Meta's message id, or null when the send failed (already logged). */
  send(to: string, reply: Reply): Promise<string | null>;
}

const SentSchema = z.object({ messages: z.tuple([z.object({ id: z.string() })], z.unknown()) });
const ErrorSchema = z.object({
  error: z.object({ code: z.number().optional(), error_subcode: z.number().optional() }),
});

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function buttonsOf(buttons: readonly Button[]): object[] {
  return buttons.slice(0, MAX_BUTTONS).map((button) => ({
    type: 'reply',
    reply: { id: button.id, title: cut(button.title, LIMITS.buttonTitle) },
  }));
}

function rowsOf(rows: readonly ListRow[]): object[] {
  return rows.slice(0, MAX_LIST_ROWS).map((row) => ({
    id: row.id,
    title: cut(row.title, LIMITS.rowTitle),
    ...(row.description ? { description: cut(row.description, LIMITS.rowDescription) } : {}),
  }));
}

type TemplateReply = Extract<Reply, { kind: 'template' }>;

/** A template message: name, language and the body's {{1}}, {{2}}… values, in order. */
function templateOf(reply: TemplateReply): Record<string, unknown> {
  const parameters = reply.bodyParams.map((text) => ({ type: 'text', text }));
  return {
    name: reply.name,
    language: { code: reply.languageCode },
    components: parameters.length > 0 ? [{ type: 'body', parameters }] : [],
  };
}

/** The Cloud API request body for one reply. */
export function toMetaMessage(to: string, reply: Reply): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  if (reply.kind === 'template') return { ...base, type: 'template', template: templateOf(reply) };
  if (reply.kind === 'text') {
    return { ...base, type: 'text', text: { body: cut(reply.text, LIMITS.text) } };
  }
  if (reply.kind === 'audio') return { ...base, type: 'audio', audio: { id: reply.mediaId } };
  if (reply.kind === 'image') {
    const image = { id: reply.mediaId, caption: cut(reply.text, LIMITS.caption) };
    return { ...base, type: 'image', image };
  }
  const body = { text: cut(reply.text, LIMITS.interactiveBody) };
  if (reply.kind === 'buttons') {
    const interactive = { type: 'button', body, action: { buttons: buttonsOf(reply.buttons) } };
    return { ...base, type: 'interactive', interactive };
  }
  const action = {
    button: cut(reply.buttonLabel, LIMITS.listButton),
    sections: [{ rows: rowsOf(reply.rows) }],
  };
  return { ...base, type: 'interactive', interactive: { type: 'list', body, action } };
}

async function describeFailure(response: Response): Promise<string> {
  const parsed = ErrorSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return `HTTP ${response.status}`;
  const { code, error_subcode: subcode } = parsed.data.error;
  return `HTTP ${response.status} code ${code ?? '-'} subcode ${subcode ?? '-'}`;
}

export function createWhatsAppClient(config: WhatsAppClientConfig): WhatsAppClient {
  const url = `${GRAPH_API_BASE}/${config.phoneNumberId}/messages`;
  return {
    async send(to, reply): Promise<string | null> {
      try {
        const response = await config.fetchImpl(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.accessToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(toMetaMessage(to, reply)),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        if (!response.ok) {
          config.log('error', 'whatsapp_send_failed', {
            kind: reply.kind,
            error: await describeFailure(response),
          });
          return null;
        }
        return SentSchema.parse(await response.json()).messages[0].id;
      } catch (error) {
        const name = error instanceof Error ? error.name : 'unknown';
        config.log('error', 'whatsapp_send_failed', { kind: reply.kind, error: name });
        return null;
      }
    },
  };
}
