// supabase/functions/_shared/db/book-repository.ts
// Data access for the owner's WhatsApp bot (M4): the credit book, confirmation cards and the
// message log. Kept apart from Repository (Asha's call tools) so each side stays small. The
// owner's phone number never passes through here: senders are keyed hashes (Decision 6).
import type { LedgerEntry, PaymentMode, PromiseStatus } from '../schemas/ledger.ts';
import type { Language } from '../schemas/shopkeeper.ts';

export interface Owner {
  readonly id: string;
  readonly name: string;
  readonly businessName: string;
  readonly city: string;
  readonly language: Language;
  /** M6 demo setting: each Telugu bot message is followed by its English translation. */
  readonly englishUnderTelugu: boolean;
}

export interface BookShopkeeper {
  readonly id: string;
  readonly name: string;
  readonly shopName: string;
  readonly area: string;
  readonly language: Language;
}

export interface BookEntry extends LedgerEntry {
  readonly id: string;
  readonly shopkeeperId: string;
  readonly paymentMode: PaymentMode | null;
  readonly createdAt: string;
}

export { PROMISE_STATUSES, type PromiseStatus } from '../schemas/ledger.ts';

export interface LastPromise {
  readonly amount: number;
  readonly promiseDate: string;
  readonly status: PromiseStatus;
}

export interface NewShopkeeper {
  readonly ownerId: string;
  readonly name: string;
  readonly shopName: string;
  readonly area: string;
  readonly phone: string;
  readonly language: Language;
}

/** A confirmed entry the owner saved from a card (source 'text'). */
export interface NewEntry {
  readonly shopkeeperId: string;
  readonly kind: 'credit' | 'payment';
  readonly amount: number;
  readonly entryDate: string;
  /** Required for credits, null for payments (database rule). */
  readonly dueDate: string | null;
  readonly note: string | null;
}

/** remind_all (M5): "Call 7 people?" [Yes] [No], holding who will be called. */
export const ACTION_KINDS = ['entry', 'pick', 'new_shopkeeper', 'remind_all'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const ACTION_STATUSES = ['open', 'saved', 'cancelled', 'expired', 'done'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export interface PendingAction {
  readonly id: string;
  readonly kind: ActionKind;
  /** Checked against the card schemas by the caller. */
  readonly payload: unknown;
  readonly status: ActionStatus;
  readonly expiresAt: string;
}

export interface NewPendingAction {
  readonly ownerId: string;
  readonly kind: ActionKind;
  readonly payload: unknown;
  readonly expiresAt: string;
}

export const MESSAGE_PATHS = [
  'button',
  'command',
  'sarvam',
  'gemini',
  'failed',
  'stranger',
] as const;
export type MessagePath = (typeof MESSAGE_PATHS)[number];

export interface InboundRecord {
  readonly waMessageId: string;
  readonly senderHash: string;
  readonly msgType: string;
  readonly istDay: string;
}

export interface OutboundRecord {
  readonly waMessageId: string | null;
  readonly senderHash: string;
  readonly msgType: string;
  readonly istDay: string;
}

/** "How many voice notes today?" for the daily voice caps (M6 Decision 10). */
export interface MessageCount {
  readonly direction: 'in' | 'out';
  readonly msgType: string;
  readonly istDay: string;
  /** Counting stops here: the caller only needs to know whether the cap is reached. */
  readonly max: number;
}

export interface BookRepository {
  /** The prototype has one owner (Srinivas). */
  getOwner(): Promise<Owner | null>;
  listShopkeepers(ownerId: string): Promise<readonly BookShopkeeper[]>;
  /** Every entry of the owner's shopkeepers (all pages). */
  listEntries(ownerId: string): Promise<readonly BookEntry[]>;
  listShopkeeperEntries(shopkeeperId: string): Promise<readonly BookEntry[]>;
  getLastPromise(shopkeeperId: string): Promise<LastPromise | null>;
  insertShopkeeper(shopkeeper: NewShopkeeper): Promise<BookShopkeeper>;
  insertEntry(entry: NewEntry): Promise<string>;
  /** Compare-and-set from 'claimed': the settled entry, or null if it was not an open claim. */
  settleClaim(entryId: string, status: 'confirmed' | 'rejected'): Promise<BookEntry | null>;
  createPendingAction(action: NewPendingAction): Promise<string>;
  getPendingAction(actionId: string): Promise<PendingAction | null>;
  /** Compare-and-set: false when the card was no longer in `from` (a second tap). */
  transitionPendingAction(actionId: string, from: ActionStatus, to: ActionStatus): Promise<boolean>;
  /** False when this Meta message id was already recorded (a retry): handle once. */
  recordInbound(message: InboundRecord): Promise<boolean>;
  markInboundHandled(
    waMessageId: string,
    result: { path: MessagePath; command: string | null },
  ): Promise<void>;
  recordOutbound(message: OutboundRecord): Promise<void>;
  /** False when this sender already got today's "not registered" reply. */
  claimStrangerReply(senderHash: string, istDay: string): Promise<boolean>;
  /** Messages of one type and direction on one India day, counted up to `max`. */
  countMessages(count: MessageCount): Promise<number>;
}
