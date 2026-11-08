// supabase/functions/_shared/owner-tools/actions.ts
// The core of Munshi's two-step changes (M8 B1, ADR-0018, Decision 5). A prepare tool works out
// everything in code, stores ONE voice action for this owner call (3 minutes) with a short
// action_ref ("r1", "r2", …) and replies with the read-back. A new prepare cancels the open one,
// so at most one change waits for his yes. confirm_action (confirm-action.ts) runs it only after
// the gates. Each kind has its own Zod payload: what confirm reads back from the database is
// checked before any money moves. The rule constants live here, in one place.
import { z } from 'zod';
import { MAX_AMOUNT } from '../brain/amounts.ts';
import type { BookEntry, BookShopkeeper } from '../db/book-repository.ts';
import type { VoiceAction, VoiceActionKind } from '../db/voice-action-repository.ts';
import { computeDues, toPaise, toRupees } from '../ledger/dues.ts';
import { LEDGER_KINDS, type LedgerEntry } from '../schemas/ledger.ts';
import type { ToolData } from '../tools/types.ts';
import { type NameResolution, resolveName, unclearNameReply } from './names.ts';
import { askForYes } from './read-back.ts';
import { CLAIM_DECISIONS, SEND_WHATS } from './schemas.ts';
import { labelOf } from './say.ts';
import { ownerOk, type OwnerToolContext, type OwnerToolOutcome } from './types.ts';

/** A confirm this soon after its prepare had no owner reply in between: speaking the read-back
 * alone takes 3–8 s, so a prepare + confirm chained in one LLM turn is refused (M8-R1). */
export const MIN_CONFIRM_DELAY_MS = 2_000;
/** How long a read-back waits for his yes. */
export const VOICE_ACTION_TTL_MS = 3 * 60_000;
const REF_PREFIX = 'r';

const Amount = z.number().positive().max(MAX_AMOUNT);
const IsoDate = z.iso.date();
const Person = { shopkeeperId: z.uuid(), name: z.string().min(1) };

/** What each kind stores, checked again at confirm (LLM-output and database validation). */
export const VOICE_PAYLOADS = {
  voice_credit: z.object({ ...Person, amount: Amount, dueDate: IsoDate }),
  voice_payment: z.object({ ...Person, amount: Amount, full: z.boolean() }),
  voice_delete: z.object({
    ...Person,
    entryId: z.uuid(),
    kind: z.enum(LEDGER_KINDS),
    amount: Amount,
    entryDate: IsoDate,
  }),
  voice_remind: z.object(Person),
  voice_claim: z.object({
    ...Person,
    entryId: z.uuid(),
    amount: Amount,
    decision: z.enum(CLAIM_DECISIONS),
  }),
  voice_send: z.object({
    what: z.enum(SEND_WHATS),
    shopkeeperId: z.uuid().nullable(),
    name: z.string().min(1).nullable(),
  }),
} as const satisfies Record<VoiceActionKind, z.ZodType>;

export type VoicePayload<K extends VoiceActionKind> = z.infer<(typeof VOICE_PAYLOADS)[K]>;

/** The amount to store (to the paisa), or null when it is ≤ 0, above MAX_AMOUNT or not a
 * number: the tool then says AMOUNT_OUT_OF_RANGE and stores nothing. */
export function checkedAmount(amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;
  const rounded = toRupees(toPaise(amount));
  return rounded > 0 ? rounded : null;
}

/** "r1" for the first action of a call, "r2" for the next, … */
export function refFor(actionsSoFar: number): string {
  return `${REF_PREFIX}${actionsSoFar + 1}`;
}

/** "R1 " → "r1": the LLM may change the case or add spaces when it copies the ref. */
export function normaliseRef(ref: string): string {
  return ref.trim().toLowerCase();
}

/** The next action_ref of this call (read in parallel with the tool's own first round). Every
 * prepare also drops this call's open change here, before it knows whether it will store one:
 * a prepare that ends in choices, NOT_FOUND or a refusal must not leave an older read-back
 * confirmable (M8 Build B test finding; same round, so no extra latency). */
export async function nextRef(ctx: OwnerToolContext): Promise<string> {
  const { actions } = ctx.writes;
  const upTo = new Date(ctx.realNow.getTime() + 1).toISOString();
  const [count] = await Promise.all([
    actions.countVoiceActions(ctx.ownerCall.id),
    actions.cancelOpenVoiceActions(ctx.ownerCall.id, upTo),
  ]);
  return refFor(count);
}

