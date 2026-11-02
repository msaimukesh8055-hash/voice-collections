// supabase/functions/_shared/db/fake-repository.ts
// In-memory Repository for tests. FAKE DATA ONLY. Ramesh's book mirrors his seeded story
// (₹8,500 outstanding: ₹5,000 overdue 12 days + ₹3,500 due in 3 days) on FAKE_TODAY.
import type { LedgerEntry, PaymentMode } from '../schemas/ledger.ts';
import type { CallStatus } from '../schemas/shopkeeper.ts';
import type {
  CallPatch,
  CallSession,
  DemoSettings,
  NewOwnerCallback,
  NewPromise,
  NewToolEvent,
  Repository,
  Shopkeeper,
} from './repository.ts';

/** India date the fake ledger is written against (a Monday). */
export const FAKE_TODAY = '2026-11-02';
/** Noon IST on FAKE_TODAY. */
export const FAKE_NOW = new Date('2026-11-02T12:00:00+05:30');

export const FAKE_RAMESH: Shopkeeper = {
  id: '5e000000-0000-4000-8000-000000000001',
  name: 'Ramesh',
  shopName: 'Ramesh Kirana',
  language: 'te',
  doNotCall: false,
  ownerName: 'Srinivas Reddy',
  businessName: 'Sri Lakshmi Traders',
};

export const FAKE_LATHA: Shopkeeper = {
  id: '5e000000-0000-4000-8000-000000000002',
  name: 'Latha',
  shopName: 'Latha General Stores',
  language: 'hi',
  doNotCall: false,
  ownerName: 'Srinivas Reddy',
  businessName: 'Sri Lakshmi Traders',
};

export interface FakeLedgerEntry extends LedgerEntry {
  readonly shopkeeperId: string;
  readonly callId: string | null;
  readonly paymentMode: PaymentMode | null;
}

function entry(
  shopkeeperId: string,
  fields: Omit<FakeLedgerEntry, 'shopkeeperId' | 'callId' | 'status' | 'paymentMode'>,
): FakeLedgerEntry {
  return { shopkeeperId, callId: null, status: 'confirmed', paymentMode: null, ...fields };
}

export const FAKE_LEDGER: readonly FakeLedgerEntry[] = [
  entry(FAKE_RAMESH.id, {
    kind: 'credit',
    amount: 4000,
    entryDate: '2026-09-05',
    dueDate: '2026-09-20',
  }),
  entry(FAKE_RAMESH.id, { kind: 'payment', amount: 4000, entryDate: '2026-09-24', dueDate: null }),
  entry(FAKE_RAMESH.id, {
    kind: 'credit',
    amount: 5000,
    entryDate: '2026-10-06',
    dueDate: '2026-10-21',
  }),
  entry(FAKE_RAMESH.id, {
    kind: 'credit',
    amount: 3500,
    entryDate: '2026-10-21',
    dueDate: '2026-11-05',
  }),
  entry(FAKE_LATHA.id, {
    kind: 'credit',
    amount: 2000,
    entryDate: '2026-10-10',
    dueDate: '2026-10-25',
  }),
];

export interface FakeCall extends CallSession {
  readonly endedAt: string | null;
  readonly durationSeconds: number | null;
}

export interface FakeState {
  shopkeepers: readonly Shopkeeper[];
  ledger: readonly FakeLedgerEntry[];
  calls: readonly FakeCall[];
  promises: readonly NewPromise[];
  callbacks: readonly NewOwnerCallback[];
  toolEvents: readonly NewToolEvent[];
  settings: DemoSettings;
  /** Stands in for the database's now() when a call row is created. */
  clock: () => Date;
}

/** A call row for tests; defaults to Ramesh's live call, accepted a minute before FAKE_NOW. */
export function fakeCall(overrides: Partial<FakeCall> = {}): FakeCall {
  return {
    callId: 'ca000000-0000-4000-8000-0000000000aa',
    shopkeeperId: FAKE_RAMESH.id,
    mode: 'live',
    status: 'accepted',
    language: 'te',
    identityStatus: 'unknown',
    identityUnsureCount: 0,
    interactionId: null,
    queuedAt: '2026-11-02T06:28:00.000Z',
    ringingAt: '2026-11-02T06:28:30.000Z',
    acceptedAt: '2026-11-02T06:29:00.000Z',
    urlIssuedAt: null,
    endedAt: null,
    durationSeconds: null,
    ...overrides,
  };
}

function initialState(overrides: Partial<FakeState>): FakeState {
  return {
    shopkeepers: [FAKE_RAMESH, FAKE_LATHA],
    ledger: FAKE_LEDGER,
    calls: [],
    promises: [],
    callbacks: [],
    toolEvents: [],
    settings: {
      demoClock: null,
      callingHoursEnabled: false,
      callLimitsEnabled: false,
      liveShopkeeperId: FAKE_RAMESH.id,
    },
    clock: () => FAKE_NOW,
    ...overrides,
  };
}

