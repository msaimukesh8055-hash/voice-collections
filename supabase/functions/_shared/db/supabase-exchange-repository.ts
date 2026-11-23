// supabase/functions/_shared/db/supabase-exchange-repository.ts
// ExchangeLog and ExchangeReads over the database HTTP API (service role). A bad row is an error,
// as for every read. Card states come from pending_actions in one extra read.
import { z } from 'zod';
import type { NewExchange } from '../whatsapp/exchange.ts';
import { ACTION_STATUSES, MESSAGE_PATHS } from './book-repository.ts';
import type { ExchangeLog, ExchangeReads, ExchangeRow } from './exchange-repository.ts';
import type { PostgrestClient } from './postgrest.ts';

const COLUMNS = 'id,created_at,wa_message_id,msg_type,path,command,in_text,reply_text,language,' +
  'replies_sent,replies_failed,voice_reply,card_action_id,answers_action_id,money_writes,' +
  'error_code,handle_ms,is_test,trace_id';

const Row = z.object({
  id: z.string(),
  created_at: z.string(),
  wa_message_id: z.string(),
  msg_type: z.string(),
  path: z.enum(MESSAGE_PATHS),
  command: z.string().nullable(),
  in_text: z.string().nullable(),
  reply_text: z.string().nullable(),
  language: z.string().nullable(),
  replies_sent: z.number().int(),
  replies_failed: z.number().int(),
  voice_reply: z.boolean(),
  card_action_id: z.string().nullable(),
  answers_action_id: z.string().nullable(),
  money_writes: z.number().int(),
  error_code: z.string().nullable(),
  handle_ms: z.number().int(),
  is_test: z.boolean(),
  trace_id: z.string().nullable().optional(),
});
type RowData = z.infer<typeof Row>;

const CardRow = z.object({
  id: z.string(),
  status: z.enum(ACTION_STATUSES),
  expires_at: z.string(),
});

function toRow(row: RowData, cards: ReadonlyMap<string, z.infer<typeof CardRow>>): ExchangeRow {
  const card = row.card_action_id ? cards.get(row.card_action_id) : undefined;
  return {
    id: row.id,
    createdAt: row.created_at,
    waMessageId: row.wa_message_id,
    msgType: row.msg_type,
    path: row.path,
    command: row.command,
    inText: row.in_text,
    replyText: row.reply_text,
    language: row.language,
    repliesSent: row.replies_sent,
    repliesFailed: row.replies_failed,
    voiceReply: row.voice_reply,
    cardActionId: row.card_action_id,
    answersActionId: row.answers_action_id,
    moneyWrites: row.money_writes,
    errorCode: row.error_code,
    handleMs: row.handle_ms,
    isTest: row.is_test,
    traceId: row.trace_id ?? null,
    card: card ? { status: card.status, expiresAt: card.expires_at } : null,
  };
}

function toInsert(exchange: NewExchange): Record<string, unknown> {
  return {
    wa_message_id: exchange.waMessageId,
    msg_type: exchange.msgType,
    path: exchange.path,
    command: exchange.command,
    in_text: exchange.inText,
    reply_text: exchange.replyText,
    language: exchange.language,
    replies_sent: exchange.repliesSent,
    replies_failed: exchange.repliesFailed,
    voice_reply: exchange.voiceReply,
    card_action_id: exchange.cardActionId,
    answers_action_id: exchange.answersActionId,
    money_writes: exchange.moneyWrites,
    error_code: exchange.errorCode,
    handle_ms: exchange.handleMs,
    is_test: exchange.isTest,
    trace_id: exchange.traceId ?? null,
  };
}

export function createSupabaseExchangeLog(query: PostgrestClient): ExchangeLog {
  return {
    async record(exchange): Promise<void> {
      await query('recordExchange', 'wa_exchanges', {
        method: 'POST',
        body: toInsert(exchange),
        prefer: 'return=minimal',
      });
    },
  };
}

export function createSupabaseExchangeReads(query: PostgrestClient): ExchangeReads {
  return {
    async listExchanges(limit): Promise<readonly ExchangeRow[]> {
      const path = `wa_exchanges?select=${COLUMNS}&order=created_at.desc&limit=${limit}`;
      const rows = z.array(Row).parse((await query('listExchanges', path)).rows);
      const ids = [
        ...new Set(rows.flatMap((row) => row.card_action_id ? [row.card_action_id] : [])),
      ];
      if (ids.length === 0) return rows.map((row) => toRow(row, new Map()));
      const list = ids.map(encodeURIComponent).join(',');
      const cardRows = z.array(CardRow).parse(
        (await query(
          'listExchangeCards',
          `pending_actions?select=id,status,expires_at&id=in.(${list})`,
        ))
          .rows,
      );
      const cards = new Map(cardRows.map((card) => [card.id, card]));
      return rows.map((row) => toRow(row, cards));
    },
  };
}
