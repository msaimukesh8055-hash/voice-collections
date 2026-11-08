// supabase/functions/_shared/db/owner-call-repository.ts
// Data access for Munshi's owner calls (M8, ADR-0018): the single-use link rows and Munshi's
// audit trail. Kept apart from Repository (Asha's calls) so the two scopes never share a table:
// a shopkeeper call token can never resolve here, and an owner call id never resolves in `calls`.

export const OWNER_CALL_STATUSES = [
  'issued',
  'accepted',
  'in_progress',
  'completed',
  'expired',
] as const;
export type OwnerCallStatus = (typeof OWNER_CALL_STATUSES)[number];

/** Accepted on the page, or talking (Sarvam URL issued): tools work and the line is busy. */
export const ACTIVE_OWNER_CALL_STATUSES: readonly OwnerCallStatus[] = ['accepted', 'in_progress'];

export interface OwnerCall {
  readonly id: string;
  readonly ownerId: string;
  readonly status: OwnerCallStatus;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly urlIssuedAt: string | null;
}

export interface NewOwnerCall {
  readonly ownerId: string;
  readonly expiresAt: string;
}

/** Fields a status change may set. Timestamps are ISO strings. */
export interface OwnerCallPatch {
  readonly status: OwnerCallStatus;
  readonly acceptedAt?: string;
  readonly urlIssuedAt?: string;
  readonly endedAt?: string;
  readonly durationSeconds?: number;
  readonly interactionId?: string;
}

export interface NewOwnerToolEvent {
  readonly ownerCallId: string;
  readonly tool: string;
  readonly args: unknown;
  readonly result: unknown;
  readonly durationMs: number;
}

export interface OwnerCallRepository {
  createOwnerCall(call: NewOwnerCall): Promise<OwnerCall>;
  getOwnerCall(ownerCallId: string): Promise<OwnerCall | null>;
  /** Compare-and-set: applies the patch only while the row is in one of `from`; false when
   * another request got there first (a second Start call, a second URL). */
  transitionOwnerCall(
    ownerCallId: string,
    from: readonly OwnerCallStatus[],
    patch: OwnerCallPatch,
  ): Promise<boolean>;
  /** Every still-issued link of the owner becomes expired (a new tap replaces older links). */
  expireIssuedOwnerCalls(ownerId: string): Promise<void>;
  /** Links the owner asked for at or after `since` (any status): the "3 links per 10 minutes" rule. */
  countOwnerCallsIssuedSince(ownerId: string, since: Date): Promise<number>;
  /** Owner calls whose Sarvam URL was issued at or after `since`: the daily session caps. */
  countOwnerUrlsIssuedSince(since: Date): Promise<number>;
  /** True while an owner call accepted at or after `acceptedSince` is accepted or in progress:
   * the phone page's line is busy (a queued Asha call waits). */
  hasActiveOwnerCall(acceptedSince: Date): Promise<boolean>;
  insertOwnerToolEvent(event: NewOwnerToolEvent): Promise<void>;
}
