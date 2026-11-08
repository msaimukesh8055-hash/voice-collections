// supabase/functions/_shared/db/voice-action-repository.ts
// Munshi's spoken changes waiting for the owner's yes (M8 Build B, ADR-0018 "two-step in code").
// They live in pending_actions next to the WhatsApp cards, but always tied to one owner call
// (database rule: a voice kind has an owner_call_id). The short action_ref ("r1", "r2", …) the
// LLM copies back is kept inside the payload ({ref, data}), so no new column is needed.
// created_at is written by the function (not the database's now()), so the 2-second and
// 3-minute rules compare two times from the same clock.
import type { ActionStatus } from './book-repository.ts';

export const VOICE_ACTION_KINDS = [
  'voice_credit',
  'voice_payment',
  'voice_delete',
  'voice_remind',
  'voice_claim',
  'voice_send',
] as const;
export type VoiceActionKind = (typeof VOICE_ACTION_KINDS)[number];

export interface VoiceAction {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerCallId: string;
  readonly kind: VoiceActionKind;
  /** "r1", "r2", …: per owner call, in the order prepared. */
  readonly ref: string;
  /** Checked against the kind's payload schema by the caller (owner-tools/actions.ts). */
  readonly data: unknown;
  readonly status: ActionStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export type NewVoiceAction = Omit<VoiceAction, 'id' | 'status'>;

export interface VoiceActionRepository {
  /** How many voice actions this owner call has had (any status): the next ref is one more. */
  countVoiceActions(ownerCallId: string): Promise<number>;
  createVoiceAction(action: NewVoiceAction): Promise<string>;
  /** Every open action of this call created before `createdBefore` becomes cancelled (a new
   * prepare replaces the open one). Returns how many were cancelled. */
  cancelOpenVoiceActions(ownerCallId: string, createdBefore: string): Promise<number>;
  /** The newest two voice actions of this call (newest first), whatever their status. Two, so
   * confirm can see when two prepares that ran at once got the same ref (M8 Build B test). */
  latestVoiceActions(ownerCallId: string): Promise<readonly VoiceAction[]>;
  /** One voice action by id (the worker's /owner-send job); null for a WhatsApp card id. */
  getVoiceAction(actionId: string): Promise<VoiceAction | null>;
  /** Compare-and-set: false when the action was no longer in `from` (a second confirm). */
  transitionVoiceAction(actionId: string, from: ActionStatus, to: ActionStatus): Promise<boolean>;
}
