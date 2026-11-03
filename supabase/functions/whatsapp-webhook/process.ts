// supabase/functions/whatsapp-webhook/process.ts
// Background work for one webhook delivery (runs after Meta already has its 200):
//   stranger → one "not registered" reply per number per day; nothing else read or written
//   owner    → record the message id (a retry stops here) → load the book → route → send →
//              mark which path answered it.
// Logs carry a short sender-hash prefix, the message type, path and timing: never the number,
// never the text.
import type { BrainLlm } from '../_shared/brain/llm.ts';
import type { BotContext } from '../_shared/cards/context.ts';
import { istDate, resolveNow } from '../_shared/clock.ts';
import type { BookRepository } from '../_shared/db/book-repository.ts';
import type { DemoSettings } from '../_shared/db/repository.ts';
import type { Logger } from '../_shared/log.ts';
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
}

interface Delivery {
  readonly message: InboundMessage;
  readonly senderHash: string;
  readonly istDay: string;
}

function errorName(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown';
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
      deps.log('warn', 'outbound_log_failed', { error: errorName(error) })
    );
  }
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
  };
  return { ctx, demoNow };
}

async function answerOwner(delivery: Delivery, deps: ProcessDeps): Promise<Outcome> {
  const loaded = await loadContext(deps);
  if (!loaded) throw new Error('no owner row');
  try {
    return await routeMessage(delivery.message, loaded.ctx, {
      llm: deps.llm,
      demoNow: loaded.demoNow,
    });
  } catch (error) {
    deps.log('error', 'whatsapp_route_failed', { error: errorName(error) });
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
  await deps.book.markInboundHandled(message.id, { path: outcome.path, command: outcome.command });
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
      error: errorName(error),
    });
  }
}

/** Messages in one delivery are handled in order (a tap after its card). */
export async function processPayload(payload: WebhookPayload, deps: ProcessDeps): Promise<void> {
  for (const message of extractMessages(payload, deps.phoneNumberId)) {
    await processMessage(message, deps);
  }
}
