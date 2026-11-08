// supabase/functions/_shared/owner-tools/types.ts
// Munshi's tool contract (M8, ADR-0018): the same reply shape as Asha's tools ({ok, say, ...data},
// Sarvam passes only `say` to the LLM), its own context (the owner and his owner call, never a
// shopkeeper call) and its own refusal lines, worded for talking to the owner. Refusals carry no
// figures. Build B: the write side (voice actions, ledger writes, Remind, the WhatsApp send kick)
// and the action refusal codes.
// ⚠️ The refusal lines are what the LLM reads: drafts for Saim.
import type { QueueCallResult } from '../calls/queue-call.ts';
import type { BookRepository, Owner } from '../db/book-repository.ts';
import type { OwnerCall } from '../db/owner-call-repository.ts';
import type { VoiceActionRepository } from '../db/voice-action-repository.ts';
import type { ReminderRepository } from '../db/reminder-repository.ts';
import type { Repository } from '../db/repository.ts';
import type { ScoreReads } from '../reminders/score-explain.ts';
import type { ToolData, ToolOutcome } from '../tools/types.ts';

/** What the read tools may read: the book, promises, past calls and call results. */
export interface OwnerReads {
  readonly book: Pick<BookRepository, 'listShopkeepers' | 'listEntries' | 'listShopkeeperEntries'>;
  readonly memory: Pick<Repository, 'listPromises' | 'listPastCalls'>;
  readonly alerts: Pick<ReminderRepository, 'listAlertPromises'>;
  readonly listCallStatuses: ScoreReads['listCallStatuses'];
}

/** What confirm_action may change (Build B), and the voice actions prepare tools write. */
export interface OwnerWrites {
  readonly actions: VoiceActionRepository;
  readonly book: Pick<BookRepository, 'insertEntry' | 'settleClaim' | 'reverseEntry'>;
  /** queueCall({mode: 'live'}) with every pre-call rule (calls/queue-call.ts). */
  readonly queueCall: (shopkeeperId: string) => Promise<QueueCallResult>;
  /** Wakes the follow-up worker's /owner-send/<actionId> job in the background (never awaited:
   * the tool answers at once, M8 Decision 3). */
  readonly kickOwnerSend: (actionId: string) => void;
}

export interface OwnerToolContext {
  readonly reads: OwnerReads;
  readonly writes: OwnerWrites;
  /** The owner the owner call belongs to (checked against the call row). */
  readonly owner: Owner;
  readonly ownerCall: OwnerCall;
  /** India date on the demo clock. */
  readonly today: string;
  /** Real time of this tool call: the 2-second and 3-minute action rules (never the demo
   * clock, so moving it cannot open or close the confirm gate). */
  readonly realNow: Date;
}

export const OWNER_TOOL_ERRORS = {
  CALL_NOT_AUTHORISED:
    'This call is not authorised. Share nothing from the book. Say the link has run out and he ' +
    'can tap Call Munshi on WhatsApp again, then end the call.',
  INVALID_ARGS: 'The tool arguments were invalid.',
  UNKNOWN_TOOL: 'This tool does not exist. Carry on without it.',
  TEMPORARY_ERROR:
    "Something went wrong on our side. Say no figures; tell him you can't check the book right " +
    'now and to ask again in a minute.',
  NOT_FOUND:
    'Nobody by that name is in the book. Ask him to say the name or the shop name again. New ' +
    'people are added on WhatsApp.',
  NO_OPEN_ACTION: 'No change is waiting for his yes, so nothing was changed. If he wants a ' +
    'change, call the matching prepare tool and read it back first.',
  WRONG_REF: 'That is not the latest change, so nothing was changed. Read the latest change ' +
    'back to him again and ask "correct?".',
  ACTION_EXPIRED: 'That change waited too long and was dropped; nothing was changed. Call the ' +
    'prepare tool again and read it back.',
  TOO_SOON: 'He has not answered the read-back yet, so nothing was changed and that change was ' +
    'dropped. Call the prepare tool again, read it back, ask "correct?" and wait for his answer.',
  ALREADY_DONE: 'That change is already done. Do not do it again; tell him it is done.',
  NOTHING_TO_DELETE: 'No live entry of his matches that, so nothing was changed. Ask him which ' +
    'entry: the amount or the date.',
  NO_OPEN_CLAIM: 'He has no payment claim waiting, so nothing was changed.',
  CALL_BLOCKED: 'Asha cannot call him now, so no call was set up. Tell him simply.',
  AMOUNT_OUT_OF_RANGE: 'That amount cannot be right. Nothing was changed. Ask him for the ' +
    'amount again.',
  DATE_IN_PAST: 'That due date is already past. Nothing was changed. Ask him for a due date ' +
    'from today on.',
  NOTHING_OWED: 'He owes nothing right now, so there is nothing to mark paid.',
  BOOK_CHANGED: 'His balance changed since the read-back, so nothing was changed. Call the ' +
    'prepare tool again and read the new figures back.',
} as const satisfies Record<string, string>;

export type OwnerToolErrorCode = keyof typeof OWNER_TOOL_ERRORS;
export type OwnerToolOutcome = ToolOutcome<OwnerToolErrorCode>;

export function ownerOk(say: string, data: ToolData = {}): OwnerToolOutcome {
  return { result: { ok: true, say, data } };
}

/** `detail` replaces the default text when the reason is specific. */
export function ownerFail(code: OwnerToolErrorCode, detail?: string): OwnerToolOutcome {
  return { result: { ok: false, code, say: detail ?? OWNER_TOOL_ERRORS[code] } };
}
