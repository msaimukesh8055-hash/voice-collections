// supabase/functions/_shared/whatsapp/replies.ts
// What the bot says, as plain data. Bot logic returns Reply values; only the Meta client turns
// them into HTTP requests, so the logic is tested without any network.

/** Meta limits: 3 reply buttons, 10 list rows. */
export const MAX_BUTTONS = 3;
export const MAX_LIST_ROWS = 10;

export interface Button {
  readonly id: string;
  readonly title: string;
}

export interface ListRow {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
}

export type Reply =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'buttons'; readonly text: string; readonly buttons: readonly Button[] }
  | {
    readonly kind: 'list';
    readonly text: string;
    readonly buttonLabel: string;
    readonly rows: readonly ListRow[];
  };

export function textReply(text: string): Reply {
  return { kind: 'text', text };
}

/** Plain text of every reply, joined (tests and the owner-number leak check use it). */
export function replyText(replies: readonly Reply[]): string {
  return replies.map(function textOf(reply): string {
    if (reply.kind === 'text') return reply.text;
    const extras = reply.kind === 'buttons'
      ? reply.buttons.map((button) => button.title)
      : reply.rows.map((row) => `${row.title} ${row.description ?? ''}`);
    return [reply.text, ...extras].join('\n');
  }).join('\n---\n');
}