export interface PreparedChange<K extends VoiceActionKind> {
  readonly kind: K;
  readonly payload: VoicePayload<K>;
  /** What Munshi reads back: person, amount, date and the balance after, in English. */
  readonly readBack: string;
  readonly data?: ToolData;
}

/** Stores the change (replacing this call's open one) and replies with the read-back. One round:
 * the insert and the cancel of older open actions run together; the cancel only touches actions
 * created before this one, so it can never cancel the new one. */
export async function storeAction<K extends VoiceActionKind>(
  change: PreparedChange<K>,
  ref: string,
  ctx: OwnerToolContext,
): Promise<OwnerToolOutcome> {
  const createdAt = ctx.realNow.toISOString();
  const expiresAt = new Date(ctx.realNow.getTime() + VOICE_ACTION_TTL_MS).toISOString();
  const { actions } = ctx.writes;
  await Promise.all([
    actions.createVoiceAction({
      ownerId: ctx.owner.id,
      ownerCallId: ctx.ownerCall.id,
      kind: change.kind,
      ref,
      data: change.payload,
      createdAt,
      expiresAt,
    }),
    actions.cancelOpenVoiceActions(ctx.ownerCall.id, createdAt),
  ]);
  return ownerOk(askForYes(change.readBack, ref), {
    ...change.data,
    action_ref: ref,
    kind: change.kind,
  });
}

export type FoundPerson =
  | {
    readonly ok: true;
    readonly shopkeeper: BookShopkeeper;
    /** "Ramesh", or "Praveen (Praveen Bakery)" when the name is shared. */
    readonly label: string;
    readonly ref: string;
  }
  | { readonly ok: false; readonly outcome: OwnerToolOutcome };

/** Round ① of a prepare: the spoken name (resolveName, shop words included) and the next ref,
 * in parallel. An unclear name gives choices and no figures; nothing is stored. */
export async function findPerson(ctx: OwnerToolContext, name: string): Promise<FoundPerson> {
  const [shopkeepers, ref] = await Promise.all([
    ctx.reads.book.listShopkeepers(ctx.owner.id),
    nextRef(ctx),
  ]);
  const resolution: NameResolution = resolveName(shopkeepers, name);
  if (resolution.kind !== 'one') return { ok: false, outcome: unclearNameReply(resolution) };
  const { shopkeeper } = resolution;
  return { ok: true, shopkeeper, label: labelOf(shopkeeper, shopkeepers), ref };
}

/** A what-if on his entries, for the read-back: the balance after the change (never stored). */
export type EntryChange = (entries: readonly BookEntry[]) => readonly LedgerEntry[];

/** His outstanding after a change (the same computeDues as WhatsApp and the reads). */
export function outstandingAfter(
  entries: readonly BookEntry[],
  today: string,
  change?: EntryChange,
): number {
  return computeDues(change ? change(entries) : entries, today).outstanding;
}

/** A confirmed entry of today added. */
export function wouldAdd(
  entry: Pick<LedgerEntry, 'kind' | 'amount' | 'dueDate'>,
  today: string,
): EntryChange {
  return (entries) => [...entries, { ...entry, entryDate: today, status: 'confirmed' }];
}

/** One entry's status changed (a reversal, a settled claim). */
export function withStatus(entryId: string, status: LedgerEntry['status']): EntryChange {
  return (entries) =>
    entries.map((entry): BookEntry => (entry.id === entryId ? { ...entry, status } : entry));
}

/** What confirm_action got from an executor. `refused`: nothing changed, the action is closed.
 * `lost`: another confirm of the same action won the compare-and-set (it did the write). */
export type Executed =
  | { readonly status: 'done'; readonly outcome: OwnerToolOutcome }
  | { readonly status: 'refused'; readonly outcome: OwnerToolOutcome }
  | { readonly status: 'lost' };

export interface ExecuteInput<P> {
  readonly payload: P;
  readonly action: VoiceAction;
  readonly ctx: OwnerToolContext;
  /** The compare-and-set open → saved. Run it before (or alongside a read before) any write. */
  readonly claim: () => Promise<boolean>;
}

export type Executor<P> = (input: ExecuteInput<P>) => Promise<Executed>;

export const LOST: Executed = { status: 'lost' };

export function done(outcome: OwnerToolOutcome): Executed {
  return { status: 'done', outcome };
}

export function refused(outcome: OwnerToolOutcome): Executed {
  return { status: 'refused', outcome };
}

/** The claim and a read in one round; the read's value only matters if the claim was won. */
export async function claimWith<T>(
  claim: () => Promise<boolean>,
  read: Promise<T>,
): Promise<{ readonly won: boolean; readonly value: T }> {
  const [won, value] = await Promise.all([claim(), read]);
  return { won, value };
}
