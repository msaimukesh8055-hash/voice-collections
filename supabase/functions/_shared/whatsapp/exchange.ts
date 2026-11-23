// supabase/functions/_shared/whatsapp/exchange.ts
// WhatsApp live checks (Saim, 2026-11-22; ADR-0022): one "exchange" = one owner message, the bot's
// reply and what happened to any Save card it showed. This file is pure: it turns what the webhook
// already has (the message, the replies, the path) into the row that is kept. Message text and
// reply text are kept for 30 days (a daily job deletes older rows); phone numbers never are.
import { parseTap } from '../cards/ids.ts';
import type { MessagePath } from '../db/book-repository.ts';
import type { Reply } from './replies.ts';

/** The longest message or reply text kept; a long list is cut, not dropped. */
export const MAX_EXCHANGE_TEXT = 2_000;

export interface NewExchange {
  readonly waMessageId: string;
  readonly msgType: string;
  readonly path: MessagePath;
  readonly command: string | null;
  /** What he wrote, what Saaras heard from his voice note, or the button he tapped. */
  readonly inText: string | null;
  readonly replyText: string | null;
  readonly language: string | null;
  readonly repliesSent: number;
  readonly repliesFailed: number;
  readonly voiceReply: boolean;
  /** A Save card (or a pick list) this exchange showed, by its pending action id. */
  readonly cardActionId: string | null;
  /** The card this tap answered. */
  readonly answersActionId: string | null;
  /** Ledger changes made while handling this message: entries added, claims settled, reversals. */
  readonly moneyWrites: number;
  readonly errorCode: string | null;
  readonly handleMs: number;
  readonly isTest: boolean;
  /** The request's trace (2026-11-23), for the report's step-by-step view; null when unknown. */
  readonly traceId?: string | null;
}

function cut(text: string): string {
  return text.length > MAX_EXCHANGE_TEXT ? `${text.slice(0, MAX_EXCHANGE_TEXT - 1)}…` : text;
}

function words(reply: Reply): string {
  switch (reply.kind) {
    case 'text':
    case 'image':
      return reply.text;
    case 'buttons':
      return `${reply.text}\n${reply.buttons.map((button) => `[${button.title}]`).join(' ')}`;
    case 'list':
      return `${reply.text}\n${reply.rows.map((row) => `• ${row.title}`).join('\n')}`;
    case 'template':
      return reply.text;
    case 'audio':
      return '🔊 (voice reply)';
  }
}

/** The bot's reply as one block of text, in the order it was sent. */
export function replyWords(replies: readonly Reply[]): string | null {
  if (replies.length === 0) return null;
  return cut(replies.map(words).join('\n\n'));
}

function buttonIds(reply: Reply): readonly string[] {
  if (reply.kind === 'buttons') return reply.buttons.map((button) => button.id);
  if (reply.kind === 'list') return reply.rows.map((row) => row.id);
  return [];
}

/** The pending action behind a card (Save / Edit / Cancel) or pick list in these replies. */
export function cardShown(replies: readonly Reply[]): string | null {
  for (const id of replies.flatMap(buttonIds)) {
    const tap = parseTap(id);
    if (tap?.kind === 'card' || tap?.kind === 'pick') return tap.actionId;
  }
  return null;
}

/** The pending action a tap answered, when the tap was on a card or pick list. */
export function tapAnswers(buttonId: string): string | null {
  const tap = parseTap(buttonId);
  return tap?.kind === 'card' || tap?.kind === 'pick' ? tap.actionId : null;
}

/** Messages the free smoke script sends carry "SMOKE-" in their id (scripts/smoke-whatsapp.ts). */
export function isTestMessage(waMessageId: string): boolean {
  return waMessageId.includes('SMOKE-');
}

export function keptText(text: string | null | undefined): string | null {
  return text ? cut(text) : null;
}
