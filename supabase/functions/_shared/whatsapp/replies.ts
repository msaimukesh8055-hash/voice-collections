// supabase/functions/_shared/whatsapp/replies.ts
// What the bot says, as plain data. Bot logic returns Reply values; only the Meta client turns
// them into HTTP requests, so the logic is tested without any network.
import type { Language } from '../schemas/shopkeeper.ts';

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

/** Dry-run fix 4: the same message rendered from its template in English, for the "English
 * under Telugu" twin (so fixed wording is never machine-translated). Not sent on its own. */
interface EnglishRendering {
  readonly english?: string;
}

export type Reply =
  | { readonly kind: 'text'; readonly text: string } & EnglishRendering
  | {
    readonly kind: 'buttons';
    readonly text: string;
    readonly buttons: readonly Button[];
  } & EnglishRendering
  | {
    readonly kind: 'list';
    readonly text: string;
    readonly buttonLabel: string;
    readonly rows: readonly ListRow[];
  } & EnglishRendering
  | {
    /** An approved Meta template: the only message allowed outside WhatsApp's 24-hour window
     * (M5 Decision 7). `text` is our copy of what the owner will read, for logs and tests. */
    readonly kind: 'template';
    readonly name: string;
    readonly languageCode: string;
    readonly bodyParams: readonly string[];
    readonly text: string;
  }
  /** A file already uploaded to Meta (M6): a Bulbul voice reply (MP3). */
  | { readonly kind: 'audio'; readonly mediaId: string }
  /** A file already uploaded to Meta (M6): the insights pie chart, with a caption. */
  | { readonly kind: 'image'; readonly mediaId: string; readonly text: string } & EnglishRendering;

/** Replies that can carry an English rendering: text, buttons, list and an image's caption. */
export type BodiedReply = Exclude<Reply, { kind: 'template' | 'audio' }>;

export function isBodied(reply: Reply): reply is BodiedReply {
  return reply.kind !== 'template' && reply.kind !== 'audio';
}

/**
 * A message built from a template, in the owner's language, carrying the same template rendered
 * in English (same data) for the twin. `render` must be pure: it is called once per language.
 */
export function withEnglish(language: Language, render: (language: Language) => Reply): Reply {
  const reply = render(language);
  if (language === 'en' || !isBodied(reply)) return reply;
  const english = render('en');
  return isBodied(english) ? { ...reply, english: english.text } : reply;
}

/** `withEnglish` for a plain text line. */
export function textIn(language: Language, line: (language: Language) => string): Reply {
  return withEnglish(language, (each) => textReply(line(each)));
}

/** Replies with a text body (everything except a voice reply). */
export type TextualReply = Exclude<Reply, { kind: 'audio' }>;

export function hasText(reply: Reply): reply is TextualReply {
  return reply.kind !== 'audio';
}

type Block = string | readonly string[] | null;

/** A message built from blocks with one blank line between them (M6 Decision 6: title, blank
 * line, body, blank line, footer). A block is one line or several lines kept together; empty
 * blocks are left out, so a message never has two blank lines in a row. */
export function blocks(...parts: readonly Block[]): string {
  return parts
    .map(function blockText(part): string {
      if (part === null) return '';
      return typeof part === 'string' ? part : part.join('\n');
    })
    .filter((text) => text.trim() !== '')
    .join('\n\n');
}

export function textReply(text: string): Reply {
  return { kind: 'text', text };
}

/** Plain text of every reply, joined (tests and the owner-number leak check use it). */
export function replyText(replies: readonly Reply[]): string {
  return replies.map(function textOf(reply): string {
    if (reply.kind === 'audio') return '[voice note]';
    if (reply.kind === 'text' || reply.kind === 'template' || reply.kind === 'image') {
      return reply.text;
    }
    const extras = reply.kind === 'buttons'
      ? reply.buttons.map((button) => button.title)
      : reply.rows.map((row) => `${row.title} ${row.description ?? ''}`);
    return [reply.text, ...extras].join('\n');
  }).join('\n---\n');
}
