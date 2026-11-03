// supabase/functions/_shared/followup/facts.ts
// What one finished call left behind, gathered once by the worker and read by the rules, the
// agent, the note writer and the summary. Everything here comes from our own rows (call, promise,
// claim, callback requests) and the transcript; the shopkeeper comes from the call, never the LLM.
import type { ToneLevel } from '../calls/tone.ts';
import type { CallMode, SavedPromise } from '../db/repository.ts';
import type { Turn } from '../sarvam-analytics.ts';
import type { PaymentMode } from '../schemas/ledger.ts';
import type { IdentityStatus } from '../schemas/shopkeeper.ts';
import type { CALLBACK_REASONS } from '../tools/schemas.ts';

export type CallbackReason = (typeof CALLBACK_REASONS)[number];

export interface CallbackRequest {
  readonly reason: CallbackReason;
  /** Asha's one-line summary for the owner (English). */
  readonly summary: string;
}

export interface ClaimRecord {
  /** The 'claimed' ledger entry: the owner's [Confirm received] / [Not received] act on it. */
  readonly entryId: string;
  readonly amount: number;
  readonly paidDate: string;
  readonly mode: PaymentMode;
}

export interface CallFacts {
  readonly callId: string;
  readonly shopkeeperId: string;
  readonly shopkeeperName: string;
  readonly shopName: string;
  readonly mode: CallMode;
  /** False when the call was declined or never answered. */
  readonly connected: boolean;
  readonly declined: boolean;
  readonly identity: IdentityStatus;
  readonly promise: SavedPromise | null;
  readonly claim: ClaimRecord | null;
  readonly callbacks: readonly CallbackRequest[];
  readonly toneLevel: ToneLevel;
  readonly daysOverdue: number;
  readonly brokenPromises: number;
  /** India date on the demo clock. */
  readonly today: string;
  /** Null when there is none (not connected, or it never arrived). */
  readonly transcript: readonly Turn[] | null;
  /** A connected live call whose transcript did not arrive within the wait (Decision 5). */
  readonly transcriptMissing: boolean;
}
