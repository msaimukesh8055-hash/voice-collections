// supabase/functions/_shared/db/fake-repository.ts
// In-memory Repository for tests. FAKE DATA ONLY. Ramesh's book mirrors his seeded story
// (₹8,500 outstanding: ₹5,000 overdue 12 days + ₹3,500 due in 3 days) on FAKE_TODAY.
import type { ToneLevel } from '../calls/tone.ts';
import type { PromiseRecord } from '../ledger/promise-check.ts';
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
import type { MemoryMethods } from './supabase-memory.ts';

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
  consequenceText: null,
};

export const FAKE_LATHA: Shopkeeper = {
  id: '5e000000-0000-4000-8000-000000000002',
  name: 'Latha',
  shopName: 'Latha General Stores',
  language: 'hi',
  doNotCall: false,
  ownerName: 'Srinivas Reddy',
  businessName: 'Sri Lakshmi Traders',
  consequenceText: null,
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

/** Ramesh's seeded promises: ₹2,500 kept in August, ₹3,000 for Fri 30 Oct broken (SPEC §2). */
export const FAKE_RAMESH_PROMISES: readonly FakePromiseRecord[] = [
  {
    id: '90000000-0000-4000-8000-000000000001',
    shopkeeperId: FAKE_RAMESH.id,
    amount: 2500,
    promiseDate: '2026-08-14',
    status: 'kept',
    createdAt: '2026-08-06T05:00:00.000Z',
  },
  {
    id: '90000000-0000-4000-8000-000000000002',
    shopkeeperId: FAKE_RAMESH.id,
    amount: 3000,
    promiseDate: '2026-10-30',
    status: 'broken',
    createdAt: '2026-10-23T05:00:00.000Z',
  },
];

export interface FakeCall extends CallSession {
  readonly endedAt: string | null;
  readonly durationSeconds: number | null;
  readonly followupStatus?: 'pending';
  readonly followupNextAt?: string;
}

export interface FakePromiseRecord extends PromiseRecord {
  readonly shopkeeperId: string;
}

export interface FakeNote {
  readonly shopkeeperId: string;
  readonly note: string;
  readonly createdAt: string;
}

export interface FakeState {
  shopkeepers: readonly Shopkeeper[];
  ledger: readonly FakeLedgerEntry[];
  calls: readonly FakeCall[];
  promises: readonly NewPromise[];
  callbacks: readonly NewOwnerCallback[];
  toolEvents: readonly NewToolEvent[];
  /** Promise history read by memory and tone (listPromises), in any order. */
  promiseHistory: readonly FakePromiseRecord[];
  notes: readonly FakeNote[];
  toneLevels: Readonly<Record<string, ToneLevel>>;
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
    promiseHistory: [],
    notes: [],
    toneLevels: {},
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
  const {
    endedAt: _endedAt,
    durationSeconds: _duration,
    followupStatus: _followup,
    followupNextAt: _next,
    ...session
  } = call;
  return session;
}

function applyPatch(call: FakeCall, patch: CallPatch): FakeCall {
  return { ...call, ...patch };
}

const RINGABLE: readonly CallStatus[] = ['queued', 'ringing'];

function newestFirst<T extends { readonly createdAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Memory and tone methods (M5), kept apart so the main fake stays readable. */
function fakeMemory(state: FakeState): MemoryMethods {
  return {
    listPromises: (shopkeeperId) =>
      Promise.resolve(
        newestFirst(
          state.promiseHistory.filter((promise) => promise.shopkeeperId === shopkeeperId),
        ),
      ),
    getLastNote: (shopkeeperId) =>
      Promise.resolve(
        newestFirst(state.notes.filter((note) => note.shopkeeperId === shopkeeperId))[0]?.note ??
          null,
      ),
    setPromiseStatus: (promiseId, status) => {
      const open = state.promiseHistory.some((p) => p.id === promiseId && p.status === 'open');
      if (!open) return Promise.resolve(false);
      state.promiseHistory = state.promiseHistory.map((
        p,
      ) => (p.id === promiseId ? { ...p, status } : p));
      return Promise.resolve(true);
    },
    setCallToneLevel: (callId, level) => {
      state.toneLevels = { ...state.toneLevels, [callId]: level };
      return Promise.resolve();
    },
  };
}

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
    countCallUrlsIssuedSince: (since) =>
      Promise.resolve(
        state.calls.filter((call) =>
          call.urlIssuedAt !== null && Date.parse(call.urlIssuedAt) >= since.getTime()
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
    ...fakeMemory(state),
  };
  return { repo, state };
}
