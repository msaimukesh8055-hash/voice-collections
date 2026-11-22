// supabase/functions/_shared/calls/whatsapp-scorecard.ts
// WhatsApp live checks (Saim, 2026-11-22; ADR-0022): one owner message and the bot's answer,
// scored the way Asha's and Munshi's calls are: Guardrails, Outcome, Latency and Cost, the same
// verdict rule (a guardrail fail = failed; any other fail or 3+ warnings = needs a look). Pure
// code, no AI, ₹0. Costs are estimates: token counts are not kept per message.
import type { ExchangeRow } from '../db/exchange-repository.ts';
import { type CallScore, toCallScore } from './agent-health.ts';
import { type Check, check, type CheckGroup, type Scorecard, summarise } from './scorecard.ts';

/** Reply time limits: a typed message or tap, and a voice note (Saaras + Bulbul add seconds). */
export const TEXT_REPLY_GOOD_MS = 3_000;
export const TEXT_REPLY_OK_MS = 6_000;
export const VOICE_REPLY_GOOD_MS = 8_000;
export const VOICE_REPLY_OK_MS = 15_000;

/** M6 cost table: sarvam-105b read ≈ ₹0.02; Saaras ≈ ₹0.49 a note (per started minute); a
 * voice reply ≈ ₹0.75 Bulbul + ₹0.02 for its spoken summary. Gemini is free. */
export const LLM_READ_INR = 0.02;
export const VOICE_IN_INR = 0.49;
export const VOICE_REPLY_INR = 0.77;
export const EXCHANGE_BUDGET_INR = 2;

export const WHATSAPP_GAPS: readonly string[] = [
  'The tone of replies is not judged (the wording is fixed in code for most replies).',
  'Costs are estimates from the M6 price table: token counts are not kept per message.',
  'Message text and replies are kept for 30 days, then deleted.',
];

/** Commands that mean the bot did not understand, or could not hear, what he sent. */
const NOT_UNDERSTOOD = new Set(['unknown', 'unknown_button', 'unsupported']);

function moneyOnTap(row: ExchangeRow): Check {
  const label = 'Money moved only on a button tap';
  if (row.moneyWrites === 0) return check('wa_money_on_tap', label, ['na', 'no money moved']);
  const value = `${row.moneyWrites} ledger change(s) on a ${row.msgType}`;
  return check('wa_money_on_tap', label, [row.msgType === 'tap' ? 'pass' : 'fail', value]);
}

function noCardWhenLost(row: ExchangeRow): Check {
  const label = 'No money card from a message it did not understand';
  const lost = row.path === 'failed' || NOT_UNDERSTOOD.has(row.command ?? '');
  if (!lost) return check('wa_no_card_when_lost', label, ['na', 'understood']);
  return check(
    'wa_no_card_when_lost',
    label,
    row.cardActionId ? ['fail', 'a card was shown'] : [
      'pass',
      'no card',
    ],
  );
}

function understood(row: ExchangeRow): Check {
  const label = 'Understood what he sent';
  if (row.path === 'failed') {
    const why = row.errorCode ? `error: ${row.errorCode}` : 'neither AI model could read it';
    return check('wa_understood', label, ['fail', why]);
  }
  const command = row.command ?? '';
  if (NOT_UNDERSTOOD.has(command) || command.startsWith('voice_')) {
    return check('wa_understood', label, ['warn', command.replace('_', ' ')]);
  }
  return check('wa_understood', label, ['pass', `${command || 'answered'} (${row.path})`]);
}

function cardAnswered(row: ExchangeRow, now: Date): Check {
  const label = 'Card answered';
  if (!row.cardActionId) return check('wa_card_answered', label, ['na', 'no card']);
  const card = row.card;
  if (!card) return check('wa_card_answered', label, ['na', 'card no longer kept']);
  if (card.status === 'saved' || card.status === 'done') {
    return check('wa_card_answered', label, ['pass', card.status]);
  }
  if (card.status === 'cancelled') {
    return check('wa_card_answered', label, ['warn', 'cancelled: it may have misread him']);
  }
  const expired = card.status === 'expired' || Date.parse(card.expiresAt) <= now.getTime();
  return check(
    'wa_card_answered',
    label,
    expired ? ['warn', 'no reply before it expired'] : [
      'na',
      'waiting for his tap',
    ],
  );
}

function voiceAnswered(row: ExchangeRow): Check {
  const label = 'Voice note got a voice reply';
  if (row.msgType !== 'voice' || row.inText === null) {
    return check('wa_voice_reply', label, ['na', 'not a heard voice note']);
  }
  return check('wa_voice_reply', label, row.voiceReply ? ['pass', 'sent'] : ['warn', 'text only']);
}

function delivered(row: ExchangeRow): Check {
  const label = 'Every reply reached WhatsApp';
  const total = row.repliesSent + row.repliesFailed;
  if (total === 0) return check('wa_delivered', label, ['fail', 'nothing was sent']);
  if (row.repliesFailed > 0) {
    return check('wa_delivered', label, ['fail', `${row.repliesFailed} of ${total} not sent`]);
  }
  return check('wa_delivered', label, ['pass', `${row.repliesSent} sent`]);
}

function replyTime(row: ExchangeRow): Check {
  const voice = row.msgType === 'voice';
  const good = voice ? VOICE_REPLY_GOOD_MS : TEXT_REPLY_GOOD_MS;
  const ok = voice ? VOICE_REPLY_OK_MS : TEXT_REPLY_OK_MS;
  const label = `Reply time (aim ≤ ${good / 1000} s)`;
  const value = `${(row.handleMs / 1000).toFixed(1)} s`;
  const status = row.handleMs <= good ? 'pass' : row.handleMs <= ok ? 'warn' : 'fail';
  return check('wa_reply_time', label, [status, value]);
}

/** The estimated cost of one exchange, in ₹. */
export function exchangeCost(row: ExchangeRow): number {
  const llm = row.path === 'sarvam' ? LLM_READ_INR : 0;
  const heard = row.msgType === 'voice' ? VOICE_IN_INR : 0;
  const spoken = row.voiceReply ? VOICE_REPLY_INR : 0;
  return Math.round((llm + heard + spoken) * 100) / 100;
}

function cost(row: ExchangeRow): Check {
  const inr = exchangeCost(row);
  const label = `Cost (aim ≤ ₹${EXCHANGE_BUDGET_INR.toFixed(2)})`;
  const value = `₹${inr.toFixed(2)} (estimate)`;
  return check('wa_cost', label, [inr <= EXCHANGE_BUDGET_INR ? 'pass' : 'warn', value]);
}

export function scoreExchange(row: ExchangeRow, now: Date): Scorecard {
  const groups: CheckGroup[] = [
    { name: 'Guardrails', checks: [moneyOnTap(row), noCardWhenLost(row)] },
    {
      name: 'Outcome',
      checks: [understood(row), cardAnswered(row, now), voiceAnswered(row), delivered(row)],
    },
    { name: 'Latency', checks: [replyTime(row)] },
    { name: 'Cost', checks: [cost(row)] },
  ];
  return { ...summarise(groups, []), groups, toolUse: [], gaps: WHATSAPP_GAPS };
}

/** One exchange as Agent health keeps a score: the reply time stands in for "reply p50". */
export function exchangeScore(row: ExchangeRow, now: Date): CallScore {
  return toCallScore(
    {
      agent: 'whatsapp',
      callId: row.id,
      startedAt: row.createdAt,
      tone: {},
      costInr: exchangeCost(row),
      replyP50Ms: row.handleMs,
    },
    scoreExchange(row, now),
  );
}