function toSession(call: FakeCall): CallSession {
  const { endedAt: _endedAt, durationSeconds: _duration, ...session } = call;
  return session;
}

function applyPatch(call: FakeCall, patch: CallPatch): FakeCall {
  return { ...call, ...patch };
}

const RINGABLE: readonly CallStatus[] = ['queued', 'ringing'];

/** Returns the fake plus its live state, so tests can assert on what was written. */
export function createFakeRepository(overrides: Partial<FakeState> = {}): {
  readonly repo: Repository;
  readonly state: FakeState;
} {
  const state = initialState(overrides);
  const findCall = (id: string): FakeCall | undefined =>
    state.calls.find((call) => call.callId === id);
  const updateCall = (id: string, update: (call: FakeCall) => FakeCall): void => {
    state.calls = state.calls.map((call) => (call.callId === id ? update(call) : call));
  };
  const claimsFor = (callId: string): readonly FakeLedgerEntry[] =>
    state.ledger.filter((row) => row.callId === callId);

  const repo: Repository = {
    getDemoSettings: () => Promise.resolve(state.settings),
    getShopkeeper: (id) =>
      Promise.resolve(state.shopkeepers.find((shopkeeper) => shopkeeper.id === id) ?? null),
    countCallsSince: (shopkeeperId, since) =>
      Promise.resolve(
        state.calls.filter((call) =>
          call.shopkeeperId === shopkeeperId && Date.parse(call.queuedAt) >= since.getTime()
        ).length,
      ),
    createCall: (call) => {
      const created = fakeCall({
        ...call,
        callId: crypto.randomUUID(),
        status: 'queued',
        queuedAt: state.clock().toISOString(),
        ringingAt: null,
        acceptedAt: null,
      });
      state.calls = [...state.calls, created];
      return Promise.resolve(created.callId);
    },
    getCallSession: (callId) => {
      const call = findCall(callId);
      return Promise.resolve(call ? toSession(call) : null);
    },
    findRingingCall: (shopkeeperId) => {
      const ringable = state.calls
        .filter((call) => call.shopkeeperId === shopkeeperId && RINGABLE.includes(call.status))
        .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt));
      return Promise.resolve(ringable[0] ? toSession(ringable[0]) : null);
    },
    transitionCall: (callId, from, patch) => {
      const call = findCall(callId);
      if (!call || !from.includes(call.status)) return Promise.resolve(false);
      updateCall(callId, (current) => applyPatch(current, patch));
      return Promise.resolve(true);
    },
    recordIdentity: (callId, expected, next) => {
      const call = findCall(callId);
      const matches = call?.identityStatus === expected.status &&
        call.identityUnsureCount === expected.unsureCount;
      if (!matches) return Promise.resolve(false);
      updateCall(callId, (current) => ({
        ...current,
        identityStatus: next.status,
        identityUnsureCount: next.unsureCount,
      }));
      return Promise.resolve(true);
    },
    getLedger: (shopkeeperId) =>
      Promise.resolve(state.ledger.filter((row) => row.shopkeeperId === shopkeeperId)),
    getPromiseForCall: (callId) => {
      const saved = state.promises.find((promise) => promise.callId === callId);
      return Promise.resolve(
        saved ? { amount: saved.amount, promiseDate: saved.promiseDate } : null,
      );
    },
    insertPromise: (promise) => {
      if (state.promises.some((saved) => saved.callId === promise.callId)) {
        return Promise.resolve(false);
      }
      state.promises = [...state.promises, promise];
      return Promise.resolve(true);
    },
    updatePromiseForCall: (callId, latest) => {
      if (!state.promises.some((saved) => saved.callId === callId)) return Promise.resolve(false);
      state.promises = state.promises.map((saved) =>
        saved.callId === callId ? { ...saved, ...latest } : saved
      );
      return Promise.resolve(true);
    },
    getClaimForCall: (callId) => {
      const saved = claimsFor(callId)[0];
      return Promise.resolve(
        saved
          ? { amount: saved.amount, paidDate: saved.entryDate, mode: saved.paymentMode ?? 'cash' }
          : null,
      );
    },
    insertPaymentClaim: (claim) => {
      if (claimsFor(claim.callId).length > 0) return Promise.resolve(false);
      const row: FakeLedgerEntry = {
        shopkeeperId: claim.shopkeeperId,
        callId: claim.callId,
        kind: 'payment',
        amount: claim.amount,
        entryDate: claim.paidDate,
        dueDate: null,
        status: 'claimed',
        paymentMode: claim.mode,
      };
      state.ledger = [...state.ledger, row];
      return Promise.resolve(true);
    },
    insertOwnerCallback: (callback) => {
      state.callbacks = [...state.callbacks, callback];
      return Promise.resolve();
    },
    insertToolEvent: (event) => {
      state.toolEvents = [...state.toolEvents, event];
      return Promise.resolve();
    },
  };
  return { repo, state };
}
