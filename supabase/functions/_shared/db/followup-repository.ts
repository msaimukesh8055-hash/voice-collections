// supabase/functions/_shared/db/followup-repository.ts
// Data access for the follow-up worker (M5 Decisions 4, 5, 9): the call's follow-up state
// (pending → running → done / failed), what the call recorded, and the worker's outputs (run,
// note, follow-up row, score). Kept apart from Repository (Asha's tools) and BookRepository (the
// owner's bot) so each stays small. "A call is followed up once" is enforced twice: claiming is a
// compare-and-set on the call row, and followup_runs allows one row per call.
import type { ToneLevel } from '../calls/tone.ts';
import type { CallbackRequest, ClaimRecord } from '../followup/facts.ts';
import type { Score } from '../ledger/score.ts';
import type { Turn } from '../sarvam-analytics.ts';
import type { CallStatus, IdentityStatus } from '../schemas/shopkeeper.ts';
import type { CallMode, SavedPromise } from './repository.ts';

export const FOLLOWUP_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

export const FOLLOWUP_KINDS = [
  'owner_callback',
  'promise_check',
  'remind_again',
  'claim_confirm',
  'pause_reminders',
] as const;
export type FollowupKind = (typeof FOLLOWUP_KINDS)[number];

export interface FollowupCall {
  readonly callId: string;
  readonly shopkeeperId: string;
  readonly mode: CallMode;
  readonly status: CallStatus;
  readonly identityStatus: IdentityStatus;
  readonly toneLevel: ToneLevel;
  readonly interactionId: string | null;
  /** Stored transcript (simulated calls arrive with one). */
  readonly transcript: readonly Turn[] | null;
  readonly queuedAt: string;
  readonly acceptedAt: string | null;
  readonly endedAt: string | null;
  readonly followupStatus: FollowupStatus | null;
  readonly followupAttempts: number;
  readonly followupNextAt: string | null;
  readonly followupClaimedAt: string | null;
}

export interface CallOutcome {
  readonly promise: SavedPromise | null;
  readonly claim: ClaimRecord | null;
  readonly callbacks: readonly CallbackRequest[];
}

export interface NewFollowupRun {
  readonly callId: string;
  readonly shopkeeperId: string;
  readonly path: 'rule' | 'agent';
  readonly decision: string;
  readonly reasoning: string;
  readonly actions: Readonly<Record<string, string | number | boolean | null | readonly string[]>>;
}

export interface NewNote {
  readonly callId: string;
  readonly shopkeeperId: string;
  readonly note: string;
}

export interface NewFollowup {
  readonly callId: string;
  readonly shopkeeperId: string;
  readonly kind: FollowupKind;
  readonly reason: string;
  readonly scheduledFor: string | null;
}

export interface FinishedFollowup {
  readonly transcript: readonly Turn[] | null;
  readonly summary: string | null;
  /** Set only when the worker found the id itself (the phone page never reported it). */
  readonly interactionId: string | null;
}

export interface FollowupRepository {
  getFollowupCall(callId: string): Promise<FollowupCall | null>;
  /** Compare-and-set: pending (and due) or stale running → running, attempts + 1. False when
   * another worker got there first or the attempts moved on. */
  claimFollowup(call: FollowupCall, now: Date): Promise<boolean>;
  /** Back to pending, to be tried again at `nextAt` (transcript not ready yet, or an error). */
  releaseFollowup(callId: string, nextAt: Date): Promise<void>;
  failFollowup(callId: string): Promise<void>;
  finishFollowup(callId: string, result: FinishedFollowup): Promise<void>;
  /** Calls whose follow-up is due (pending and due, or running but stale), oldest first. */
  listDueFollowups(now: Date, limit: number): Promise<readonly string[]>;
  getCallOutcome(callId: string): Promise<CallOutcome>;
  /** Statuses of the shopkeeper's calls, for the "answers calls" part of the score. */
  listCallStatuses(shopkeeperId: string): Promise<readonly CallStatus[]>;
  /** False when this call already has a run (database rule: one per call). */
  insertFollowupRun(run: NewFollowupRun): Promise<boolean>;
  /** False when this call already has a note. */
  insertNote(note: NewNote): Promise<boolean>;
  insertFollowup(followup: NewFollowup): Promise<void>;
  saveScore(shopkeeperId: string, score: Score, at: Date): Promise<void>;
}

/** A running claim older than this is taken over (the worker that held it died). */
export const STALE_CLAIM_MS = 5 * 60 * 1000;

export function staleBefore(now: Date): Date {
  return new Date(now.getTime() - STALE_CLAIM_MS);
}
