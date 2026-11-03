// supabase/functions/_shared/db/reminder-repository.ts
// Data access for M5 half 5b: the due alert (promises across the book, the daily alert log, the
// owner's last message for WhatsApp's 24-hour window), the reminder queue (recent calls, paused
// and do-not-call shopkeepers, calls created in one insert) and simulated calls (claimed under
// the 4-at-once limit inside the database, finished with their transcript). Kept apart from the
// other repositories so each stays small.
import type { AlertPromise } from '../ledger/due-alert.ts';
import type { Turn } from '../sarvam-analytics.ts';
import type { NewCall } from './repository.ts';

export interface RecentCall {
  readonly shopkeeperId: string;
  /** Real time (database now()), ISO. */
  readonly queuedAt: string;
}

export interface CreatedCall {
  readonly callId: string;
  readonly shopkeeperId: string;
}

export interface SimulatedCallEnd {
  readonly transcript: readonly Turn[];
  readonly endedAt: Date;
  readonly durationSeconds: number;
}

export type AlertKind = 'full' | 'template';

export interface DailyAlertClaim {
  readonly ownerId: string;
  /** India date on the demo clock: one alert per demo day. */
  readonly day: string;
  readonly kind: AlertKind;
}

export interface ReminderRepository {
  /** Every open promise, plus every promise dated on or after `since` (India date). */
  listAlertPromises(ownerId: string, since: string): Promise<readonly AlertPromise[]>;
  /** Calls queued since `since` (any status), for "called in the last hour" and attempt limits. */
  listCallsSince(since: Date): Promise<readonly RecentCall[]>;
  /** Shopkeepers with an open pause_reminders follow-up (skipped by "remind all"). */
  listPausedShopkeepers(): Promise<readonly string[]>;
  listDoNotCall(ownerId: string): Promise<readonly string[]>;
  /** One insert for the whole batch; returns each new call's id. */
  createCalls(calls: readonly NewCall[]): Promise<readonly CreatedCall[]>;
  /** Atomically (database lock): queued → in_progress for the oldest queued simulated call,
   * only while fewer than `maxRunning` simulated calls started after `staleBefore` are running.
   * Null when no slot or no queued call. */
  claimSimulatedCall(maxRunning: number, staleBefore: Date): Promise<string | null>;
  /** Simulated calls still in progress from before `staleBefore` (their run died): ended, and
   * queued for a follow-up from tool events. Returns their ids. */
  endStaleSimulatedCalls(staleBefore: Date, now: Date): Promise<readonly string[]>;
  /** Compare-and-set from in_progress: completed, transcript saved, follow-up pending. */
  finishSimulatedCall(callId: string, end: SimulatedCallEnd): Promise<boolean>;
  /** The seeded persona the simulated shopkeeper plays (SPEC §7.7), or null. */
  getPersona(shopkeeperId: string): Promise<string | null>;
  /** False when today's alert was already sent (one per owner per demo day). */
  claimDailyAlert(claim: DailyAlertClaim): Promise<boolean>;
  /** When the owner last wrote to the bot (real time, ISO), or null. */
  lastInboundAt(senderHash: string): Promise<string | null>;
}
