// supabase/functions/_shared/reminders/daily-alert.ts
// The daily due alert (SPEC §6.4, M5 Decision 7), run by pg_cron through the worker at 9:00 IST.
// Content uses the demo-clock date; one alert per owner per demo day (owner_alerts, unique), so a
// retried cron call never sends twice. WhatsApp's 24-hour rule: if the owner wrote to the bot in
// the last 24 hours (minus a safety margin) he gets the full alert with Remind buttons; otherwise
// only the approved template ("7 shopkeepers are due today. Reply DUE to see them."). His reply
// "DUE" opens the window and gets the full alert. Nobody due → nothing is sent.
import { istDate, resolveNow } from '../clock.ts';
import type { BookRepository } from '../db/book-repository.ts';
import type { ReminderRepository } from '../db/reminder-repository.ts';
import type { Repository } from '../db/repository.ts';
import type { Logger } from '../log.ts';
import type { WhatsAppClient } from '../whatsapp/client.ts';
import type { Reply } from '../whatsapp/replies.ts';
import { identifySender, type SenderConfig } from '../whatsapp/sender.ts';
import { dailyAlertTemplate, dueAlertReplies } from './alert-replies.ts';
import { loadDueAlert } from './load-alert.ts';

/** WhatsApp's customer-service window, less a margin so a send never lands just after it. */
export const FREE_WINDOW_MS = 24 * 60 * 60 * 1000 - 15 * 60 * 1000;

export interface DailyAlertDeps {
  readonly book: BookRepository;
  readonly store: ReminderRepository;
  readonly repo: Repository;
  readonly whatsapp: WhatsAppClient;
  readonly owner: SenderConfig;
  readonly clock: () => Date;
  readonly log: Logger;
}

export type DailyAlertOutcome =
  | 'sent_full'
  | 'sent_template'
  | 'already_sent'
  | 'nobody_due'
  | 'no_owner';

export function isInsideWindow(lastInboundAt: string | null, now: Date): boolean {
  return lastInboundAt !== null && now.getTime() - Date.parse(lastInboundAt) < FREE_WINDOW_MS;
}

async function send(
  replies: readonly Reply[],
  context: { senderHash: string; day: string },
  deps: DailyAlertDeps,
): Promise<void> {
  for (const reply of replies) {
    const waMessageId = await deps.whatsapp.send(deps.owner.ownerNumber, reply);
    await deps.book.recordOutbound({
      waMessageId,
      senderHash: context.senderHash,
      msgType: reply.kind,
      istDay: context.day,
    });
  }
}

export async function sendDailyAlert(deps: DailyAlertDeps): Promise<DailyAlertOutcome> {
  const [owner, settings] = await Promise.all([deps.book.getOwner(), deps.repo.getDemoSettings()]);
  if (!owner) return 'no_owner';
  const now = deps.clock();
  const today = istDate(resolveNow(settings.demoClock, now));
  const shopkeepers = await deps.book.listShopkeepers(owner.id);
  const { alert } = await loadDueAlert(deps, { ownerId: owner.id, shopkeepers, today });
  if (alert.people.length === 0) return 'nobody_due';
  const { senderHash } = await identifySender(deps.owner.ownerNumber, deps.owner);
  const inside = isInsideWindow(await deps.store.lastInboundAt(senderHash), now);
  const kind = inside ? 'full' : 'template';
  if (!(await deps.store.claimDailyAlert({ ownerId: owner.id, day: today, kind }))) {
    return 'already_sent';
  }
  const replies = inside
    ? dueAlertReplies(alert, today, owner.language)
    : [dailyAlertTemplate(alert.people.length)];
  await send(replies, { senderHash, day: istDate(now) }, deps);
  deps.log('info', 'daily_alert_sent', { kind, people: alert.people.length });
  return inside ? 'sent_full' : 'sent_template';
}
