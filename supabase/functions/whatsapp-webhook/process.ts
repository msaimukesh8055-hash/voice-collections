// supabase/functions/whatsapp-webhook/process.ts
// Background work for one webhook delivery (runs after Meta already has its 200):
//   stranger → one "not registered" reply per number per day; nothing else read or written
//   owner    → record the message id (a retry stops here) → load the book → route → send →
//              mark which path answered it.
// Logs carry a short sender-hash prefix, the message type, path and timing: never the number,
// never the text. Errors go through describeFailure: database operation + code, or the error's
// name only, never its message (CP2 L1).
import type { BrainLlm } from '../_shared/brain/llm.ts';
import type { BotContext, MunshiLinkDeps, WebDeps } from '../_shared/cards/context.ts';
import { istDate, resolveNow } from '../_shared/clock.ts';
import type { BookRepository } from '../_shared/db/book-repository.ts';
import type { DemoSettings } from '../_shared/db/repository.ts';
import type { Logger } from '../_shared/log.ts';
import type { ReminderDeps } from '../_shared/reminders/deps.ts';
import { DAILY_VOICE_CAP, hear, type HearDeps } from '../_shared/speech/hear.ts';
import type { Speaker } from '../_shared/speech/tts.ts';
import type { Upload } from '../_shared/whatsapp/media.ts';
import { spokenText } from '../_shared/whatsapp/spoken.ts';
import type { SpokenSummarizer } from '../_shared/whatsapp/spoken-summary.ts';
import type { Language } from '../_shared/schemas/shopkeeper.ts';
import { describeFailure } from '../_shared/tools/registry.ts';
import type { WhatsAppClient } from '../_shared/whatsapp/client.ts';
import {
  extractMessages,
  type InboundMessage,
  type WebhookPayload,
} from '../_shared/whatsapp/inbound.ts';
import { NOT_REGISTERED, phrasesFor } from '../_shared/whatsapp/phrases.ts';
import { type Reply, textReply } from '../_shared/whatsapp/replies.ts';
import { identifySender, maskedHash, type SenderConfig } from '../_shared/whatsapp/sender.ts';
import { type Outcome, routeMessage } from './route.ts';

export interface ProcessDeps {
  readonly book: BookRepository;
  readonly client: WhatsAppClient;
  readonly llm: BrainLlm;
  readonly sender: SenderConfig;
  readonly phoneNumberId: string;
  readonly clock: () => Date;
  readonly getDemoSettings: () => Promise<DemoSettings>;
  readonly newPhone: () => string;
  readonly log: Logger;
  /** Due alert, reminders and simulated calls (M5 5b). */
  readonly reminder: ReminderDeps;
  /** Voice notes (M6): Meta download and Saaras; the daily count is added per delivery. */
  readonly listen: Pick<HearDeps, 'download' | 'transcribe'>;
  /** Insights chart upload and the dashboard link (M6). */
  readonly web: WebDeps;
  /** "📞 Call Munshi" (M8): owner call rows and the signed link. */
  readonly munshi: MunshiLinkDeps;
  /** Voice replies (M6): Bulbul, then upload to Meta. M7: the words come from the spoken
   * summary (sarvam-105b, checked), falling back to spokenText. */
  readonly voice: {
    readonly summarize: SpokenSummarizer;
    readonly speak: Speaker;
    readonly upload: (file: Upload) => Promise<string | null>;
  };
  /** Asks the worker to sweep (follow-ups, queued simulated calls): the fallback if pg_cron is
   * not running (M5 risk table). Fire and forget. */
  readonly wakeWorker: () => void;
}

interface Delivery {
  readonly message: InboundMessage;
  readonly senderHash: string;
  readonly istDay: string;
}

async function sendAll(
  delivery: Delivery,
  replies: readonly Reply[],
  deps: ProcessDeps,
): Promise<void> {
  for (const reply of replies) {
    const waMessageId = await deps.client.send(delivery.message.from, reply);
    await deps.book.recordOutbound({
      waMessageId,
      senderHash: delivery.senderHash,
      msgType: reply.kind,
      istDay: delivery.istDay,
    }).catch((error: unknown) =>
      deps.log('warn', 'outbound_log_failed', { error: describeFailure(error) })
    );
  }
}

/** The summary never throws by design; if it ever did, the flat version is still correct. */
async function wordsToSpeak(
  outcome: Outcome & { speakIn: Language },
  deps: ProcessDeps,
): Promise<string> {
  const input = {
    replies: outcome.replies,
    language: outcome.speakIn,
    names: outcome.speakNames ?? [],
  };
  try {
    return await deps.voice.summarize(input);
  } catch (error) {
    deps.log('warn', 'spoken_summary_failed', { error: describeFailure(error) });
    return spokenText(outcome.replies, outcome.speakIn);
  }
}

/** Voice replies sent per India day (M6 Decision 10). */
export const DAILY_VOICE_REPLY_CAP = 50;

/** After a heard voice note, the same answer as a short voice note. Best effort: the text has
 * already gone, so any failure here is logged and nothing else happens. */
