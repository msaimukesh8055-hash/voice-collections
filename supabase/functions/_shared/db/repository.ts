// supabase/functions/_shared/db/repository.ts
// Data access contract. Tools and handlers depend on this interface, never on Supabase directly,
// so tests run against the in-memory fake. Latency rule: a tool does at most one round of reads
// (run in parallel) and one write.
import type { ToneLevel } from '../calls/tone.ts';
import type { PromiseRecord } from '../ledger/promise-check.ts';
import type { LedgerEntry, PaymentMode } from '../schemas/ledger.ts';
import type { CallStatus, IdentityStatus, Language } from '../schemas/shopkeeper.ts';

export interface Shopkeeper {
  readonly id: string;
  readonly name: string;
  readonly shopName: string;
  readonly language: Language;
  readonly doNotCall: boolean;
  readonly ownerName: string;
  readonly businessName: string;
  /** The owner's level-3 consequence (SPEC §7.4); null when he set none. */
  readonly consequenceText: string | null;
}

export interface DemoSettings {
  readonly demoClock: string | null;
  readonly callingHoursEnabled: boolean;
  readonly callLimitsEnabled: boolean;
  /** Who the dashboard's "Ring" demo button calls. WhatsApp's Remind can ring anyone live
   * (Live remind, pre-M6), so this no longer decides who is live. */
  readonly liveShopkeeperId: string | null;
}

export type CallMode = 'live' | 'simulated';

/** A safety cap, not a page: only a handful of live calls are ever open at once. */
export const OPEN_LIVE_CALLS_LIMIT = 20;

/** Everything the server knows about a call; the shopkeeper comes from the call token only. */
export interface CallSession {
  readonly callId: string;
  readonly shopkeeperId: string;
  readonly mode: CallMode;
  readonly status: CallStatus;
  readonly language: Language;
  readonly identityStatus: IdentityStatus;
  readonly identityUnsureCount: number;
  readonly interactionId: string | null;
  readonly queuedAt: string;
  readonly ringingAt: string | null;
  readonly acceptedAt: string | null;
  readonly urlIssuedAt: string | null;
}

export interface NewCall {
  readonly shopkeeperId: string;
  readonly language: Language;
  readonly mode: CallMode;
}

/** Fields a status change may set. Timestamps are ISO strings. */
export interface CallPatch {
  readonly status: CallStatus;
  readonly ringingAt?: string;
  readonly acceptedAt?: string;
  readonly urlIssuedAt?: string;
  readonly endedAt?: string;
  readonly durationSeconds?: number;
  readonly interactionId?: string;
  /** Set when the call has ended (completed, declined, missed): the follow-up worker's queue. */
  readonly followupStatus?: 'pending';
  readonly followupNextAt?: string;
}

export interface Identity {
  readonly status: IdentityStatus;
  readonly unsureCount: number;
}

export interface SavedPromise {
  readonly amount: number;
  readonly promiseDate: string;
}

export interface NewPromise extends SavedPromise {
  readonly callId: string;
  readonly shopkeeperId: string;
}

export interface SavedClaim {
  readonly amount: number;
  readonly paidDate: string;
  readonly mode: PaymentMode;
}

export interface NewClaim extends SavedClaim {
  readonly callId: string;
  readonly shopkeeperId: string;
}

export interface NewOwnerCallback {
  readonly callId: string;
  readonly shopkeeperId: string;
  readonly reason: string;
  readonly summary: string;
}

export interface NewToolEvent {
  readonly callId: string;
  readonly tool: string;
  readonly args: unknown;
  readonly result: unknown;
  readonly durationMs: number;
}

export interface Repository {
  getDemoSettings(): Promise<DemoSettings>;
  getShopkeeper(shopkeeperId: string): Promise<Shopkeeper | null>;
  countCallsSince(shopkeeperId: string, since: Date): Promise<number>;
  /** Calls (any shopkeeper) whose Sarvam call URL was issued at or after `since` (CP2 M3). */
  countCallUrlsIssuedSince(since: Date): Promise<number>;
  createCall(call: NewCall): Promise<string>;
  getCallSession(callId: string): Promise<CallSession | null>;
  /** The shopkeeper's newest call that is still queued or ringing. */
  findRingingCall(shopkeeperId: string): Promise<CallSession | null>;
  /** The newest live calls still open (queued, ringing, accepted, in progress), for anyone:
   * the phone page's line. At most OPEN_LIVE_CALLS_LIMIT, newest first. */
  listOpenLiveCalls(): Promise<readonly CallSession[]>;
  /** Compare-and-set: applies the patch only while the call is in one of `from`, so two
   * requests cannot both accept, or both get a call URL; false when another got there first. */
  transitionCall(callId: string, from: readonly CallStatus[], patch: CallPatch): Promise<boolean>;
  /** Compare-and-set on the identity fields, for the same reason. */
  recordIdentity(callId: string, expected: Identity, next: Identity): Promise<boolean>;
  getLedger(shopkeeperId: string): Promise<readonly LedgerEntry[]>;
  getPromiseForCall(callId: string): Promise<SavedPromise | null>;
  /** False when the call already has a promise (database rule: one per call). */
  insertPromise(promise: NewPromise): Promise<boolean>;
  /** Replaces the call's promise with the latest terms; false when the call has none. */
  updatePromiseForCall(callId: string, promise: SavedPromise): Promise<boolean>;
  getClaimForCall(callId: string): Promise<SavedClaim | null>;
  /** Saves a 'claimed' payment; false when the call already has one. */
  insertPaymentClaim(claim: NewClaim): Promise<boolean>;
  insertOwnerCallback(callback: NewOwnerCallback): Promise<void>;
  insertToolEvent(event: NewToolEvent): Promise<void>;
  // Memory and tone (M5): read in get_dues's one round of reads, written in its one round of
  // writes.
  /** The shopkeeper's promises, newest first. */
  listPromises(shopkeeperId: string): Promise<readonly PromiseRecord[]>;
  /** The newest follow-up note, or null. */
  getLastNote(shopkeeperId: string): Promise<string | null>;
  /** Compare-and-set from 'open', so running the promise check twice changes nothing. */
  setPromiseStatus(promiseId: string, status: 'kept' | 'broken'): Promise<boolean>;
  setCallToneLevel(callId: string, level: ToneLevel): Promise<void>;
}
