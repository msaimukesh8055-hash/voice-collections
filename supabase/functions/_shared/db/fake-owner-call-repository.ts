// supabase/functions/_shared/db/fake-owner-call-repository.ts
// In-memory OwnerCallRepository for tests. FAKE DATA ONLY. The default owner call is Srinivas's,
// accepted a minute before FAKE_NOW (like fakeCall for Asha's calls).
import { FAKE_OWNER } from './fake-book-repository.ts';
import { FAKE_NOW } from './fake-repository.ts';
import type { NewOwnerToolEvent, OwnerCall, OwnerCallRepository } from './owner-call-repository.ts';

export const FAKE_OWNER_CALL_ID = 'ca000000-0000-4000-8000-0000000000b1';
const MINUTE_MS = 60_000;

export interface FakeOwnerCall extends OwnerCall {
  readonly endedAt: string | null;
  readonly durationSeconds: number | null;
  readonly interactionId: string | null;
}

export interface FakeOwnerCallState {
  ownerCalls: readonly FakeOwnerCall[];
  events: readonly NewOwnerToolEvent[];
  /** Stands in for the database's now() when a row is created. */
  clock: () => Date;
}

function minutesBefore(minutes: number): string {
  return new Date(FAKE_NOW.getTime() - minutes * MINUTE_MS).toISOString();
}

export function fakeOwnerCall(overrides: Partial<FakeOwnerCall> = {}): FakeOwnerCall {
  return {
    id: FAKE_OWNER_CALL_ID,
    ownerId: FAKE_OWNER.id,
    status: 'accepted',
    issuedAt: minutesBefore(2),
    expiresAt: minutesBefore(-13),
    acceptedAt: minutesBefore(1),
    urlIssuedAt: null,
    endedAt: null,
    durationSeconds: null,
    interactionId: null,
    ...overrides,
  };
}

function isAt(iso: string | null, since: Date): boolean {
  return iso !== null && Date.parse(iso) >= since.getTime();
}

function toOwnerCall(row: FakeOwnerCall): OwnerCall {
  const { endedAt: _ended, durationSeconds: _seconds, interactionId: _id, ...call } = row;
  return call;
}

function counts(
  state: FakeOwnerCallState,
): Pick<
  OwnerCallRepository,
  'countOwnerCallsIssuedSince' | 'countOwnerUrlsIssuedSince' | 'hasActiveOwnerCall'
> {
  return {
    countOwnerCallsIssuedSince: (ownerId, since) =>
      Promise.resolve(
        state.ownerCalls.filter((row) => row.ownerId === ownerId && isAt(row.issuedAt, since))
          .length,
      ),
    countOwnerUrlsIssuedSince: (since) =>
      Promise.resolve(state.ownerCalls.filter((row) => isAt(row.urlIssuedAt, since)).length),
    hasActiveOwnerCall: (acceptedSince) =>
      Promise.resolve(
        state.ownerCalls.some((row) =>
          (row.status === 'accepted' || row.status === 'in_progress') &&
          isAt(row.acceptedAt, acceptedSince)
        ),
      ),
  };
}

/** Returns the fake plus its live state, so tests can assert on what was written. */
export function createFakeOwnerCallRepository(
  overrides: Partial<FakeOwnerCallState> = {},
): { readonly ownerCalls: OwnerCallRepository; readonly state: FakeOwnerCallState } {
  const state: FakeOwnerCallState = {
    ownerCalls: [],
    events: [],
    clock: () => FAKE_NOW,
    ...overrides,
  };
  const ownerCalls: OwnerCallRepository = {
    createOwnerCall: (call) => {
      const created = fakeOwnerCall({
        ...call,
        id: crypto.randomUUID(),
        status: 'issued',
        issuedAt: state.clock().toISOString(),
        acceptedAt: null,
      });
      state.ownerCalls = [...state.ownerCalls, created];
      return Promise.resolve(toOwnerCall(created));
    },
    getOwnerCall: (ownerCallId) => {
      const found = state.ownerCalls.find((row) => row.id === ownerCallId);
      return Promise.resolve(found ? toOwnerCall(found) : null);
    },
    transitionOwnerCall: (ownerCallId, from, patch) => {
      const found = state.ownerCalls.find((row) => row.id === ownerCallId);
      if (!found || !from.includes(found.status)) return Promise.resolve(false);
      state.ownerCalls = state.ownerCalls.map((row): FakeOwnerCall =>
        row.id === ownerCallId ? { ...row, ...patch } : row
      );
      return Promise.resolve(true);
    },
    expireIssuedOwnerCalls: (ownerId) => {
      state.ownerCalls = state.ownerCalls.map((row): FakeOwnerCall =>
        row.ownerId === ownerId && row.status === 'issued' ? { ...row, status: 'expired' } : row
      );
      return Promise.resolve();
    },
    ...counts(state),
    insertOwnerToolEvent: (event) => {
      state.events = [...state.events, event];
      return Promise.resolve();
    },
  };
  return { ownerCalls, state };
}