async function sendVoiceReply(
  delivery: Delivery,
  outcome: Outcome & { speakIn: Language },
  deps: ProcessDeps,
): Promise<void> {
  const language = outcome.speakIn;
  const sentToday = await deps.book.countMessages({
    direction: 'out',
    msgType: 'audio',
    istDay: delivery.istDay,
    max: DAILY_VOICE_REPLY_CAP,
  });
  if (sentToday >= DAILY_VOICE_REPLY_CAP) {
    deps.log('info', 'voice_reply_cap', { sent: sentToday });
    return;
  }
  // Nothing to say ('') gives no audio: the speaker returns null without calling Bulbul.
  const mp3 = await deps.voice.speak(await wordsToSpeak(outcome, deps), language);
  if (!mp3) return;
  const mediaId = await deps.voice.upload({
    bytes: mp3,
    mimeType: 'audio/mpeg',
    fileName: 'reply.mp3',
  });
  if (mediaId) await sendAll(delivery, [{ kind: 'audio', mediaId }], deps);
}

async function replyToStranger(delivery: Delivery, deps: ProcessDeps): Promise<void> {
  const firstToday = await deps.book.claimStrangerReply(delivery.senderHash, delivery.istDay);
  deps.log('info', 'whatsapp_stranger', {
    sender: maskedHash(delivery.senderHash),
    replied: firstToday,
  });
  if (firstToday) await deps.client.send(delivery.message.from, textReply(NOT_REGISTERED));
}

async function loadContext(deps: ProcessDeps): Promise<{ ctx: BotContext; demoNow: Date } | null> {
  const [owner, settings] = await Promise.all([deps.book.getOwner(), deps.getDemoSettings()]);
  if (!owner) return null;
  const now = deps.clock();
  const demoNow = resolveNow(settings.demoClock, now);
  const shopkeepers = await deps.book.listShopkeepers(owner.id);
  const ctx: BotContext = {
    book: deps.book,
    owner,
    shopkeepers,
    today: istDate(demoNow),
    now,
    language: owner.language,
    newPhone: deps.newPhone,
    log: deps.log,
    reminder: deps.reminder,
    web: deps.web,
    munshi: deps.munshi,
  };
  return { ctx, demoNow };
}

/** Today's voice notes, this one included (it was recorded before it is handled). */
function voiceNotesToday(delivery: Delivery, deps: ProcessDeps): () => Promise<number> {
  return () =>
    deps.book.countMessages({
      direction: 'in',
      msgType: 'voice',
      istDay: delivery.istDay,
      max: DAILY_VOICE_CAP + 1,
    });
}

async function answerOwner(delivery: Delivery, deps: ProcessDeps): Promise<Outcome> {
  const loaded = await loadContext(deps);
  if (!loaded) throw new Error('no owner row');
  try {
    return await routeMessage(delivery.message, loaded.ctx, {
      llm: deps.llm,
      demoNow: loaded.demoNow,
      hear: (mediaId) =>
        hear(mediaId, { ...deps.listen, countToday: voiceNotesToday(delivery, deps) }),
    });
  } catch (error) {
    deps.log('error', 'whatsapp_route_failed', { error: describeFailure(error) });
    return {
      replies: [textReply(phrasesFor(loaded.ctx.owner.language).somethingWrong)],
      path: 'failed',
      command: 'error',
    };
  }
}

async function handleOwner(delivery: Delivery, deps: ProcessDeps): Promise<void> {
  const started = Date.now();
  const { message, senderHash, istDay } = delivery;
  const fresh = await deps.book.recordInbound({
    waMessageId: message.id,
    senderHash,
    msgType: message.kind,
    istDay,
  });
  if (!fresh) {
    deps.log('info', 'whatsapp_duplicate', { sender: maskedHash(senderHash) });
    return;
  }
  const outcome = await answerOwner(delivery, deps);
  await sendAll(delivery, outcome.replies, deps);
  if (outcome.speakIn) {
    const voiced = { ...outcome, speakIn: outcome.speakIn };
    await sendVoiceReply(delivery, voiced, deps).catch((error: unknown) =>
      deps.log('warn', 'voice_reply_failed', { error: describeFailure(error) })
    );
  }
  await deps.book.markInboundHandled(message.id, { path: outcome.path, command: outcome.command });
  deps.wakeWorker();
  deps.log('info', 'whatsapp_message', {
    sender: maskedHash(senderHash),
    type: message.kind,
    path: outcome.path,
    command: outcome.command,
    replies: outcome.replies.length,
    ms: Date.now() - started,
  });
}

export async function processMessage(message: InboundMessage, deps: ProcessDeps): Promise<void> {
  const sender = await identifySender(message.from, deps.sender);
  const delivery = { message, senderHash: sender.senderHash, istDay: istDate(deps.clock()) };
  try {
    await (sender.isOwner ? handleOwner(delivery, deps) : replyToStranger(delivery, deps));
  } catch (error) {
    deps.log('error', 'whatsapp_process_failed', {
      sender: maskedHash(sender.senderHash),
      error: describeFailure(error),
    });
  }
}

/** Messages in one delivery are handled in order (a tap after its card). */
export async function processPayload(payload: WebhookPayload, deps: ProcessDeps): Promise<void> {
  for (const message of extractMessages(payload, deps.phoneNumberId)) {
    await processMessage(message, deps);
  }
}
