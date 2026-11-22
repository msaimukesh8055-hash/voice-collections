// supabase/functions/_shared/calls/whatsapp-scorecard.test.ts
// WhatsApp live checks (ADR-0022): one exchange's scorecard. FAKE DATA ONLY.
import { assertEquals } from '@std/assert';
import { fakeExchange } from '../db/fake-exchange-reads.ts';
import { exchangeCost, exchangeScore, scoreExchange } from './whatsapp-scorecard.ts';

const NOW = new Date('2026-11-22T05:30:00Z');

function statusOf(id: string, ...args: Parameters<typeof fakeExchange>): string | undefined {
  const card = scoreExchange(fakeExchange(...args), NOW);
  return card.groups.flatMap((group) => group.checks).find((one) => one.id === id)?.status;
}

Deno.test('whatsapp scorecard › a typed credit whose card was saved goes well', () => {
  const card = scoreExchange(fakeExchange(), NOW);
  assertEquals(card.verdict, 'good');
  assertEquals(card.groups.map((group) => group.name), [
    'Guardrails',
    'Outcome',
    'Latency',
    'Cost',
  ]);
  assertEquals(statusOf('wa_card_answered'), 'pass');
  assertEquals(statusOf('wa_money_on_tap'), 'na');
});

Deno.test('whatsapp scorecard › money moved on typed text is a guardrail fail', () => {
  const card = scoreExchange(fakeExchange({ moneyWrites: 1 }), NOW);
  assertEquals(card.verdict, 'failed');
  assertEquals(statusOf('wa_money_on_tap', { moneyWrites: 1, msgType: 'tap' }), 'pass');
});

Deno.test('whatsapp scorecard › a card from a message it did not understand is a guardrail fail', () => {
  assertEquals(statusOf('wa_no_card_when_lost', { path: 'failed' }), 'fail');
  assertEquals(statusOf('wa_no_card_when_lost', { path: 'failed', cardActionId: null }), 'pass');
  assertEquals(statusOf('wa_no_card_when_lost'), 'na');
});

Deno.test('whatsapp scorecard › not understood: failed is a fail, unknown is a warning', () => {
  assertEquals(statusOf('wa_understood', { path: 'failed', cardActionId: null }), 'fail');
  assertEquals(statusOf('wa_understood', { command: 'unknown', cardActionId: null }), 'warn');
  assertEquals(statusOf('wa_understood', { command: 'voice_too_long' }), 'warn');
});

Deno.test('whatsapp scorecard › card cancelled or never answered is a warning; still open is n/a', () => {
  const card = (status: 'cancelled' | 'open' | 'expired', expiresAt: string) => ({
    card: { status, expiresAt },
  });
  assertEquals(statusOf('wa_card_answered', card('cancelled', '2026-11-22T06:00:00Z')), 'warn');
  assertEquals(statusOf('wa_card_answered', card('open', '2026-11-22T05:10:00Z')), 'warn');
  assertEquals(statusOf('wa_card_answered', card('open', '2026-11-22T06:00:00Z')), 'na');
  assertEquals(statusOf('wa_card_answered', card('expired', '2026-11-22T06:00:00Z')), 'warn');
  assertEquals(statusOf('wa_card_answered', { cardActionId: null }), 'na');
});

Deno.test('whatsapp scorecard › a reply that never reached WhatsApp fails', () => {
  assertEquals(statusOf('wa_delivered', { repliesSent: 1, repliesFailed: 1 }), 'fail');
  assertEquals(statusOf('wa_delivered', { repliesSent: 0 }), 'fail');
});

Deno.test('whatsapp scorecard › reply time limits differ for text and voice', () => {
  assertEquals(statusOf('wa_reply_time', { handleMs: 4_000 }), 'warn');
  assertEquals(statusOf('wa_reply_time', { handleMs: 7_000 }), 'fail');
  assertEquals(statusOf('wa_reply_time', { handleMs: 7_000, msgType: 'voice' }), 'pass');
});

Deno.test('whatsapp scorecard › a heard voice note with no voice reply is a warning', () => {
  const voice = { msgType: 'voice', inText: 'pending', cardActionId: null };
  assertEquals(statusOf('wa_voice_reply', voice), 'warn');
  assertEquals(statusOf('wa_voice_reply', { ...voice, voiceReply: true }), 'pass');
});

Deno.test('whatsapp scorecard › cost estimate and the health score', () => {
  assertEquals(exchangeCost(fakeExchange({ path: 'sarvam' })), 0.02);
  assertEquals(exchangeCost(fakeExchange({ msgType: 'voice', voiceReply: true })), 1.26);
  const score = exchangeScore(fakeExchange(), NOW);
  assertEquals([score.agent, score.verdict, score.replyP50Ms], ['whatsapp', 'good', 900]);
});
